"""Verify explicit prerelease candidates without weakening release validation."""
import json
from pathlib import Path
import re

COMPONENTS = {'neuriplo-infer', 'neuriplo', 'neuriplo-tasks'}


def load_candidates(path):
    if path is None:
        return {}
    document = json.loads(Path(path).read_text())
    if set(document) != {'candidates'} or not isinstance(document['candidates'], dict):
        raise ValueError('Candidate manifest must contain a candidates object')
    candidates = document['candidates']
    if not candidates or not set(candidates).issubset(COMPONENTS):
        raise ValueError('Candidate manifest contains no supported components or unknown components')
    for name, entry in candidates.items():
        if not isinstance(entry, dict) or set(entry) != {'commit', 'ref'}:
            raise ValueError(f'{name}: expected an exact commit and remote branch ref')
        if not isinstance(entry['commit'], str) or not re.fullmatch(r'[0-9a-f]{40}', entry['commit']):
            raise ValueError(f'{name}: candidate commit must be a full SHA')
        if not isinstance(entry['ref'], str) or not re.fullmatch(r'refs/heads/[A-Za-z0-9_.\-/]+', entry['ref']):
            raise ValueError(f'{name}: candidate must name a remote branch ref')
    return candidates


def remote_release_commit(name, release, run):
    ref = f'refs/tags/{release}'
    lines = run('git', 'ls-remote', f'https://github.com/olibartfast/{name}.git', ref, ref + '^{}')
    refs = dict((parts[1], parts[0]) for line in lines.splitlines() if len(parts := line.split()) == 2)
    commit = refs.get(ref + '^{}', refs.get(ref, ''))
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError(f'{name}: cannot resolve the official release commit for {release}')
    return commit


def verify_candidate(name, source, head, release, candidate, run):
    if head != candidate['commit']:
        raise ValueError(f'{name}: source does not match the candidate SHA')
    remote = run('git', 'ls-remote', f'https://github.com/olibartfast/{name}.git', candidate['ref'])
    if remote.split() != [head, candidate['ref']]:
        raise ValueError(f'{name}: candidate SHA does not match its declared remote branch')
    # A candidate must contain the latest release, preventing an old checkout
    # from being relabelled as a current candidate.
    baseline = remote_release_commit(name, release, run)
    run('git', '-C', str(source), 'merge-base', '--is-ancestor', baseline, head)
    return {'source': str(source), 'commit': head, 'release': None,
            'candidate_ref': candidate['ref'], 'baseline_release': release}


def verify_cache_pin(key, observed, name, versions, candidates):
    expected = candidates[name]['commit'] if name in candidates and key != 'CMAKE_PROJECT_VERSION' else versions[name]
    if observed.removeprefix('v') != expected.removeprefix('v'):
        raise ValueError(f'{key}: stale cache {observed}, expected {expected}')
