#!/usr/bin/env python3
"""Install Neuriplo UI and a selected inference backend on Ubuntu 24.04."""
from __future__ import annotations

import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shlex
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REPO = 'https://github.com/olibartfast/neuriplo-ui.git'
BACKENDS = ('onnx_runtime', 'openvino', 'tensorrt', 'executorch', 'opencv_dnn', 'nert')
PACKAGES = ('build-essential', 'cmake', 'ninja-build', 'pkg-config', 'git', 'curl',
            'wget', 'unzip', 'xz-utils', 'zstd', 'ca-certificates', 'python3',
            'python3-venv', 'python3-pip', 'libopencv-dev', 'libgoogle-glog-dev',
            'libcurl4-openssl-dev', 'libssl-dev', 'libgtest-dev')


def command(args, *, cwd=None, env=None, capture=False):
    print('+ ' + shlex.join(map(str, args)), flush=True)
    return subprocess.run(list(map(str, args)), cwd=cwd, env=env, check=True,
                          text=True, stdout=subprocess.PIPE if capture else None).stdout


def request(url):
    headers = {'User-Agent': 'neuriplo-ui-installer', 'Accept': 'application/json'}
    if url.startswith('https://api.github.com/') and os.environ.get('GH_TOKEN'):
        headers['Authorization'] = 'Bearer ' + os.environ['GH_TOKEN']
    return urllib.request.Request(url, headers=headers)


def fetch_json(url):
    with urllib.request.urlopen(request(url), timeout=60) as response:
        return json.load(response)


def release(name):
    return fetch_json(f'https://api.github.com/repos/olibartfast/{name}/releases/latest')['tag_name']


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def download(url, path, expected=None):
    path = Path(path)
    if path.exists() and expected and sha(path) == expected:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.partial')
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request(url), timeout=60) as source, temporary.open('wb') as target:
                shutil.copyfileobj(source, target)
            if expected and sha(temporary) != expected:
                raise ValueError(f'Checksum mismatch: {path.name}')
            temporary.replace(path)
            return path
        except (OSError, ValueError):
            temporary.unlink(missing_ok=True)
            if attempt == 2:
                raise
            time.sleep(2)
    raise AssertionError('unreachable')


def extract(archive, target):
    target = Path(target)
    target.mkdir(parents=True, exist_ok=True)
    if str(archive).endswith('.zip'):
        with zipfile.ZipFile(archive) as source:
            for member in source.infolist():
                if not (target / member.filename).resolve().is_relative_to(target.resolve()):
                    raise ValueError('Archive path escapes the installation directory')
            source.extractall(target)
    elif str(archive).endswith('.zst'):
        unpacked = Path(str(archive) + '.tar')
        with unpacked.open('wb') as output:
            subprocess.run(['zstd', '-d', '--stdout', str(archive)], stdout=output, check=True)
        try:
            extract(unpacked, target)
        finally:
            unpacked.unlink(missing_ok=True)
    else:
        with tarfile.open(archive) as source:
            source.extractall(target, filter='data')


def env_file(path):
    return dict(re.findall(r'^([A-Z_]+)=["\']?([^\n"\']+)', Path(path).read_text(), re.M))


def privileged(args):
    return list(args) if os.geteuid() == 0 else ['sudo', *args]


def apt(packages):
    options = ['-o', 'Acquire::Retries=3', '-o', 'Acquire::http::Timeout=30',
               '-o', 'Acquire::https::Timeout=30']
    command(privileged(['apt-get', *options, 'update']))
    command(privileged(['env', 'DEBIAN_FRONTEND=noninteractive', 'apt-get', *options, 'install', '-y', '--no-install-recommends', *packages]),
            env=os.environ | {'DEBIAN_FRONTEND': 'noninteractive'})


def check_platform():
    values = env_file('/etc/os-release')
    if values.get('ID') != 'ubuntu' or values.get('VERSION_ID') != '24.04':
        raise ValueError('Automatic installation currently supports Ubuntu 24.04 only')
    if platform.machine() not in ('x86_64', 'amd64'):
        raise ValueError('Automatic SDK installation currently supports x86_64 only')


def clone(name, destination, tag=None):
    if destination.exists():
        raise ValueError(f'Refusing to overwrite source checkout: {destination}')
    command(['git', 'clone', '--depth', '1', '--branch', tag or 'master',
             f'https://github.com/olibartfast/{name}.git', destination])
    if tag:
        command(['git', '-C', destination, 'checkout', '--detach', tag])
    return command(['git', '-C', destination, 'rev-parse', 'HEAD'], capture=True).strip()



