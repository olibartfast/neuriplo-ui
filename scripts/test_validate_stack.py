import copy
import io
import json
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch

spec = importlib.util.spec_from_file_location('gate', Path(__file__).with_name('validate-stack.py'))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class ProvenanceTests(unittest.TestCase):
    def setUp(self):
        self.record = {'binary_sha256': 'original', 'cache_sha256': 'configured',
                       'sources': {'tasks': {'commit': 'release'}}}

    def test_fixture_only_gate_skips_without_a_real_binary(self):
        with patch.dict(gate.os.environ, {}, clear=True), \
                patch('sys.argv', ['validate-stack.py', '--if-configured']), \
                patch.object(gate, 'ui_identity') as identity:
            gate.main()
            identity.assert_not_called()

    def test_strict_gate_does_not_allow_fixture_only_skip(self):
        with patch.dict(gate.os.environ, {}, clear=True), \
                patch('sys.argv', ['validate-stack.py']), \
                patch.object(gate, 'ui_identity', return_value={}):
            with self.assertRaises(KeyError):
                gate.main()

    def test_current_ui_is_accepted(self):
        gate.verify_ui_revision(True)

    def test_stale_ui_is_blocked(self):
        with self.assertRaisesRegex(ValueError, "UI checkout is behind"):
            gate.verify_ui_revision(False)

    def test_runtime_version_is_queried_from_loaded_library(self):
        for symbol in ('TF_Version', 'TfLiteVersion'):
            library = MagicMock()
            getattr(library, symbol).return_value = b'2.19.0'
            with patch.object(gate.ctypes, 'CDLL', return_value=library):
                self.assertEqual(gate.verify_runtime_version('/sdk/lib.so', symbol, '2.19.0'), '2.19.0')
                with self.assertRaisesRegex(ValueError, 'expected 2.20.0'):
                    gate.verify_runtime_version('/sdk/lib.so', symbol, '2.20.0')

    def test_new_backend_pins_do_not_require_sdk_versions_in_cmake_cache(self):
        # Regression: these vendor versions are normal CMake variables, not
        # cache entries. A configured build still has the clean release pins.
        for backend in ('libtorch', 'libtensorflow', 'litert'):
            with self.subTest(backend=backend), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                build = root / 'build'; binary = build / 'app/neuriplo-infer'
                binary.parent.mkdir(parents=True); binary.write_text('unit fixture')
                (build / 'CMakeCache.txt').write_text('unit fixture')
                values = {'CMAKE_PROJECT_VERSION': '0.11.2', 'NEURIPLO_VERSION': '0.11.1',
                          'NEURIPLO_TASKS_VERSION': '0.8.2'}
                releases = {'neuriplo-infer': '0.11.2', 'neuriplo': '0.11.1', 'neuriplo-tasks': '0.8.2'}
                for name, version in releases.items():
                    source = root / name; source.mkdir()
                    (source / 'VERSION').write_text(version)
                    values[name + '_SOURCE_DIR'] = str(source)
                (root / 'neuriplo/versions.env').write_text(
                    'PYTORCH_VERSION=2.14.0\nTENSORFLOW_VERSION=2.19.0\nLITERT_VERSION=2.19.0\n')
                sdk = root / 'sdk'; (sdk / 'lib').mkdir(parents=True)
                for key in ('LIBTORCH_DIR', 'TENSORFLOW_DIR', 'LITERT_DIR'):
                    values[key] = str(sdk)
                (sdk / 'build-version').write_text('2.14.0+cpu')
                header = sdk / 'include/torch/csrc/api/include/torch/version.h'
                header.parent.mkdir(parents=True); header.write_text('#define TORCH_VERSION_MAJOR 2\n#define TORCH_VERSION_MINOR 14\n#define TORCH_VERSION_PATCH 0\n')
                runtime = sdk / 'lib' / {'libtorch': 'libtorch_cpu.so',
                    'libtensorflow': 'libtensorflow_cc.so.2', 'litert': 'libtensorflow-lite.so'}[backend]
                runtime.write_text('unit fixture')
                caps = {'producer': {'version': '0.11.2'},
                        'execution': {'workflows': [{'backends': [backend]}]}}
                def run(*args):
                    if args[0] == 'git':
                        return '' if 'status' in args else 'released-commit'
                    return f'{runtime} (0x1)' if args[0] == 'ldd' else json.dumps(caps)
                library = MagicMock()
                library.TF_Version.return_value = b'2.19.0'
                library.TfLiteVersion.return_value = b'2.19.0'
                with patch.dict(gate.os.environ, {'NEURIPLO_INFER_BIN': str(binary)}), \
                        patch('sys.argv', ['validate-stack.py', '--rebuild']), \
                        patch.object(gate, 'ui_identity', return_value={}), \
                        patch.object(gate, 'cache_values', return_value=values), \
                        patch.object(gate, 'latest_release', side_effect=lambda n: 'v' + releases[n]), \
                        patch.object(gate, 'run', side_effect=run), \
                        patch.object(gate.subprocess, 'run'), \
                        patch.object(gate.ctypes, 'CDLL', return_value=library), \
                        patch('sys.stdout', new_callable=io.StringIO) as output:
                    gate.main()
                    self.assertEqual(json.loads(output.getvalue())['status'], 'verified')

    def test_matching_record(self):
        gate.verify_record(self.record, copy.deepcopy(self.record))

    def test_replaced_executable_is_rejected(self):
        changed = copy.deepcopy(self.record)
        changed['binary_sha256'] = 'replacement'
        with self.assertRaises(ValueError):
            gate.verify_record(self.record, changed)

    def test_changed_dependency_is_rejected(self):
        changed = copy.deepcopy(self.record)
        changed['sources']['tasks']['commit'] = 'different'
        with self.assertRaises(ValueError):
            gate.verify_record(self.record, changed)

    def test_changed_cache_is_rejected(self):
        changed = copy.deepcopy(self.record)
        changed['cache_sha256'] = 'old-pins'
        with self.assertRaises(ValueError):
            gate.verify_record(self.record, changed)

    def test_cmake_paths_and_values(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'CMakeCache.txt'
            path.write_text('// comment: text=value\nA:PATH=/a path\nB:STRING=x=y\n')
            self.assertEqual(gate.cache_values(path), {'A': '/a path', 'B': 'x=y'})


if __name__ == '__main__':
    unittest.main()
