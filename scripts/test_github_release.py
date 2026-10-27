import io
import unittest
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError

import github_release as releases


class ReleaseResolutionTests(unittest.TestCase):
    def test_uses_the_latest_published_release(self):
        with patch.object(releases.urllib.request, 'urlopen', return_value=io.BytesIO(b'{"tag_name":"v0.11.2"}')):
            self.assertEqual(releases.latest_release('neuriplo-infer'), 'v0.11.2')

    def test_rate_limit_uses_the_official_latest_release_redirect(self):
        error = HTTPError('https://api.github.com', 403, 'rate limit', {'X-RateLimit-Remaining': '0'}, None)
        response = MagicMock()
        response.__enter__.return_value.geturl.return_value = 'https://github.com/olibartfast/neuriplo-infer/releases/tag/v0.11.2'
        with patch.object(releases.urllib.request, 'urlopen', side_effect=[error, response]) as fetch:
            self.assertEqual(releases.latest_release('neuriplo-infer'), 'v0.11.2')
        self.assertEqual(fetch.call_args.args[0].get_method(), 'HEAD')
        self.assertEqual(fetch.call_args.args[0].full_url, 'https://github.com/olibartfast/neuriplo-infer/releases/latest')

    def test_permission_failure_does_not_fall_back(self):
        error = HTTPError('https://api.github.com', 403, 'forbidden', {'X-RateLimit-Remaining': '42'}, None)
        with patch.object(releases.urllib.request, 'urlopen', side_effect=error) as fetch:
            with self.assertRaises(HTTPError):
                releases.latest_release('neuriplo-infer')
        self.assertEqual(fetch.call_count, 1)

    def test_unexpected_redirect_cannot_substitute_a_release(self):
        error = HTTPError('https://api.github.com', 403, 'rate limit', {'X-RateLimit-Remaining': '0'}, None)
        for url in ['https://example.com/olibartfast/neuriplo-infer/releases/tag/v9.0.0',
                    'https://github.com/other/neuriplo-infer/releases/tag/v9.0.0',
                    'https://github.com/olibartfast/neuriplo-infer/releases/latest']:
            response = MagicMock()
            response.__enter__.return_value.geturl.return_value = url
            with patch.object(releases.urllib.request, 'urlopen', side_effect=[error, response]):
                with self.assertRaises(ValueError):
                    releases.latest_release('neuriplo-infer')

    def test_a_floating_tag_is_rejected(self):
        with patch.object(releases.urllib.request, 'urlopen', return_value=io.BytesIO(b'{"tag_name":"master"}')):
            with self.assertRaises(ValueError):
                releases.latest_release('neuriplo-infer')


if __name__ == '__main__':
    unittest.main()
