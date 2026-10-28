#!/usr/bin/env python3
"""Launch an installed Neuriplo UI and stop its inference processes on exit."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import tempfile
import urllib.request


def runtime_environment(state, host, port, workspace):
    return os.environ | state['environment'] | {
        'PATH': state['node'] + ':' + os.environ['PATH'],
        'NEURIPLO_INFER_BIN': state['binary'],
        'NEURIPLO_UI_WEB_ROOT': str(Path(state['app']) / 'apps/web/dist'),
        'NEURIPLO_UI_BROWSE_ROOT': str(workspace),
        'NEURIPLO_UI_SOURCE_ROOT': str(workspace),
        'HOST': host, 'PORT': str(port),
        'NEURIPLO_UI_RUN_ROOT': os.environ.get('NEURIPLO_UI_RUN_ROOT',
            str(Path(tempfile.gettempdir()) / f'neuriplo-ui-runs-{os.getuid()}')),
    }


def wait_ready(child, url, backend, timeout=120):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if child.poll() is not None:
            raise RuntimeError(f'The web application exited with status {child.returncode}')
        try:
            # The adapter allows up to ten seconds for producer discovery.
            # TensorFlow library loading can exceed a one-second HTTP probe.
            remaining = max(.1, deadline - time.monotonic())
            with urllib.request.urlopen(url, timeout=min(15, remaining)) as response:
                capabilities = json.load(response)
            backends = [b for w in capabilities['execution']['workflows'] for b in w['backends']]
            if backend not in backends:
                raise ValueError('The runtime does not advertise the selected backend')
            return
        except OSError:
            time.sleep(.2)
    raise RuntimeError('The web application did not become ready')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int)
    parser.add_argument('--data-dir', type=Path)
    args = parser.parse_args()
    prefix = Path(__file__).resolve().parent
    state = json.loads((prefix / 'installation.json').read_text())
    args.port = args.port if args.port is not None else state.get('port', 5173)
    if not 1024 <= args.port <= 65535:
        parser.error('port must be 1024..65535')
    with Path(state['binary']).open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != state['binary_sha256']:
            raise ValueError('The installed runtime changed; reinstall into a fresh prefix')
    workspace = (args.data_dir or Path(state['data_dir'])).expanduser().resolve()
    workspace.mkdir(parents=True, exist_ok=True)
    env = runtime_environment(state, args.host, args.port, workspace)
    child = subprocess.Popen([str(Path(state['node']) / 'node'), 'apps/server/dist/index.js'],
                             cwd=state['app'], env=env, start_new_session=True)

    stopping = False

    def stop(_signum=None, _frame=None):
        nonlocal stopping
        if _signum is not None:
            stopping = True
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        probe_host = '127.0.0.1' if args.host == '0.0.0.0' else args.host
        wait_ready(child, f'http://{probe_host}:{args.port}/api/capabilities', state['backend'])
        print(f'Neuriplo UI: http://{probe_host}:{args.port}\nWorkspace: {workspace}', flush=True)
        code = child.wait()
        return 0 if stopping else code
    finally:
        stop()
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, RuntimeError) as error:
        print(f'Cannot start Neuriplo UI: {error}', file=sys.stderr)
        sys.exit(1)
