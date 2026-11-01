#!/usr/bin/env python3
"""Acquire hash-locked build inputs; authenticate OpenSSL with its release key.

The caller supplies the public release certificate. No keyserver access, trust
root creation, installation, or automatic retries happen here. A successful
source verification is preparation evidence, not Windows or production approval.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request


DEFAULT_LOCK = Path(__file__).resolve().parents[1] / 'native' / 'openssl' / 'guardian-openssl-source-lock.json'
REPOSITORY = Path(__file__).resolve().parents[3]
LOCK_SCHEMA = 'metaengine.guardian-openssl-source-lock.v1'
EVIDENCE_SCHEMA = 'metaengine.guardian-openssl-source-verification.v1'
UNSAFE_GPG_STATUSES = frozenset({
    'BADSIG', 'ERRSIG', 'EXPSIG', 'EXPKEYSIG', 'REVKEYSIG', 'KEYEXPIRED',
    'SIGEXPIRED', 'KEYREVOKED', 'NO_PUBKEY', 'FAILURE', 'NODATA', 'UNEXPECTED',
})


class AcquisitionError(RuntimeError):
    pass


def sha256_file(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def load_lock(path):
    lock = json.loads(Path(path).read_text(encoding='utf-8'))
    if lock.get('schema') != LOCK_SCHEMA:
        raise AcquisitionError('source_lock_schema_invalid')
    for component, member in [('openssl', 'archive'), ('openssl', 'signature'), ('nasm', 'archive')]:
        spec = lock[component][member]
        name = spec.get('filename', '')
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]+', name) or name in {'.', '..'}:
            raise AcquisitionError('source_lock_filename_invalid')
        if not re.fullmatch(r'[0-9a-f]{64}', spec.get('sha256', '')):
            raise AcquisitionError('source_lock_digest_invalid')
        if type(spec.get('size_bytes')) is not int or spec['size_bytes'] <= 0:
            raise AcquisitionError('source_lock_size_invalid')
        url = urllib.parse.urlsplit(spec.get('url', ''))
        if url.scheme != 'https' or url.hostname not in {'github.com', 'codeload.github.com'} or url.username or url.password or url.fragment:
            raise AcquisitionError('source_lock_url_invalid')
    for name in ['signing_primary_fingerprint', 'signing_subkey_fingerprint']:
        if not re.fullmatch(r'[A-F0-9]{40}', lock['openssl'].get(name, '')):
            raise AcquisitionError('source_lock_fingerprint_invalid')
    return lock


def verify_file(path, spec):
    path = Path(path)
    if not path.is_file() or path.stat().st_size != spec['size_bytes']:
        raise AcquisitionError(f'source_size_mismatch:{spec["filename"]}')
    actual = sha256_file(path)
    if actual != spec['sha256']:
        raise AcquisitionError(f'source_sha256_mismatch:{spec["filename"]}')
    return actual


def download_file(spec, destination):
    """Download once, limit bytes, verify, then atomically install this file."""
    destination = Path(destination)
    fd, temp_name = tempfile.mkstemp(prefix='.guardian-source-', dir=destination.parent)
    temporary = Path(temp_name)
    try:
        total = 0
        request = urllib.request.Request(spec['url'], headers={'User-Agent': 'METAENGINE-Guardian-source-verification/1'})
        with os.fdopen(fd, 'wb') as output, urllib.request.urlopen(request, timeout=60) as response:
            while chunk := response.read(1024 * 1024):
                total += len(chunk)
                if total > spec['size_bytes']:
                    raise AcquisitionError(f'source_size_exceeded:{spec["filename"]}')
                output.write(chunk)
        verify_file(temporary, spec)
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def _gpg_uses_msys_paths(gpg_binary):
    """Git for Windows ships an MSYS GPG; native Windows Python does not convert its argv."""
    if os.name != 'nt':
        return False
    executable = shutil.which(os.fspath(gpg_binary))
    return bool(executable and (Path(executable).resolve().parent / 'msys-2.0.dll').is_file())


def _msys_gpg_argument(value):
    """Give MSYS GPG POSIX drive paths; never let it treat C:\foo as relative."""
    raw = os.fspath(value)
    matched = re.fullmatch(r'([A-Za-z]):[\\/](.*)', raw, flags=re.DOTALL)
    if matched:
        return '/' + matched.group(1).lower() + '/' + matched.group(2).replace('\\', '/')
    if raw.startswith(('\\', '//')) or re.match(r'^[A-Za-z]:', raw):
        raise AcquisitionError('msys_gpg_unanchored_or_unc_path_unsupported')
    return raw


def gpg_command(home, *arguments, gpg_binary='gpg'):
    binary = os.fspath(gpg_binary)
    if _gpg_uses_msys_paths(binary):
        home_path = _msys_gpg_argument(home)
        parameters = [_msys_gpg_argument(value) for value in arguments]
    else:
        home_path = os.fspath(home)
        parameters = [os.fspath(value) for value in arguments]
    return [
        binary, '--no-options', '--homedir', home_path, '--batch', '--no-tty',
        '--no-autostart', '--no-auto-key-retrieve', '--auto-key-locate', 'clear', *parameters,
    ]


def verify_certificate_listing(listing, primary_fingerprint, signing_fingerprint):
    """Check full fingerprints and subkey ownership in machine-readable GPG output."""
    current_primary = None
    primary_invalid = True
    pending_record = None
    found = False
    for line in listing.splitlines():
        fields = line.split(':')
        kind = fields[0]
        if kind == 'pub':
            current_primary = None
            primary_invalid = len(fields) < 2 or fields[1] in {'r', 'e', 'd', 'i'}
            pending_record = ('pub', primary_invalid)
        elif kind == 'sub':
            pending_record = ('sub', len(fields) < 2 or fields[1] in {'r', 'e', 'd', 'i'})
        elif kind == 'fpr' and pending_record:
            fingerprint = fields[9] if len(fields) > 9 else ''
            if pending_record[0] == 'pub':
                current_primary = fingerprint
            elif (current_primary == primary_fingerprint and fingerprint == signing_fingerprint
                  and not primary_invalid and not pending_record[1]):
                found = True
            pending_record = None
    if not found:
        raise AcquisitionError('signing_certificate_identity_or_validity_mismatch')


def import_certificate(home, certificate, primary_fingerprint, signing_fingerprint, gpg_binary='gpg'):
    # Public verification must not require the secret-key gpg-agent. A normal
    # --import probes that agent even for public keys; with our --no-autostart
    # policy it fails on a fresh home. Inspect without importing, reject secret
    # packet rows, then stage a dedicated public keyring from the exact bytes.
    inspected = subprocess.run(gpg_command(home, '--with-colons', '--fingerprint', '--fingerprint',
                                          '--import-options', 'show-only', '--import', str(certificate),
                                          gpg_binary=gpg_binary), capture_output=True, text=True, check=False)
    if inspected.returncode != 0:
        raise AcquisitionError('signing_certificate_inspection_failed')
    if any(line.startswith(('sec:', 'ssb:')) for line in inspected.stdout.splitlines()):
        raise AcquisitionError('signing_certificate_must_contain_public_keys_only')
    verify_certificate_listing(inspected.stdout, primary_fingerprint, signing_fingerprint)
    keyring = Path(home) / 'openssl-release-public.gpg'
    if keyring.exists():
        raise AcquisitionError('signing_certificate_keyring_already_exists')
    staged = subprocess.run(gpg_command(home, '--output', str(keyring), '--dearmor', str(certificate),
                                       gpg_binary=gpg_binary), capture_output=True, text=True, check=False)
    if staged.returncode != 0:
        raise AcquisitionError('signing_certificate_public_keyring_failed')
    listed = subprocess.run(gpg_command(home, '--no-default-keyring', '--keyring', str(keyring),
                                       '--with-colons', '--fixed-list-mode', '--fingerprint', '--fingerprint',
                                       '--list-keys', primary_fingerprint, gpg_binary=gpg_binary),
                            capture_output=True, text=True, check=False)
    if listed.returncode != 0:
        raise AcquisitionError('signing_certificate_pinned_primary_missing')
    verify_certificate_listing(listed.stdout, primary_fingerprint, signing_fingerprint)
    return inspected


def verify_gpg_status(status, primary_fingerprint, signing_fingerprint):
    # NOTATION_DATA may contain non-UTF8 bytes (e.g. Sequoia signature salt).
    # Preserve raw evidence. Only the authenticated status markers/VALIDSIG
    # fields are ASCII; opaque notation bytes confer no signature authority.
    raw = status.encode('utf-8') if isinstance(status, str) else status
    if not isinstance(raw, bytes):
        raise AcquisitionError('openssl_release_status_type_invalid')
    valid = []
    for line in raw.split(b'\n'):
        if not line.startswith(b'[GNUPG:] '):
            continue
        fields = line.split()
        try:
            marker = fields[1].decode('ascii') if len(fields) > 1 else ''
        except UnicodeDecodeError as error:
            raise AcquisitionError('openssl_release_status_marker_invalid') from error
        if marker in UNSAFE_GPG_STATUSES:
            raise AcquisitionError(f'openssl_release_signature_rejected:{marker}')
        if marker == 'VALIDSIG':
            try:
                fields = [field.decode('ascii') for field in fields]
            except UnicodeDecodeError as error:
                raise AcquisitionError('openssl_release_signature_identity_or_algorithm_mismatch') from error
            if (len(fields) != 12 or fields[2] != signing_fingerprint or fields[11] != primary_fingerprint
                    or fields[9] not in {'8', '9', '10'} or fields[10] != '00'):
                raise AcquisitionError('openssl_release_signature_identity_or_algorithm_mismatch')
            valid.append(fields)
    if len(valid) != 1:
        raise AcquisitionError('openssl_release_validsig_required_exactly_once')
    return {'primary_fingerprint': primary_fingerprint, 'signing_fingerprint': signing_fingerprint}


def verify_signature(home, archive, signature, primary_fingerprint, signing_fingerprint, output_dir, gpg_binary='gpg'):
    checked = subprocess.run(gpg_command(home, '--no-default-keyring', '--keyring', str(Path(home) / 'openssl-release-public.gpg'),
                                         '--status-fd', '1', '--verify', str(signature), str(archive), gpg_binary=gpg_binary),
                             capture_output=True, check=False)
    stdout = checked.stdout.encode('utf-8') if isinstance(checked.stdout, str) else checked.stdout
    stderr = checked.stderr.encode('utf-8') if isinstance(checked.stderr, str) else checked.stderr
    (output_dir / 'gpg-status.txt').write_bytes(stdout)
    (output_dir / 'gpg-stderr.txt').write_bytes(stderr)
    if checked.returncode != 0:
        raise AcquisitionError(f'openssl_release_signature_gpg_exit_{checked.returncode}')
    return verify_gpg_status(stdout, primary_fingerprint, signing_fingerprint)


def checkout_head():
    git = subprocess.run(['git', '-C', str(REPOSITORY), 'rev-parse', 'HEAD'],
                         capture_output=True, text=True, check=False)
    head = git.stdout.strip()
    if git.returncode != 0 or not re.fullmatch('[0-9a-f]{40}', head):
        raise AcquisitionError('source_checkout_head_unavailable')
    return head


def verify_local_source(source_dir, evidence_dir, gpg_binary):
    """Reauthenticate local archives with GPG; never trust producer JSON alone.

    This consumer route has no network operations. It uses the fixed checkout
    lock and a caller-selected existing GPG executable, with key retrieval off.
    Its evidence directory is separate from the immutable producer handoff.
    """
    source_dir, evidence_dir, binary = map(Path, [source_dir, evidence_dir, gpg_binary])
    if not binary.is_absolute() or not binary.is_file():
        raise AcquisitionError('local_reverification_gpg_executable_must_be_absolute_existing_file')
    if not source_dir.is_dir():
        raise AcquisitionError('local_reverification_source_directory_missing')
    if evidence_dir.resolve().is_relative_to(source_dir.resolve()):
        raise AcquisitionError('local_reverification_evidence_must_be_outside_source_directory')
    if evidence_dir.exists() and (not evidence_dir.is_dir() or any(evidence_dir.iterdir())):
        raise AcquisitionError('source_output_directory_must_be_empty')

    lock = load_lock(DEFAULT_LOCK)
    lock_digest = sha256_file(DEFAULT_LOCK)
    if sha256_file(source_dir / 'guardian-openssl-source-lock.json') != lock_digest:
        raise AcquisitionError('local_reverification_handoff_lock_mismatch')
    head = checkout_head()
    openssl, nasm = lock['openssl'], lock['nasm']
    primary, signer = openssl['signing_primary_fingerprint'], openssl['signing_subkey_fingerprint']
    for spec in [openssl['archive'], openssl['signature'], nasm['archive']]:
        verify_file(source_dir / spec['filename'], spec)

    certificate_file = source_dir / 'openssl-release-signers.asc'
    if not certificate_file.is_file() or not 0 < certificate_file.stat().st_size <= 1024 * 1024:
        raise AcquisitionError('signing_certificate_missing_or_size_invalid')
    certificate_bytes = certificate_file.read_bytes()
    if not 0 < len(certificate_bytes) <= 1024 * 1024:
        raise AcquisitionError('signing_certificate_size_invalid')
    certificate_digest = hashlib.sha256(certificate_bytes).hexdigest()
    producer_file = source_dir / 'source-verification.json'
    if not producer_file.is_file() or producer_file.stat().st_size > 1024 * 1024:
        raise AcquisitionError('local_reverification_producer_evidence_missing_or_size_invalid')
    producer_bytes = producer_file.read_bytes()
    if len(producer_bytes) > 1024 * 1024:
        raise AcquisitionError('local_reverification_producer_evidence_size_invalid')
    producer = json.loads(producer_bytes)
    expected_openssl = {
        'version': openssl['version'],
        'archive_sha256': openssl['archive']['sha256'],
        'signature_sha256': openssl['signature']['sha256'],
        'signing_primary_fingerprint': primary,
        'signing_subkey_fingerprint': signer,
        'signature_verified': True,
    }
    expected_nasm = {'version': nasm['version'], 'archive_sha256': nasm['archive']['sha256']}
    if (type(producer) is not dict or producer.get('schema') != EVIDENCE_SCHEMA
            or producer.get('source_head') != head or producer.get('lock_sha256') != lock_digest
            or producer.get('openssl') != expected_openssl or producer.get('nasm') != expected_nasm
            or producer['openssl'].get('signature_verified') is not True
            or producer.get('certificate_sha256') != certificate_digest
            or producer.get('gpg_status_sha256') != sha256_file(source_dir / 'gpg-status.txt')
            or producer.get('windows_tests_executed') is not False
            or producer.get('production_qualified') is not False):
        raise AcquisitionError('local_reverification_producer_evidence_pin_or_digest_mismatch')

    with tempfile.TemporaryDirectory(prefix='guardian-openssl-local-gpg-') as temp:
        home = Path(temp)
        home.chmod(0o700)
        certificate = home / 'release-certificate.asc'
        certificate.write_bytes(certificate_bytes)
        imported = import_certificate(home, certificate, primary, signer, gpg_binary=str(binary))
        evidence_dir.mkdir(parents=True, exist_ok=True)
        (evidence_dir / 'gpg-import-status.txt').write_text(imported.stdout, encoding='utf-8')
        (evidence_dir / 'gpg-import-stderr.txt').write_text(imported.stderr, encoding='utf-8')
        identity = verify_signature(home, source_dir / openssl['archive']['filename'],
                                    source_dir / openssl['signature']['filename'], primary, signer, evidence_dir,
                                    gpg_binary=str(binary))
        # Detect mutation during verification. Extraction rechecks pins again.
        for spec in [openssl['archive'], openssl['signature'], nasm['archive']]:
            verify_file(source_dir / spec['filename'], spec)
        evidence = {
            'schema': EVIDENCE_SCHEMA,
            'verification_mode': 'offline_local_reverification',
            'network_used': False,
            'source_head': head,
            'lock_sha256': lock_digest,
            'openssl': {
                **expected_openssl,
                'signing_primary_fingerprint': identity['primary_fingerprint'],
                'signing_subkey_fingerprint': identity['signing_fingerprint'],
            },
            'nasm': expected_nasm,
            'certificate_sha256': certificate_digest,
            'gpg_status_sha256': sha256_file(evidence_dir / 'gpg-status.txt'),
            'producer_evidence_sha256': hashlib.sha256(producer_bytes).hexdigest(),
            'producer_gpg_status_sha256': producer['gpg_status_sha256'],
            'gpg_executable': str(binary),
            'gpg_executable_sha256': sha256_file(binary),
            'windows_tests_executed': False,
            'production_qualified': False,
        }
        (evidence_dir / 'source-verification.json').write_text(json.dumps(evidence, indent=2) + '\n', encoding='utf-8')
        return evidence


def acquire(certificate_file, output_dir, lock_file=DEFAULT_LOCK):
    certificate_file, output_dir, lock_file = map(Path, [certificate_file, output_dir, lock_file])
    if not certificate_file.is_file():
        raise AcquisitionError('signing_certificate_missing:provide_official_public_release_certificate')
    if certificate_file.stat().st_size == 0 or certificate_file.stat().st_size > 1024 * 1024:
        raise AcquisitionError('signing_certificate_size_invalid')
    if output_dir.exists() and (not output_dir.is_dir() or any(output_dir.iterdir())):
        raise AcquisitionError('source_output_directory_must_be_empty')
    lock = load_lock(lock_file)
    openssl = lock['openssl']
    primary, signer = openssl['signing_primary_fingerprint'], openssl['signing_subkey_fingerprint']
    # Snapshot public input once; GPG and the retained evidence use identical bytes.
    certificate_bytes = certificate_file.read_bytes()
    if not certificate_bytes or len(certificate_bytes) > 1024 * 1024:
        raise AcquisitionError('signing_certificate_size_invalid')
    with tempfile.TemporaryDirectory(prefix='guardian-openssl-source-gpg-') as temp:
        home = Path(temp)
        home.chmod(0o700)
        certificate = home / 'release-certificate.asc'
        certificate.write_bytes(certificate_bytes)
        imported = import_certificate(home, certificate, primary, signer)
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / 'gpg-import-status.txt').write_text(imported.stdout, encoding='utf-8')
        (output_dir / 'gpg-import-stderr.txt').write_text(imported.stderr, encoding='utf-8')
        for spec in [openssl['archive'], openssl['signature']]:
            download_file(spec, output_dir / spec['filename'])
        identity = verify_signature(home, output_dir / openssl['archive']['filename'],
                                    output_dir / openssl['signature']['filename'], primary, signer, output_dir)
        nasm = lock['nasm']['archive']
        download_file(nasm, output_dir / nasm['filename'])
        (output_dir / 'openssl-release-signers.asc').write_bytes(certificate_bytes)
        shutil.copyfile(lock_file, output_dir / 'guardian-openssl-source-lock.json')
        source_head = checkout_head()
        evidence = {
            'schema': EVIDENCE_SCHEMA,
            'source_head': source_head,
            'lock_sha256': sha256_file(lock_file),
            'openssl': {
                'version': openssl['version'],
                'archive_sha256': openssl['archive']['sha256'],
                'signature_sha256': openssl['signature']['sha256'],
                'signing_primary_fingerprint': identity['primary_fingerprint'],
                'signing_subkey_fingerprint': identity['signing_fingerprint'],
                'signature_verified': True,
            },
            'nasm': {'version': lock['nasm']['version'], 'archive_sha256': nasm['sha256']},
            'certificate_sha256': hashlib.sha256(certificate_bytes).hexdigest(),
            'gpg_status_sha256': sha256_file(output_dir / 'gpg-status.txt'),
            'windows_tests_executed': False,
            'production_qualified': False,
        }
        (output_dir / 'source-verification.json').write_text(json.dumps(evidence, indent=2) + '\n', encoding='utf-8')
        return evidence


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--certificate-file', type=Path, help='Official public release certificate; never a private key')
    mode.add_argument('--verify-local-source-dir', type=Path, help='Prepared source handoff to reverify without network')
    parser.add_argument('--output-dir', type=Path, help='Empty disposable acquisition output directory')
    parser.add_argument('--evidence-dir', type=Path, help='Empty offline re-verification evidence directory outside the source handoff')
    parser.add_argument('--gpg', type=Path, help='Absolute existing GPG executable for offline re-verification')
    args = parser.parse_args(argv)
    if args.certificate_file is not None:
        if args.output_dir is None or args.evidence_dir is not None or args.gpg is not None:
            parser.error('acquisition requires --output-dir and cannot use --evidence-dir/--gpg')
    elif args.evidence_dir is None or args.gpg is None or args.output_dir is not None:
        parser.error('offline re-verification requires --evidence-dir and --gpg and cannot use --output-dir')
    try:
        if args.verify_local_source_dir is not None:
            evidence = verify_local_source(args.verify_local_source_dir, args.evidence_dir, args.gpg)
        else:
            evidence = acquire(args.certificate_file, args.output_dir)
    except (AcquisitionError, OSError, ValueError, KeyError) as error:
        print(f'guardian_openssl_source_acquisition_failed:{error}', file=sys.stderr)
        return 1
    print(json.dumps(evidence, separators=(',', ':')))
    return 0


if __name__ == '__main__':
    sys.exit(main())
