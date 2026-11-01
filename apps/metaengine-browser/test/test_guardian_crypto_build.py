"""Synthetic byte-agreement tests; never authentication or Windows evidence."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/verify-guardian-crypto-build.py'
spec = importlib.util.spec_from_file_location('crypto_build', SCRIPT)
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data if isinstance(data, bytes) else json.dumps(data).encode())


class ByteAgreementTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.root, self.source, self.build = [base / name for name in ['repo', 'source', 'build']]
        self.head = 'a' * 40
        # A separate miniature synthetic repository. Production ROOT and the
        # checked-in lock/trust roots are never rewritten by a test.
        lock = json.loads((check.ROOT / check.LOCK).read_text())
        for component, member in [('openssl', 'archive'), ('openssl', 'signature'), ('nasm', 'archive')]:
            pin = lock[component][member]
            data = (component + member + ': synthetic input').encode()
            write(self.source / pin['filename'], data)
            pin.update(size_bytes=len(data), sha256=check.digest(self.source / pin['filename']))
        write(self.root / check.LOCK, lock)
        self.lock = lock
        self.lock_sha = check.digest(self.root / check.LOCK)
        for directory in [self.source, self.build / 'evidence']:
            write(directory / 'guardian-openssl-source-lock.json', (self.root / check.LOCK).read_bytes())
            write(directory / 'openssl-release-signers.asc', b'NOT A KEY: synthetic certificate bytes')
            write(directory / 'gpg-status.txt', b'NOT GPG: synthetic evidence bytes')
        acquired = dict(schema='metaengine.guardian-openssl-source-verification.v1', source_head=self.head,
                        lock_sha256=self.lock_sha, openssl={key: lock['openssl'][key] for key in ['signing_primary_fingerprint', 'signing_subkey_fingerprint']},
                        nasm={'archive_sha256': lock['nasm']['archive']['sha256']},
                        certificate_sha256=check.digest(self.source / 'openssl-release-signers.asc'),
                        gpg_status_sha256=check.digest(self.source / 'gpg-status.txt'))
        acquired['openssl'].update(archive_sha256=lock['openssl']['archive']['sha256'], signature_sha256=lock['openssl']['signature']['sha256'])
        for directory in [self.source, self.build / 'evidence']:
            write(directory / 'source-verification.json', acquired)
        reverified = copy.deepcopy(acquired)
        reverified.update(verification_mode='offline_local_reverification', network_used=False,
                          producer_evidence_sha256=check.digest(self.source / 'source-verification.json'))
        write(self.build / 'evidence/source-reverification/source-verification.json', reverified)
        write(self.build / 'evidence/source-reverification/gpg-status.txt', (self.source / 'gpg-status.txt').read_bytes())
        for name in ['browser-guardian-release-signature.cpp', 'browser-guardian-release-signature.hpp']:
            write(self.root / check.NATIVE / name, (check.ROOT / check.NATIVE / name).read_bytes())
        self.proof = dict(schema='metaengine.browser.guardian-openssl-static-build.v1', source_head=self.head,
                          source_lock_sha256=self.lock_sha, configure_args=lock['configure_args'], runtime_library='/MT',
                          openssl_source_sha256=lock['openssl']['archive']['sha256'],
                          native_verifier_source_sha256=check.digest(self.root / check.NATIVE / 'browser-guardian-release-signature.cpp'))
        for directory, key, entries in [
            ('openssl-static', 'files', {'lib/libcrypto.lib': b'!<arch>\n' + b'synthetic not COFF' * 8,
                                       'include/openssl/evp.h': b'synthetic EVP header', 'include/openssl/configuration.h': b'synthetic config'}),
            ('guardian-signature', 'native_verifier_files', {'lib/guardian-release-signature.lib': b'!<arch>\n' + b'synthetic not COFF' * 8,
                'include/browser-guardian-release-signature.hpp': (self.root / check.NATIVE / 'browser-guardian-release-signature.hpp').read_bytes()})]:
            rows = []
            for name, data in entries.items():
                file = self.build / 'artifacts' / directory / name
                write(file, data)
                rows.append(dict(path=name, sha256=check.digest(file), size_bytes=len(data)))
            self.proof[key] = rows
        self.save()
        self.patcher = patch.object(check, 'ROOT', self.root)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)

    def save(self):
        write(self.build / 'openssl-static-build-proof.json', self.proof)

    def verify(self, expected=None):
        return check.verify(self.build, self.source, self.head, expected)

    def test_byte_agreement_is_not_a_provenance_receipt(self):
        binding = self.verify()
        self.assertEqual(binding['build_source_head'], self.head)
        self.assertNotIn('verified', binding)
        self.assertNotIn('production_qualified', binding)

    def test_mutated_actual_inputs_fail_even_when_success_flags_are_added(self):
        for file in [self.source / self.lock['openssl']['archive']['filename'],
                     self.source / self.lock['nasm']['archive']['filename'],
                     self.build / 'artifacts/openssl-static/lib/libcrypto.lib',
                     self.build / 'artifacts/guardian-signature/include/browser-guardian-release-signature.hpp',
                     self.build / 'evidence/source-reverification/gpg-status.txt',
                     self.root / check.NATIVE / 'browser-guardian-release-signature.cpp',
                     self.root / check.LOCK]:
            original = file.read_bytes()
            with self.subTest(file=file):
                file.write_bytes(original.replace(original[:1], b'X', 1))
                self.proof.update(signature_verified=True, native_verifier_linked=True)
                self.save()
                with self.assertRaises((ValueError, KeyError)):
                    self.verify()
                file.write_bytes(original)

    def test_public_header_cannot_be_changed_by_updating_manifest(self):
        file = self.build / 'artifacts/guardian-signature/include/browser-guardian-release-signature.hpp'
        file.write_bytes(file.read_bytes() + b'// drift')
        row = next(row for row in self.proof['native_verifier_files'] if row['path'].startswith('include/'))
        row.update(sha256=check.digest(file), size_bytes=file.stat().st_size)
        self.save()
        with self.assertRaisesRegex(ValueError, 'public_header'):
            self.verify()

    def test_old_head_and_changed_proof_rejected(self):
        expected = self.verify()['producer_proof_sha256']
        self.proof['source_head'] = 'b' * 40
        self.save()
        with self.assertRaisesRegex(ValueError, 'producer_proof_changed'):
            self.verify(expected)
        with self.assertRaisesRegex(ValueError, 'source_head'):
            self.verify()

    def test_duplicate_traversal_and_missing_inventory_rejected(self):
        original = copy.deepcopy(self.proof['files'])
        for rows in [original + [original[0]], [dict(original[0], path='../outside')], original[1:]]:
            self.proof['files'] = rows
            self.save()
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                self.verify()

    def test_unlisted_artifact_rejected(self):
        write(self.build / 'artifacts/openssl-static/evil.dll', b'extra')
        with self.assertRaisesRegex(ValueError, 'membership'):
            self.verify()

    def test_symlink_rejected(self):
        file = self.build / 'artifacts/openssl-static/lib/libcrypto.lib'
        other = file.with_name('outside.lib')
        file.rename(other)
        try:
            file.symlink_to(other)
        except OSError as error:
            self.skipTest('symlink unavailable: ' + str(error))
        with self.assertRaisesRegex(ValueError, 'reparse'):
            self.verify()

    def test_dynamic_binary_cannot_be_substituted_for_archive(self):
        file = self.build / 'artifacts/openssl-static/lib/libcrypto.lib'
        file.write_bytes(b'MZ' + b'dynamic file' * 10)
        row = self.proof['files'][0]
        row.update(sha256=check.digest(file), size_bytes=file.stat().st_size)
        self.save()
        with self.assertRaisesRegex(ValueError, 'static_archive'):
            self.verify()


if __name__ == '__main__':
    unittest.main()
