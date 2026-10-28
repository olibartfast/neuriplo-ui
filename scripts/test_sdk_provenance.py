from pathlib import Path
import tempfile
import unittest

from sdk_provenance import libtorch_sdk


class LibTorchSdkTests(unittest.TestCase):
    def check_layout(self, modern):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'build-version').write_text('2.14.0+cpu\n')
            legacy = root / 'include/torch/csrc/api/include/torch/version.h'
            legacy.parent.mkdir(parents=True)
            version = '#define TORCH_VERSION_MAJOR 2\n#define TORCH_VERSION_MINOR 14\n#define TORCH_VERSION_PATCH 0\n'
            if modern:
                legacy.write_text('#include <torch/headeronly/version.h>\n')
                header = root / 'include/torch/headeronly/version.h'
                header.parent.mkdir(parents=True); header.write_text(version)
            else:
                legacy.write_text(version)
            report = libtorch_sdk(root, '2.14.0')
            self.assertEqual(report['build'], '2.14.0+cpu')
            self.assertEqual(len(report['headers_sha256']), 2 if modern else 1)
            legacy.write_text('#define TORCH_VERSION_MAJOR 1\n')
            if not modern:
                with self.assertRaisesRegex(ValueError, 'Cannot identify'):
                    libtorch_sdk(root, '2.14.0')
            with self.assertRaisesRegex(ValueError, 'release pin'):
                libtorch_sdk(root, '2.15.0')

    def test_legacy_header_layout(self):
        self.check_layout(False)

    def test_headeronly_redirect_layout(self):
        self.check_layout(True)


class LiteRtSdkTests(unittest.TestCase):
    def test_abseil_symbols_are_loaded_before_runtime_version_query(self):
        from unittest.mock import Mock, patch
        from sdk_provenance import litert_sdk
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); lib = root / 'lib'; lib.mkdir()
            for name in ('libabsl_a.so', 'libabsl_z.so', 'libtensorflow-lite.so'):
                (lib / name).write_text('unit fixture')
            loaded = set(); library = Mock(); library.TfLiteVersion.return_value = b'2.19.0'
            def load(path, **kwargs):
                name = Path(path).name
                if name == 'libabsl_a.so' and 'libabsl_z.so' not in loaded:
                    raise OSError('unresolved dependency')
                if name == 'libtensorflow-lite.so':
                    self.assertEqual(loaded, {'libabsl_a.so', 'libabsl_z.so'})
                    return library
                loaded.add(name)
                return Mock()
            with patch('sdk_provenance.ctypes.CDLL', side_effect=load):
                report = litert_sdk(root, '2.19.0')
            self.assertEqual(report['version'], '2.19.0')
            self.assertEqual(len(report['probe_shared_libraries']), 2)

    def test_unresolved_abseil_dependencies_fail_closed(self):
        from unittest.mock import patch
        from sdk_provenance import litert_sdk
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'lib').mkdir()
            (root / 'lib/libabsl_broken.so').write_text('unit fixture')
            with patch('sdk_provenance.ctypes.CDLL', side_effect=OSError('missing symbol')):
                with self.assertRaisesRegex(ValueError, 'Cannot load LiteRT Abseil dependencies'):
                    litert_sdk(root, '2.19.0')
