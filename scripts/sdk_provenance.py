"""Read vendor SDK identity from installed files, independent of CMake cache pins."""
import ctypes
import hashlib
from pathlib import Path
import re


def libtorch_sdk(prefix, expected):
    prefix = Path(prefix)
    build = (prefix / 'build-version').read_text().strip()
    if build.split('+')[0] != expected:
        raise ValueError(f'Installed LibTorch {build} differs from release pin {expected}')
    legacy = prefix / 'include/torch/csrc/api/include/torch/version.h'
    modern = prefix / 'include/torch/headeronly/version.h'
    header = modern if modern.exists() else legacy
    components = dict(re.findall(r'^\s*#\s*define\s+TORCH_VERSION_(MAJOR|MINOR|PATCH)\s+(\d+)',
                                 header.read_text(), re.M))
    if set(components) != {'MAJOR', 'MINOR', 'PATCH'}:
        raise ValueError(f'Cannot identify LibTorch version in {header}')
    actual = '.'.join(components[k] for k in ('MAJOR', 'MINOR', 'PATCH'))
    if actual != expected:
        raise ValueError(f'LibTorch headers {actual} differ from release pin {expected}')
    headers = [p for p in (legacy, modern) if p.exists()]
    hashes = {}
    for path in headers:
        with path.open('rb') as stream:
            hashes[str(path)] = hashlib.file_digest(stream, 'sha256').hexdigest()
    return {'build': build, 'headers_sha256': hashes}


def litert_sdk(prefix, expected):
    prefix = Path(prefix)
    # The C++ executable also links Abseil archives/shared libraries. Loading
    # only libtensorflow-lite.so in Python omits that ELF symbol context.
    dependencies = sorted((prefix / 'lib').glob('libabsl_*.so'))
    pending = dependencies.copy()
    while pending:
        loaded = []
        for path in pending:
            try:
                ctypes.CDLL(str(path), mode=ctypes.RTLD_GLOBAL)
                loaded.append(path)
            except OSError:
                continue
        if not loaded:
            raise ValueError('Cannot load LiteRT Abseil dependencies: ' + ', '.join(map(str, pending)))
        pending = [p for p in pending if p not in loaded]
    runtime = prefix / 'lib/libtensorflow-lite.so'
    library = ctypes.CDLL(str(runtime))
    library.TfLiteVersion.restype = ctypes.c_char_p
    actual = library.TfLiteVersion().decode()
    if actual != expected:
        raise ValueError(f'Installed LiteRT {actual} differs from release pin {expected}')
    hashes = {}
    for path in [runtime, *dependencies]:
        with path.open('rb') as stream:
            hashes[str(path)] = hashlib.file_digest(stream, 'sha256').hexdigest()
    return {'version': actual, 'runtime_sha256': hashes.pop(str(runtime)),
            'probe_shared_libraries': hashes}
