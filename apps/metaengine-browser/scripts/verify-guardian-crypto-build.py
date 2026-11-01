#!/usr/bin/env python3
"""Check byte agreement after a fresh producer invocation, not build provenance.

Only guardian-static-crypto.psm1's live same-process context authorizes linking.
This checker accepts no alternative lock, source root, header, or archive names.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
LOCK = 'native/openssl/guardian-openssl-source-lock.json'
NATIVE = 'native/browser-guardian-scm/'


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def require(condition, reason):
    if not condition:
        raise ValueError('guardian_crypto_' + reason)


def regular(path):
    path = Path(path)
    for ancestor in [path, *path.parents]:
        require(not ancestor.is_symlink() and not (getattr(ancestor.lstat(), 'st_file_attributes', 0) & 0x400), 'reparse_input')
    require(path.is_file(), 'file_missing:' + path.name)
    return path


def read_json(path):
    return json.loads(regular(path).read_text(encoding='utf-8-sig'))


def inventory(root, rows):
    require(type(rows) is list and len(rows) > 0, 'inventory_empty')
    result = {}
    for row in rows:
        name = row['path']
        require(isinstance(name, str) and re.fullmatch(r'[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*', name)
                and all(p not in ('.', '..') for p in name.split('/')), 'inventory_path')
        require(name.casefold() not in {s.casefold() for s in result}, 'inventory_duplicate')
        file = regular(root / name)
        require(type(row['size_bytes']) is int and file.stat().st_size == row['size_bytes'], 'artifact_size:' + name)
        require(digest(file) == row['sha256'], 'artifact_digest:' + name)
        result[name] = row['sha256']
    actual = set()
    for file in root.rglob('*'):
        require(not file.is_symlink() and not (getattr(file.lstat(), 'st_file_attributes', 0) & 0x400), 'reparse_artifact')
        if file.is_file():
            actual.add(file.relative_to(root).as_posix())
    require(actual == set(result), 'inventory_membership')
    return result


def verify(build, source, head, expected_proof=None):
    build, source = Path(build), Path(source)
    proof_path = regular(build / 'openssl-static-build-proof.json')
    proof_sha = digest(proof_path)
    if expected_proof is not None:
        require(proof_sha == expected_proof, 'producer_proof_changed')
    proof = read_json(proof_path)
    lock = read_json(ROOT / LOCK)
    lock_sha = digest(ROOT / LOCK)
    require(proof['schema'] == 'metaengine.browser.guardian-openssl-static-build.v1', 'proof_schema')
    require(proof['source_head'] == head and re.fullmatch('[a-f0-9]{40}', head), 'source_head')
    require(proof['source_lock_sha256'] == lock_sha, 'lock_digest')
    require(proof['configure_args'] == lock['configure_args'] and proof['runtime_library'] == '/MT', 'profile')
    require(proof['openssl_source_sha256'] == lock['openssl']['archive']['sha256'], 'source_digest')
    for component, member in [('openssl', 'archive'), ('openssl', 'signature'), ('nasm', 'archive')]:
        pin = lock[component][member]
        file = regular(source / pin['filename'])
        require(file.stat().st_size == pin['size_bytes'] and digest(file) == pin['sha256'], 'pinned_source_bytes')
    for file in [source / 'guardian-openssl-source-lock.json', build / 'evidence/guardian-openssl-source-lock.json']:
        require(digest(regular(file)) == lock_sha, 'handoff_lock')
    acquired = read_json(source / 'source-verification.json')
    reverified = read_json(build / 'evidence/source-reverification/source-verification.json')
    require(digest(regular(build / 'evidence/source-verification.json')) == digest(source / 'source-verification.json'), 'acquisition_copy')
    require(reverified['producer_evidence_sha256'] == digest(source / 'source-verification.json'), 'reverification_producer')
    for receipt, directory in [(acquired, source), (reverified, build / 'evidence/source-reverification')]:
        require(receipt['schema'] == 'metaengine.guardian-openssl-source-verification.v1'
                and receipt['source_head'] == head and receipt['lock_sha256'] == lock_sha, 'source_evidence')
        require(receipt['gpg_status_sha256'] == digest(regular(directory / 'gpg-status.txt')), 'gpg_status_bytes')
        for key in ['signing_primary_fingerprint', 'signing_subkey_fingerprint']:
            require(receipt['openssl'][key] == lock['openssl'][key], 'signer_identity')
        require(receipt['openssl']['archive_sha256'] == lock['openssl']['archive']['sha256']
                and receipt['openssl']['signature_sha256'] == lock['openssl']['signature']['sha256']
                and receipt['nasm']['archive_sha256'] == lock['nasm']['archive']['sha256'], 'source_evidence_pins')
        require(receipt['certificate_sha256'] == digest(regular(source / 'openssl-release-signers.asc')), 'certificate_digest')
    require(reverified['verification_mode'] == 'offline_local_reverification' and reverified['network_used'] is False, 'reverification_mode')
    require(digest(regular(build / 'evidence/openssl-release-signers.asc')) == acquired['certificate_sha256'], 'certificate_copy')
    require(proof['native_verifier_source_sha256'] == digest(ROOT / (NATIVE + 'browser-guardian-release-signature.cpp')), 'verifier_source')
    crypto_root = build / 'artifacts/openssl-static'
    signature_root = build / 'artifacts/guardian-signature'
    crypto = inventory(crypto_root, proof['files'])
    signature = inventory(signature_root, proof['native_verifier_files'])
    require(set(signature) == {'include/browser-guardian-release-signature.hpp', 'lib/guardian-release-signature.lib'}, 'signature_inventory')
    header_sha = digest(ROOT / (NATIVE + 'browser-guardian-release-signature.hpp'))
    require(signature['include/browser-guardian-release-signature.hpp'] == header_sha, 'public_header')
    for path in [crypto_root / 'lib/libcrypto.lib', signature_root / 'lib/guardian-release-signature.lib']:
        with regular(path).open('rb') as stream:
            require(stream.read(8) == b'!<arch>\n' and path.stat().st_size > 68, 'static_archive')
    require('include/openssl/evp.h' in crypto and 'include/openssl/configuration.h' in crypto, 'crypto_headers')
    return dict(contract='metaengine.guardian.static-crypto-link-input.v1', build_source_head=head,
                producer_proof_sha256=proof_sha, source_lock_sha256=lock_sha,
                verifier_source_sha256=proof['native_verifier_source_sha256'], public_header_sha256=header_sha,
                libcrypto_sha256=crypto['lib/libcrypto.lib'], verifier_archive_sha256=signature['lib/guardian-release-signature.lib'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build', required=True)
    parser.add_argument('--source', required=True)
    parser.add_argument('--expected-proof')
    args = parser.parse_args()
    head = subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip()
    require(not subprocess.check_output(['git', '-C', str(ROOT), 'status', '--porcelain', '--untracked-files=all'], text=True).strip(), 'checkout_dirty')
    print(json.dumps(verify(args.build, args.source, head, args.expected_proof), separators=(',', ':')))


if __name__ == '__main__':
    main()
