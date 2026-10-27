import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

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