def record_command(args, destination, *, cwd, env):
    print('+ ' + shlex.join(map(str, args)), flush=True)
    with Path(destination).open('w') as log:
        process = subprocess.Popen(list(map(str, args)), cwd=cwd, env=env,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        for line in process.stdout:
            print(line, end='', flush=True)
            log.write(line)
        code = process.wait()
        if code:
            raise subprocess.CalledProcessError(code, args)


def install_node(prefix):
    releases = fetch_json('https://nodejs.org/dist/index.json')
    pinned = os.environ.get('NEURIPLO_NODE_VERSION')
    eligible = [r['version'] for r in releases if r['version'].startswith('v22.') and r['lts']
                and 'linux-x64' in r['files'] and tuple(map(int, r['version'][1:].split('.'))) >= (22, 12, 0)]
    if pinned and pinned not in eligible:
        raise ValueError('Requested Node version is not a supported Node 22 LTS release')
    version = pinned or eligible[0]
    filename = f'node-{version}-linux-x64.tar.xz'
    with urllib.request.urlopen(request(f'https://nodejs.org/dist/{version}/SHASUMS256.txt'), timeout=60) as response:
        checksums = dict(line.split()[::-1] for line in response.read().decode().splitlines())
    archive = download(f'https://nodejs.org/dist/{version}/{filename}', prefix / 'downloads' / filename,
                       checksums[filename])
    extract(archive, prefix / 'tools')
    return prefix / 'tools' / f'node-{version}-linux-x64' / 'bin'


def copy_overlay(source, destination):
    """Only tracked files and installer distribution files; never ignored data/.git."""
    if (source / '.git').exists():
        names = command(['git', '-C', source, 'ls-files', '-z'], capture=True).split('\0')
    else:
        manifest = source / 'installer-files.json'
        names = json.loads(manifest.read_text())
    names += ['install.sh', 'scripts/install.py', 'scripts/launch.py', 'docker/Dockerfile.ui']
    copied = []
    for name in dict.fromkeys(names):
        if not name:
            continue
        relative = Path(name)
        original = source / relative
        if relative.is_absolute() or '..' in relative.parts or '.git' in relative.parts:
            raise ValueError('Unsafe installer source path')
        if name.startswith('artifacts/') or ('promo' in name and name.startswith('specs/')):
            continue
        if original.is_symlink() or not original.resolve().is_relative_to(source.resolve()):
            raise ValueError('Symlinked installer sources are not supported')
        if original.is_file():
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(original, target)
            copied.append(name)
    return copied


def install_ui(prefix, source, commit):
    app = prefix / 'app'
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('UI commit must be an exact Git commit hash')
    command(['git', 'clone', '--single-branch', '--no-tags', '--no-checkout', REPO, app])
    if subprocess.run(['git', '-C', str(app), 'cat-file', '-e', commit],
                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
        command(['git', '-C', app, 'fetch', 'origin', commit])
    command(['git', '-C', app, 'checkout', '--detach', commit])
    copy_overlay(source, app)
    return app



def ensure_nvidia_driver(args):
    if shutil.which('nvidia-smi') and subprocess.run(['nvidia-smi'], stdout=subprocess.DEVNULL,
                                                   stderr=subprocess.DEVNULL).returncode == 0:
        return
    if not args.install_driver:
        raise ValueError('No working NVIDIA driver. Rerun with --install-driver to install it automatically; a reboot is required.')
    devices = Path('/sys/bus/pci/devices')
    if not any((device / 'vendor').read_text().strip() == '0x10de' and
               (device / 'class').read_text().startswith('0x03') for device in devices.iterdir()):
        raise ValueError('TensorRT requires an NVIDIA graphics device')
    with tempfile.TemporaryDirectory() as directory:
        keyring = download('https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2404/x86_64/cuda-keyring_1.1-1_all.deb', Path(directory) / 'cuda-keyring.deb')
        command(privileged(['dpkg', '-i', keyring]))
    apt(['cuda-drivers'])
    raise ValueError('NVIDIA driver installed. Reboot, then rerun the same installer command.')


def ensure_container_gpu(args, engine):
    ensure_nvidia_driver(args)
    runtimes = json.loads(command([*engine, 'info', '--format', '{{json .Runtimes}}'], capture=True))
    if 'nvidia' in runtimes:
        return
    running = command([*engine, 'ps', '-q'], capture=True).strip()
    if running and not args.allow_docker_restart:
        raise ValueError('NVIDIA Container Toolkit needs a Docker restart; containers are running. Rerun with --allow-docker-restart when interruption is acceptable.')
    apt(['gnupg', 'ca-certificates', 'curl'])
    with tempfile.TemporaryDirectory() as directory:
        directory = Path(directory)
        key = download('https://nvidia.github.io/libnvidia-container/gpgkey', directory / 'key.asc')
        command(['gpg', '--dearmor', '--output', directory / 'key.gpg', key])
        command(privileged(['install', '-m', '0644', directory / 'key.gpg', '/usr/share/keyrings/neuriplo-nvidia-container.gpg']))
        repo = download('https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list', directory / 'repo.list')
        repo.write_text(repo.read_text().replace('deb https://', 'deb [signed-by=/usr/share/keyrings/neuriplo-nvidia-container.gpg] https://'))
        command(privileged(['install', '-m', '0644', repo, '/etc/apt/sources.list.d/neuriplo-nvidia-container.list']))
    apt(['nvidia-container-toolkit'])
    command(privileged(['nvidia-ctk', 'runtime', 'configure', '--runtime=docker']))
    command(privileged(['systemctl', 'restart', 'docker']))


def install_sdk(backend, prefix, sources, versions, environment, jobs):
    sdk = prefix / 'sdk'
    sdk.mkdir(exist_ok=True)
    flags = []
    if backend == 'onnx_runtime':
        version = versions['ONNX_RUNTIME_VERSION']
        filename = f'onnxruntime-linux-x64-{version}.tgz'
        metadata = fetch_json(f'https://api.github.com/repos/microsoft/onnxruntime/releases/tags/v{version}')
        asset = next(a for a in metadata['assets'] if a['name'] == filename)
        digest = asset.get('digest', '')
        if not digest.startswith('sha256:'):
            raise ValueError('ONNX Runtime release asset has no published SHA256')
        archive = download(asset['browser_download_url'], prefix / 'downloads' / filename, digest[7:])
        extract(archive, sdk)
        flags += [f'-DONNX_RUNTIME_DIR={sdk / filename.removesuffix(".tgz")}']
    elif backend == 'openvino':
        venv = sdk / 'openvino-python'
        command([sys.executable, '-m', 'venv', venv])
        command([venv / 'bin/pip', 'install', '--only-binary=:all:', f'openvino=={versions["OPENVINO_VERSION"]}'])
        module = Path(command([venv / 'bin/python', '-c', 'import openvino;print(openvino.__path__[0])'], capture=True).strip())
        root = sdk / 'openvino'
        root.mkdir()
        (root / 'runtime').symlink_to(module)
        (root / 'openvino').symlink_to(module)
        environment['OPENVINO_DIR'] = str(root)
        flags += [f'-DOPENVINO_DIR={root}', f'-DOpenVINO_DIR={module / "cmake"}']
    elif backend == 'tensorrt':
        # Drivers belong to the host. Replacing a working driver is never implicit.
        if not os.environ.get('NEURIPLO_CONTAINER_BUILD'):
            command(['nvidia-smi'])
        cuda = versions['CUDA_VERSION'].split('.')
        keyring = download('https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2404/x86_64/cuda-keyring_1.1-1_all.deb', prefix / 'downloads/cuda-keyring.deb')
        command(privileged(['dpkg', '-i', keyring]))
        apt([f'cuda-toolkit-{cuda[0]}-{cuda[1]}'])
        toolkit = Path(f'/usr/local/cuda-{cuda[0]}.{cuda[1]}')
        version = versions['TENSORRT_VERSION']
        line = versions['TENSORRT_CUDA_VERSION']
        if int(version.split('.')[0]) >= 11:
            filename = f'TensorRT-Enterprise-{version}-Linux-x86_64-cuda-{line}-Release-external.tar.zst'
        else:
            filename = f'TensorRT-{version}.Linux.x86_64-gnu.cuda-{line}.tar.gz'
        url = f'https://developer.nvidia.com/downloads/compute/machine-learning/tensorrt/{".".join(version.split(".")[:3])}/tars/{filename}'
        extract(download(url, prefix / 'downloads' / filename), sdk)
        trt = sdk / f'TensorRT-{version}'
        environment['LD_LIBRARY_PATH'] = f'{trt}/lib:{toolkit}/lib64'
        flags += [f'-DTENSORRT_DIR={trt}', f'-DCUDAToolkit_ROOT={toolkit}',
                  f'-DCUDAToolkit_NVCC_EXECUTABLE={toolkit}/bin/nvcc']
    elif backend == 'opencv_dnn':
        version = versions['OPENCV_VERSION']
        path = sdk / 'opencv-source'
        command(['git', 'clone', '--depth', '1', '--branch', version,
                 'https://github.com/opencv/opencv.git', path])
        build = sdk / 'opencv-build'
        installed = sdk / 'opencv'
        command(['cmake', '-S', path, '-B', build, '-GNinja', '-DCMAKE_BUILD_TYPE=Release',
                 f'-DCMAKE_INSTALL_PREFIX={installed}', '-DBUILD_LIST=core,imgproc,imgcodecs,videoio,highgui,dnn,flann,geometry',
                 '-DBUILD_TESTS=OFF', '-DBUILD_PERF_TESTS=OFF', '-DBUILD_EXAMPLES=OFF'])
        command(['cmake', '--build', build, '--parallel', jobs])
        command(['cmake', '--install', build])
        flags += [f'-DOpenCV_DIR={installed}/lib/cmake/opencv5']
    elif backend == 'executorch':
        version = versions['EXECUTORCH_VERSION']
        src = sdk / 'source/executorch'
        command(['git', 'clone', '--depth', '1', '--branch', version,
                 'https://github.com/pytorch/executorch.git', src])
        command(['git', '-C', src, 'submodule', 'update', '--init', '--recursive', '--depth', '1'])
        venv = sdk / 'executorch-python'
        command([sys.executable, '-m', 'venv', venv])
        build_env = environment | {'PATH': f'{venv}/bin:{environment["PATH"]}', 'VIRTUAL_ENV': str(venv)}
        command([venv / 'bin/pip', 'install', 'tomli', 'zstd', 'setuptools', 'wheel'])
        command(['bash', src / 'install_requirements.sh'], cwd=src, env=build_env)
        build = src / 'cmake-out'
        installed = sdk / 'executorch'
        command(['cmake', '-S', src, '-B', build, '-GNinja', '-DCMAKE_BUILD_TYPE=Release',
                 f'-DCMAKE_INSTALL_PREFIX={installed}', '-DCMAKE_CXX_STANDARD=17',
                 '-DEXECUTORCH_BUILD_EXTENSION_MODULE=ON', '-DEXECUTORCH_BUILD_EXTENSION_NAMED_DATA_MAP=ON',
                 '-DEXECUTORCH_BUILD_EXTENSION_TENSOR=ON', '-DEXECUTORCH_BUILD_EXTENSION_DATA_LOADER=ON',
                 '-DEXECUTORCH_BUILD_XNNPACK=ON', '-DEXECUTORCH_BUILD_TESTS=OFF',
                 f'-DPYTHON_EXECUTABLE={venv}/bin/python'], env=build_env)
        command(['cmake', '--build', build, '--parallel', jobs], env=build_env)
        command(['cmake', '--install', build], env=build_env)
        for archive in (build / 'lib').glob('*.a'):
            target = installed / 'lib' / archive.name
            if not target.exists():
                shutil.copy2(archive, target)
        for config in (installed / 'lib/cmake').rglob('*.cmake'):
            config.write_text(config.read_text().replace(str(build), str(installed)))
        flags += [f'-DEXECUTORCH_DIR={installed}', '-DEXECUTORCH_DELEGATE=xnnpack']
    elif backend != 'nert':
        raise ValueError(f'No provider for {backend}')
    return flags


def native(args):
    if args.backend == 'tensorrt' and not os.environ.get('NEURIPLO_CONTAINER_BUILD'):
        ensure_nvidia_driver(args)
    prefix = args.prefix
    marker = prefix / 'installation.json'
    if marker.exists():
        state = json.loads(marker.read_text())
        if state['backend'] != args.backend:
            raise ValueError('This prefix belongs to another backend; choose a different --prefix')
        if sha(state['binary']) != state['binary_sha256']:
            raise ValueError('Installed runtime changed; use a fresh prefix')
        environment = os.environ | state['environment'] | {'NEURIPLO_INFER_BIN': state['binary']}
        command([sys.executable, Path(state['app']) / 'scripts/validate-stack.py'], cwd=state['app'], env=environment, capture=True)
        print(f'Already installed. Start: {prefix}/bin/neuriplo-ui')
        if args.start:
            command([prefix / 'bin/neuriplo-ui', '--port', args.port])
        return
    if prefix.exists() and any(prefix.iterdir()):
        raise ValueError('Installation directory is not empty; choose a new prefix or remove the failed installation explicitly')
    prefix.mkdir(parents=True, exist_ok=True)
    packages = list(PACKAGES)
    if args.grpc:
        packages += ['protobuf-compiler', 'protobuf-compiler-grpc', 'libprotobuf-dev', 'libgrpc++-dev']
    apt(packages)
    node = install_node(prefix)
    environment = os.environ | {'PATH': f'{node}:{os.environ["PATH"]}', 'LD_LIBRARY_PATH': '',
                                  'PYTHONPATH': '', 'CMAKE_PREFIX_PATH': '', 'CPATH': '', 'LIBRARY_PATH': ''}
    sources = prefix / 'sources'
    sources.mkdir()
    refs = (json.loads(os.environ['NEURIPLO_RELEASES']) if os.environ.get('NEURIPLO_RELEASES') else
            {name: release(name) for name in ('neuriplo-infer', 'neuriplo', 'neuriplo-tasks')})
    commits = {name: clone(name, sources / name, tag) for name, tag in refs.items()}
    infer = sources / 'neuriplo-infer'
    core = sources / 'neuriplo'
    pins = env_file(infer / 'versions.env')
    for name, key in [('videocapture', 'VIDEOCAPTURE_VERSION'), ('neuriplo-kserve-client', 'NEURIPLO_KSERVE_CLIENT_VERSION')]:
        commits[name] = clone(name, sources / name, pins[key])
    versions = env_file(core / 'versions.env')
    print('Released components:', json.dumps(refs, indent=2), flush=True)
    ui_commit = args.ui_commit or command(['git', '-C', args.source, 'rev-parse', 'HEAD'], capture=True).strip()
    app = install_ui(prefix, args.source, ui_commit)
    command(['npm', 'ci'], cwd=app, env=environment)
    command(['npm', 'run', 'build'], cwd=app, env=environment)
    flags = install_sdk(args.backend, prefix, sources, versions, environment, args.jobs)
    build = prefix / 'build'
    configuration = ['cmake', '-S', infer, '-B', build, '-GNinja', '-DCMAKE_BUILD_TYPE=Release',
                     f'-DDEFAULT_BACKEND={args.backend.upper()}', '-DBUILD_TESTS=OFF', '-DENABLE_APP_TESTS=OFF',
                     '-DNEURIPLO_INFER_WITH_VIDEOWRITER=ON', '-DNEURIPLO_INFER_ENABLE_KSERVE=ON',
                     f'-DNEURIPLO_INFER_ENABLE_GRPC={"ON" if args.grpc else "OFF"}',
                     f'-DNEURIPLO_VERSION={refs["neuriplo"]}', f'-DNEURIPLO_TASKS_VERSION={refs["neuriplo-tasks"]}',
                     *flags]
    for name in (*refs, 'videocapture', 'neuriplo-kserve-client'):
        if name != 'neuriplo-infer':
            configuration += [f'-DFETCHCONTENT_SOURCE_DIR_{name.upper()}={sources / name}']
    command(configuration, env=environment)
    if args.remote_allow:
        environment['NEURIPLO_UI_REMOTE_ALLOW'] = args.remote_allow
    environment['NEURIPLO_INFER_BIN'] = str(build / 'app/neuriplo-infer')
    record_command([sys.executable, app / 'scripts/validate-stack.py', '--rebuild'],
                   prefix / 'build-validation.log', cwd=app, env=environment)
    command([sys.executable, app / 'scripts/validate-stack.py'], cwd=app, env=environment, capture=True)
    if args.with_tests:
        environment['PLAYWRIGHT_BROWSERS_PATH'] = str(prefix / 'tools/browsers')
        command(['npm', '--workspace', '@neuriplo-ui/e2e', 'exec', '--', 'playwright', 'install', '--with-deps', 'chromium'], cwd=app, env=environment)
    args.data_dir.mkdir(parents=True, exist_ok=True)
    (prefix / 'bin').mkdir()
    shutil.copy2(args.source / 'scripts/launch.py', prefix / 'launch.py')
    launcher = prefix / 'bin/neuriplo-ui'
    launcher.write_text('#!/bin/sh\nexec python3 ' + shlex.quote(str(prefix / 'launch.py')) + ' "$@"\n')
    launcher.chmod(0o755)
    state = {'backend': args.backend, 'node': str(node), 'app': str(app),
             'binary': environment['NEURIPLO_INFER_BIN'], 'binary_sha256': sha(environment['NEURIPLO_INFER_BIN']),
             'environment': {k: environment[k] for k in ('LD_LIBRARY_PATH', 'OPENVINO_DIR', 'NEURIPLO_UI_REMOTE_ALLOW') if k in environment},
             'data_dir': str(args.data_dir), 'port': args.port, 'releases': refs, 'source_commits': commits, 'ui_commit': ui_commit,
             'sdk_versions': versions}
    marker.write_text(json.dumps(state, indent=2) + '\n')
    print(f'Installed. Start with: {launcher}\nUI: http://127.0.0.1:{args.port}')
    if args.start:
        command([launcher, '--port', args.port])


def docker_command():
    for candidate in [['docker'], ['sudo', 'docker']]:
        if shutil.which(candidate[0]) and subprocess.run([*candidate, 'info'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
            return candidate
    raise ValueError('Docker daemon is unavailable. Start Docker, then rerun the installer.')


def install_docker_engine():
    if shutil.which('docker'):
        return
    apt(['ca-certificates', 'curl'])
    command(privileged(['install', '-m', '0755', '-d', '/etc/apt/keyrings']))
    with tempfile.TemporaryDirectory() as directory:
        key = download('https://download.docker.com/linux/ubuntu/gpg', Path(directory) / 'docker.asc')
        command(privileged(['install', '-m', '0644', key, '/etc/apt/keyrings/neuriplo-docker.asc']))
        listing = Path(directory) / 'neuriplo-docker.list'
        listing.write_text('deb [arch=amd64 signed-by=/etc/apt/keyrings/neuriplo-docker.asc] https://download.docker.com/linux/ubuntu noble stable\n')
        command(privileged(['install', '-m', '0644', listing, '/etc/apt/sources.list.d/neuriplo-docker.list']))
    apt(['docker-ce', 'docker-ce-cli', 'containerd.io', 'docker-buildx-plugin', 'docker-compose-plugin'])
    command(privileged(['systemctl', 'enable', '--now', 'docker']))


def docker(args):
    marker = args.prefix / 'docker-installation.json'
    if args.prefix.exists() and any(args.prefix.iterdir()) and not marker.exists():
        raise ValueError('Docker installation directory is not empty; choose a fresh --prefix')
    if marker.exists() and json.loads(marker.read_text())['backend'] != args.backend:
        raise ValueError('This prefix belongs to another backend; choose a different --prefix')
    install_docker_engine()
    engine = docker_command()
    if args.backend == 'tensorrt':
        ensure_container_gpu(args, engine)
    commit = args.ui_commit or command(['git', '-C', args.source, 'rev-parse', 'HEAD'], capture=True).strip()
    args.prefix.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='context-', dir=args.prefix) as directory:
        context = Path(directory)
        app = context / 'app'
        app.mkdir(exist_ok=True)
        files = copy_overlay(args.source, app)
        (app / 'installer-files.json').write_text(json.dumps(files))
        shutil.copy2(args.source / 'docker/Dockerfile.ui', context / 'Dockerfile')
        refs = {name: release(name) for name in ('neuriplo-infer', 'neuriplo', 'neuriplo-tasks')}
        node = next(v['version'] for v in fetch_json('https://nodejs.org/dist/index.json')
                    if v['version'].startswith('v22.') and v['lts'])
        lock = json.dumps({'releases': refs, 'node': node, 'grpc': args.grpc, 'with_tests': args.with_tests}, sort_keys=True)
        identifier = hashlib.sha256(lock.encode()).hexdigest()[:12]
        image = f'neuriplo-ui:{args.backend}-{commit[:12]}-{identifier}'
        command([*engine, 'build', '--build-arg', f'BACKEND={args.backend}', '--build-arg', f'UI_COMMIT={commit}',
                 '--build-arg', f'BUILD_JOBS={args.jobs}', '--build-arg', f'ENABLE_GRPC={str(args.grpc).lower()}',
                 '--build-arg', f'WITH_TESTS={str(args.with_tests).lower()}', '--build-arg', f'STACK_RELEASES={json.dumps(refs, sort_keys=True)}',
                 '--build-arg', f'NODE_VERSION={node}',
                 *(['--secret', 'id=github_token,env=GH_TOKEN'] if os.environ.get('GH_TOKEN') else []), '-t', image, context])
    args.data_dir.mkdir(parents=True, exist_ok=True)
    launcher = args.prefix / 'neuriplo-ui-docker'
    options = ['--gpus', 'all'] if args.backend == 'tensorrt' else []
    invocation = [*engine, 'run', '--rm', '--init', '--user', f'{os.getuid()}:{os.getgid()}', '-p', f'127.0.0.1:{args.port}:5173',
                  '--mount', f'type=bind,src={args.data_dir},dst=/workspace',
                  '--add-host', 'host.docker.internal:host-gateway',
                  '-e', 'NEURIPLO_UI_REMOTE_ALLOW=localhost,127.0.0.1,host.docker.internal' + (',' + args.remote_allow if args.remote_allow else ''),
                  *options, image,
                  '--host', '0.0.0.0', '--data-dir', '/workspace']
    launcher.write_text('#!/bin/sh\nexec ' + shlex.join(invocation) + ' "$@"\n')
    launcher.chmod(0o755)
    (args.prefix / 'docker-installation.json').write_text(json.dumps({'image': image, 'backend': args.backend, 'command': invocation}, indent=2))
    print(f'Installed. Start with: {launcher}\nUI: http://127.0.0.1:{args.port}')
    if args.start:
        command(invocation)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--style', choices=['native', 'docker'], default='native')
    parser.add_argument('--backend', choices=BACKENDS, default='onnx_runtime')
    parser.add_argument('--prefix', type=Path)
    parser.add_argument('--data-dir', type=Path, default=Path.home() / 'Neuriplo')
    parser.add_argument('--port', type=int, default=5173)
    parser.add_argument('--jobs', type=int, default=min(os.cpu_count() or 2, 4))
    parser.add_argument('--grpc', action='store_true')
    parser.add_argument('--with-tests', action='store_true')
    parser.add_argument('--remote-allow', help='Additional remote metadata hosts or host:port values, comma-separated')
    parser.add_argument('--start', action='store_true')
    parser.add_argument('--install-driver', action='store_true', help='Install a missing NVIDIA host driver; requires reboot')
    parser.add_argument('--allow-docker-restart', action='store_true', help='Allow GPU setup to restart Docker even when containers are running')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--source', type=Path, default=ROOT, help=argparse.SUPPRESS)
    parser.add_argument('--ui-commit', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65534 or args.jobs < 1:
        parser.error('port must be 1024..65534; jobs must be positive')
    args.prefix = (args.prefix or Path.home() / '.local/share/neuriplo-ui' / f'{args.style}-{args.backend}').expanduser().resolve()
    args.data_dir = args.data_dir.expanduser().resolve()
    args.source = args.source.resolve()
    if args.dry_run:
        print(json.dumps({'style': args.style, 'backend': args.backend, 'prefix': str(args.prefix),
                          'workspace': str(args.data_dir), 'system_packages': list(PACKAGES) if args.style == 'native' else ['Docker Engine'],
                          'steps': ['install prerequisites', 'install private Node 22 LTS', 'resolve current releases independently',
                                    'install selected SDK', 'configure fresh native build', 'record clean rebuild provenance',
                                    'install web app packages', 'create managed launcher'],
                          'gpu_host_requirement': 'NVIDIA driver (--install-driver if missing); container toolkit is installed automatically for Docker' if args.backend == 'tensorrt' else None}, indent=2))
        return
    check_platform()
    args.prefix.parent.mkdir(parents=True, exist_ok=True)
    with (args.prefix.parent / f'.{args.prefix.name}.install.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        (native if args.style == 'native' else docker)(args)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('Interrupted.', file=sys.stderr)
        sys.exit(130)
    except (ValueError, OSError, KeyError, StopIteration, subprocess.SubprocessError) as error:
        print(f'Installation failed: {error}', file=sys.stderr)
        sys.exit(1)
