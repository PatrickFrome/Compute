#!/usr/bin/env python3
"""Restore the exact source snapshot and check the standalone patch locally.

No network, installation, database, service, or global Git configuration writes.
The destination must be a new directory. Product tests are separate.
"""
import argparse
import hashlib
import os
from pathlib import Path, PurePosixPath
import stat
import subprocess
import zipfile

ARCHIVE_SHA256 = '4200e492828dbb857aaa737a7ce56d0aeda3c97c84f7743b1501ef2f229d3636'
BASE_TREE = '2dbe253e97379532f6f4b52ef7edf26109a9266d'
PATCH_SHA256 = '30ad950804fcb9326d6cdab42876c1309386a455480cd350f74e06295fbed95f'
RESULT_TREE = '81b533622571c1b6e7509cbcfe7fa3b59452a17d'


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args], text=True).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('destination', type=Path)
    parser.add_argument('patch', type=Path)
    args = parser.parse_args()
    archive, target, patch = (p.resolve() for p in (args.archive, args.destination, args.patch))
    if digest(archive) != ARCHIVE_SHA256:
        raise SystemExit('Archive SHA256 mismatch')
    if digest(patch) != PATCH_SHA256:
        raise SystemExit('Patch SHA256 mismatch')
    if target.exists():
        raise SystemExit('Destination must not exist')
    with zipfile.ZipFile(archive) as source:
        entries = source.infolist()
        for entry in entries:
            path = PurePosixPath(entry.filename)
            if (path.is_absolute() or '..' in path.parts or not path.parts
                    or path.parts[0] != 'Compute' or '\\' in entry.filename
                    or stat.S_ISLNK(entry.external_attr >> 16)):
                raise SystemExit('Unexpected archive entry')
        if source.testzip() is not None:
            raise SystemExit('Archive CRC failure')
        target.mkdir()
        source.extractall(target)
        for entry in entries:
            path = target / entry.filename
            if path.is_file():
                os.chmod(path, 0o755 if (entry.external_attr >> 16) & 0o111 else 0o644)
    repo = target / 'Compute'
    git(repo, 'init', '-q')
    git(repo, 'add', '-A')
    if git(repo, 'write-tree') != BASE_TREE:
        raise SystemExit('Restored base tree mismatch')
    git(repo, 'apply', '--check', str(patch))
    git(repo, 'apply', '--index', str(patch))
    if git(repo, 'write-tree') != RESULT_TREE:
        raise SystemExit('Patched tree mismatch')
    print('Archive SHA256, patch SHA256, clean applicability and both trees: PASS')
    print('Restored source:', repo)
    print('Product tests, native Windows and live Codex login: not run by this helper')


if __name__ == '__main__':
    main()
