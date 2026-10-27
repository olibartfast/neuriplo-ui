#!/usr/bin/env python3
"""Fail closed before browser validation; record provenance only after rebuilding."""
import argparse
import ctypes
import hashlib
import json
import os
import re
from pathlib import Path
import subprocess
import sys


def run(*args):
    return subprocess.check_output(args, text=True, timeout=60).strip()


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def cache_values(path):
    return dict(line.split(':', 1)[0:1] + [line.split('=', 1)[1]]
                for line in Path(path).read_text().splitlines()
                if ':' in line and '=' in line and not line.startswith('//'))


def verify_record(record, current):
    if record != current:
        raise ValueError('Build provenance changed; configure and record a clean rebuild')



def ui_identity():
    root = Path(__file__).resolve().parent.parent
    head = run('git', '-C', str(root), 'rev-parse', 'HEAD')
    origin = run('git', '-C', str(root), 'remote', 'get-url', 'origin')
    # Public GitHub reads do not require an SSH agent or host-key prompts.
    query_origin = re.sub(r'^git@github\.com:', 'https://github.com/', origin)
    remote = run('git', '-C', str(root), 'ls-remote', query_origin, 'refs/heads/master').split()[0]
    ancestor = subprocess.run(['git', '-C', str(root), 'merge-base', '--is-ancestor', remote, head],
                              capture_output=True).returncode == 0
    verify_ui_revision(ancestor)
    return {'commit': head, 'remote_master': remote,
            'source_sha256': {str(p.relative_to(root)): digest(p)
                              for folder in ['apps/web/src', 'apps/server/src']
                              for p in sorted((root / folder).rglob('*')) if p.is_file()},
            'package_lock_sha256': digest(root / 'package-lock.json')}


