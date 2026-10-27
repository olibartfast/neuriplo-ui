"""Resolve current public releases without weakening release/provenance checks."""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request


def latest_release(name):
    if not re.fullmatch(r'[A-Za-z0-9_.-]+', name):
        raise ValueError('Invalid GitHub repository name')
    headers = {'User-Agent': 'neuriplo-ui-release-resolution'}
    if os.environ.get('GH_TOKEN'):
        headers['Authorization'] = 'Bearer ' + os.environ['GH_TOKEN']
    api = f'https://api.github.com/repos/olibartfast/{name}/releases/latest'
    try:
        with urllib.request.urlopen(urllib.request.Request(api, headers=headers), timeout=60) as response:
            tag = json.load(response)['tag_name']
    except urllib.error.HTTPError as error:
        if error.code not in (403, 429) or error.headers.get('X-RateLimit-Remaining') != '0':
            raise
        # GitHub's public latest-release redirect has the same release authority,
        # without the REST API quota. Never use cached tags or guess from VERSION.
        print('GitHub API quota exhausted; resolving the current public release via GitHub.', file=sys.stderr)
        web = f'https://github.com/olibartfast/{name}/releases/latest'
        with urllib.request.urlopen(urllib.request.Request(web, method='HEAD'), timeout=60) as response:
            target = urllib.parse.urlsplit(response.geturl())
        prefix = f'/olibartfast/{name}/releases/tag/'
        if target.scheme != 'https' or target.netloc != 'github.com' or not target.path.startswith(prefix):
            raise ValueError('GitHub did not resolve a release for the expected repository')
        tag = urllib.parse.unquote(target.path[len(prefix):])
    if not isinstance(tag, str) or not re.fullmatch(r'v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?', tag):
        raise ValueError('GitHub release must have a concrete semantic version tag')
    return tag
