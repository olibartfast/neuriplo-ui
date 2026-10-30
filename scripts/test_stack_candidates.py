import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock

from stack_candidates import load_candidates, verify_candidate, verify_cache_pin, remote_release_commit

SHA = 'a' * 40
REF = 'refs/heads/feature/validated-candidate'


class CandidateTest(unittest.TestCase):
    def load(self, candidates):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'candidate.json'
            path.write_text(json.dumps({'candidates': candidates}))
            return load_candidates(path)

    def test_default_does_not_enable_candidates(self):
        self.assertEqual(load_candidates(None), {})

    def test_full_sha_and_remote_ref_are_required(self):
        expected = {'neuriplo': {'commit': SHA, 'ref': REF}}
        self.assertEqual(self.load(expected), expected)
        for entry in [{'commit': 'develop', 'ref': REF}, {'commit': SHA, 'ref': 'develop'},
                      {'commit': SHA, 'ref': REF, 'skip_checks': True}]:
            with self.subTest(entry=entry), self.assertRaises(ValueError):
                self.load({'neuriplo': entry})
        for candidates in [{}, {'unknown': {'commit': SHA, 'ref': REF}}]:
            with self.assertRaises(ValueError):
                self.load(candidates)

    def test_verifies_the_remote_and_latest_release_ancestry(self):
        run = Mock(side_effect=[f'{SHA}\t{REF}', f'{"b" * 40}\trefs/tags/v0.11.2^{{}}', ''])
        identity = verify_candidate('neuriplo', '/source', SHA, 'v0.11.2', {'commit': SHA, 'ref': REF}, run)
        self.assertIsNone(identity['release'])
        self.assertEqual(identity['baseline_release'], 'v0.11.2')
        self.assertIn('https://github.com/olibartfast/neuriplo.git', run.call_args_list[0].args)
        self.assertIn('merge-base', run.call_args_list[2].args)

    def test_wrong_source_or_remote_is_rejected(self):
        for head, remote in [('b' * 40, f'{SHA}\t{REF}'), (SHA, f'{"b" * 40}\t{REF}'), (SHA, '')]:
            with self.subTest(head=head, remote=remote), self.assertRaises(ValueError):
                verify_candidate('neuriplo', '/source', head, 'v0.11.2',
                                 {'commit': SHA, 'ref': REF}, Mock(return_value=remote))

    def test_old_baseline_is_rejected(self):
        run = Mock(side_effect=[f'{SHA}\t{REF}', f'{"b" * 40}\trefs/tags/v0.11.2^{{}}', subprocess.CalledProcessError(1, 'git merge-base')])
        with self.assertRaises(subprocess.CalledProcessError):
            verify_candidate('neuriplo', '/source', SHA, 'v0.11.2', {'commit': SHA, 'ref': REF}, run)

    def test_annotated_release_resolves_to_peeled_commit(self):
        run = Mock(return_value=f'{"c" * 40}\trefs/tags/v1.2.3\n{"b" * 40}\trefs/tags/v1.2.3^{{}}')
        self.assertEqual(remote_release_commit('neuriplo', 'v1.2.3', run), 'b' * 40)
        with self.assertRaises(ValueError):
            remote_release_commit('neuriplo', 'v1.2.3', Mock(return_value=''))

    def test_candidate_dependencies_require_exact_cache_pins(self):
        candidates = {'neuriplo': {'commit': SHA, 'ref': REF}}
        versions = {'neuriplo': '0.11.2', 'neuriplo-infer': '0.11.3'}
        verify_cache_pin('NEURIPLO_VERSION', SHA, 'neuriplo', versions, candidates)
        verify_cache_pin('CMAKE_PROJECT_VERSION', '0.11.3', 'neuriplo-infer', versions, candidates)
        for value in ['develop', 'v0.11.2', 'b' * 40]:
            with self.assertRaises(ValueError):
                verify_cache_pin('NEURIPLO_VERSION', value, 'neuriplo', versions, candidates)
        with self.assertRaises(ValueError):
            verify_cache_pin('NEURIPLO_VERSION', SHA, 'neuriplo', versions, {})


if __name__ == '__main__':
    unittest.main()