def verify_ui_revision(includes_current_master):
    if not includes_current_master:
        raise ValueError('UI checkout is behind current origin/master; fetch and integrate it before browser validation')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build-dir', type=Path)
    parser.add_argument('--rebuild', action='store_true')
    parser.add_argument('--if-configured', action='store_true',
                        help='Allow fixture-only E2E when no real executable is configured')
    args = parser.parse_args()
    if args.if_configured and not os.environ.get('NEURIPLO_INFER_BIN', '').strip():
        print('Fixture-only E2E: real stack provenance is not validated')
        return
    ui = ui_identity()
    binary = Path(os.environ['NEURIPLO_INFER_BIN']).resolve(strict=not args.rebuild)
    build = (args.build_dir or binary.parent.parent).resolve()
    if binary != build / 'app' / 'neuriplo-infer':
        raise ValueError('Executable must be the app/neuriplo-infer output of this build')
    cache = build / 'CMakeCache.txt'
    values = cache_values(cache)
    identities = {}
    versions = {}
    for name in ('neuriplo-infer', 'neuriplo', 'neuriplo-tasks'):
        source = Path(values[f'{name}_SOURCE_DIR']).resolve()
        if run('git', '-C', str(source), 'status', '--porcelain', '--untracked-files=no'):
            raise ValueError(f'{name}: tracked source changes; use a clean release checkout')
        release = json.loads(run('gh', 'release', 'view', '--repo', f'olibartfast/{name}',
                                 '--json', 'tagName'))['tagName']
        head = run('git', '-C', str(source), 'rev-parse', 'HEAD')
        tag = run('git', '-C', str(source), 'rev-parse', f'{release}^{{commit}}')
        if head != tag:
            raise ValueError(f'{name}: checkout {head} is not latest release {release}')
        version = (source / 'VERSION').read_text().strip()
        if version != release.removeprefix('v'):
            raise ValueError(f'{name}: VERSION disagrees with release {release}')
        identities[name] = {'source': str(source), 'commit': head, 'release': release}
        versions[name] = version
    if 'nert_SOURCE_DIR' in values:
        source = Path(values['nert_SOURCE_DIR']).resolve()
        declared = (Path(identities['neuriplo']['source']) / 'versions.env').read_text()
        release = re.search(r'^NERT_VERSION=(.+)$', declared, re.MULTILINE).group(1)
        release = 'v' + release.removeprefix('v')
        head = run('git', '-C', str(source), 'rev-parse', 'HEAD')
        if (head != run('git', '-C', str(source), 'rev-parse', f'{release}^{{commit}}') or
                run('git', '-C', str(source), 'status', '--porcelain', '--untracked-files=no')):
            raise ValueError('NERT sources do not match the clean pinned release')
        identities['nert'] = {'source': str(source), 'commit': head, 'release': release}
    if 'neuriplo-kserve-client_SOURCE_DIR' in values:
        source = Path(values['neuriplo-kserve-client_SOURCE_DIR']).resolve()
        release = values['NEURIPLO_KSERVE_CLIENT_VERSION']
        head = run('git', '-C', str(source), 'rev-parse', 'HEAD')
        if (head != run('git', '-C', str(source), 'rev-parse', f'{release}^{{commit}}') or
                run('git', '-C', str(source), 'status', '--porcelain', '--untracked-files=no')):
            raise ValueError('KServe client sources do not match the clean pinned release')
        identities['neuriplo-kserve-client'] = {'source': str(source), 'commit': head, 'release': release}
    for key, name in [('CMAKE_PROJECT_VERSION', 'neuriplo-infer'),
                      ('NEURIPLO_VERSION', 'neuriplo'),
                      ('NEURIPLO_TASKS_VERSION', 'neuriplo-tasks')]:
        if values[key].removeprefix('v') != versions[name]:
            raise ValueError(f'{key}: stale cache {values[key]}, expected {versions[name]}')
    manifest = build / 'neuriplo-ui-provenance.json'
    if args.rebuild:
        manifest.unlink(missing_ok=True)
        subprocess.run(['cmake', '--build', str(build), '--clean-first', '--parallel', '4'],
                       check=True)
    capabilities = json.loads(run(str(binary), '--capabilities'))
    if capabilities['producer']['version'] != versions['neuriplo-infer']:
        raise ValueError('Executable version differs from current infer release')
    linked = sorted(set(re.findall(r'(?:=>\s+)?(/\S+)\s+\(', run('ldd', str(binary)))))
    current = {'binary': str(binary), 'binary_sha256': digest(binary),
               'cache_sha256': digest(cache), 'sources': identities,
               'shared_libraries': {path: digest(path) for path in linked}}
    backends = [b for w in capabilities['execution']['workflows'] for b in w['backends']]
    if 'tensorrt' in backends:
        prefix = Path(values['TENSORRT_DIR'])
        library = ctypes.CDLL(str(prefix / 'lib/libnvinfer.so'))
        actual = library.getInferLibVersion()
        expected = [int(v) for v in values['TENSORRT_VERSION'].split('.')[:3]]
        if actual != expected[0] * 10000 + expected[1] * 100 + expected[2]:
            raise ValueError('Installed TensorRT differs from configured version')
        current['tensorrt'] = {'version_code': actual, 'declared_version': values['TENSORRT_VERSION'],
                               'version_header_sha256': digest(prefix / 'include/NvInferVersion.h')}
    if 'executorch' in backends:
        prefix = Path(values['EXECUTORCH_DIR'])
        header = prefix / 'include/executorch/runtime/core/version.h'
        actual = re.search(r'#define ET_VERSION "([^"]+)"', header.read_text()).group(1)
        if actual != values['EXECUTORCH_VERSION'].removeprefix('v'):
            raise ValueError('Installed ExecuTorch version differs from configured version')
        current['executorch'] = {'version': actual, 'header_sha256': digest(header),
                                'archives': {str(p): digest(p) for p in sorted((prefix / 'lib').rglob('*.a'))}}
    if 'openvino' in backends:
        core = next((Path(p) for p in linked if Path(p).name.startswith('libopenvino.so')), None)
        if core is None:
            raise ValueError('Cannot identify linked OpenVINO runtime')
        prefix = core.resolve().parent.parent
        library = ctypes.CDLL(str(prefix / 'libs/libopenvino_c.so.2630'))
        class OvVersion(ctypes.Structure):
            _fields_ = [('buildNumber', ctypes.c_char_p), ('description', ctypes.c_char_p)]
        version = OvVersion()
        if library.ov_get_openvino_version(ctypes.byref(version)) != 0:
            raise ValueError('Cannot query OpenVINO runtime version')
        actual = version.buildNumber.decode()
        if not actual.startswith(values['OPENVINO_VERSION'] + '-'):
            raise ValueError('Installed OpenVINO differs from configured version')
        current['openvino'] = {'version': actual, 'plugins': {
            str(p): digest(p) for p in sorted((prefix / 'libs').glob('*.so*'))}}
    if 'onnx_runtime' in [b for w in capabilities['execution']['workflows'] for b in w['backends']]:
        class OrtApiBase(ctypes.Structure):
            _fields_ = [('GetApi', ctypes.c_void_p),
                        ('GetVersionString', ctypes.CFUNCTYPE(ctypes.c_char_p))]
        library = ctypes.CDLL(str(Path(values['ONNX_RUNTIME_DIR']) / 'lib/libonnxruntime.so'))
        library.OrtGetApiBase.restype = ctypes.POINTER(OrtApiBase)
        actual = library.OrtGetApiBase().contents.GetVersionString().decode()
        if actual != values['ONNX_RUNTIME_VERSION']:
            raise ValueError(f'Installed ONNX Runtime {actual} differs from pinned version')
        current['onnxruntime_version'] = actual
    if args.rebuild:
        # Source changes during the build invalidate the record as well.
        for identity in identities.values():
            source = identity['source']
            if (run('git', '-C', source, 'rev-parse', 'HEAD') != identity['commit'] or
                    run('git', '-C', source, 'status', '--porcelain', '--untracked-files=no')):
                raise ValueError('Sources changed during build')
        manifest.write_text(json.dumps(current, indent=2) + '\n')
    if not manifest.exists():
        raise ValueError('Unknown build provenance: use --rebuild after fresh configuration')
    verify_record(json.loads(manifest.read_text()), current)
    print(json.dumps({'status': 'verified', 'ui': ui, **current}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (KeyError, ValueError, OSError, subprocess.SubprocessError) as error:
        print(f'STACK VALIDATION BLOCKED: {error}', file=sys.stderr)
        sys.exit(1)
