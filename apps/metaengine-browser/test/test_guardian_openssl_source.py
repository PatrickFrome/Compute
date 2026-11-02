import importlib.util
import io
import json
import os
import shutil
import subprocess
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
import tempfile
import unittest
from unittest import mock


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'acquire-guardian-openssl-source.py'
SPEC = importlib.util.spec_from_file_location('guardian_openssl_source', SCRIPT)
source = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(source)

PRIMARY = 'B146647E45A7B33947AB226B2A2C87D161692D40'
SUBKEY = 'C46ED3F2CBEFDA1FDAADA44264ED7B1DCCE71CB2'


def valid_status(signer=SUBKEY, primary=PRIMARY):
    return f'[GNUPG:] VALIDSIG {signer} 2026-09-29 1790690724 0 4 0 1 10 00 {primary}\n'


def certificate_listing(primary=PRIMARY, subkey=SUBKEY, sub_validity='-'):
    return '\n'.join([
        'pub:-:4096:1:2A2C87D161692D40:1:0::-:::c:',
        f'fpr:::::::::{primary}:',
        f'sub:{sub_validity}:4096:1:64ED7B1DCCE71CB2:1:0:::::s:',
        f'fpr:::::::::{subkey}:',
    ])


class GitWindowsGpgTransportTests(unittest.TestCase):
    def test_msys_gpg_uses_posix_drive_paths_for_home_and_signature_inputs(self):
        binary = r'C:\Program Files\Git\usr\bin\gpg.exe'
        with mock.patch.object(source, '_gpg_uses_msys_paths', return_value=True):
            command = source.gpg_command(
                r'C:\Users\CI Runner\AppData\Local\Temp\guardian-key-home',
                '--status-fd', '1', '--verify', r'D:\authenticated\release.asc',
                r'E:\cached source\openssl.tar.gz', gpg_binary=binary)
        self.assertEqual(command[0], binary)
        self.assertEqual(command[3], '/c/Users/CI Runner/AppData/Local/Temp/guardian-key-home')
        self.assertEqual(command[-2:], ['/d/authenticated/release.asc', '/e/cached source/openssl.tar.gz'])
        self.assertIn('--no-auto-key-retrieve', command)
        self.assertIn('--no-options', command)

    def test_native_gpg_keeps_windows_paths_and_posix_gpg_keeps_posix_paths(self):
        binary = r'C:\Program Files\GnuPG\bin\gpg.exe'
        with mock.patch.object(source, '_gpg_uses_msys_paths', return_value=False):
            command = source.gpg_command(r'C:\source\keys', '--verify',
                                         r'C:\source\release.asc', gpg_binary=binary)
        self.assertEqual(command[3], r'C:\source\keys')
        self.assertEqual(command[-1], r'C:\source\release.asc')
        self.assertEqual(source._msys_gpg_argument('/c/unchanged.asc'), '/c/unchanged.asc')

    def test_msys_gpg_refuses_unc_or_drive_relative_home(self):
        with mock.patch.object(source, '_gpg_uses_msys_paths', return_value=True):
            for bad in (r'\\host\share\gnupg', r'\relative-to-current-drive', r'C:relative-keys', 'D:'):
                with self.subTest(path=bad), self.assertRaisesRegex(
                        source.AcquisitionError, 'msys_gpg_unanchored_or_unc_path_unsupported'):
                    source.gpg_command(bad, '--list-keys')

    @unittest.skipUnless(os.name == 'nt', 'Real Git for Windows GPG smoke runs on Windows CI only')
    def test_real_git_for_windows_gpg_accepts_normalized_home(self):
        git = shutil.which('git.exe')
        if not git:
            self.skipTest('Git for Windows unavailable')
        git_dir = Path(git).resolve().parent
        candidates = [git_dir / '..' / 'usr' / 'bin' / 'gpg.exe',
                      git_dir / '..' / '..' / 'usr' / 'bin' / 'gpg.exe']
        gpg = next((item.resolve() for item in candidates if item.is_file()), None)
        if gpg is None or not source._gpg_uses_msys_paths(str(gpg)):
            self.skipTest('Git MSYS GPG runtime unavailable')
        with tempfile.TemporaryDirectory(prefix='guardian-gpg-win-') as directory:
            homedir = Path(directory) / 'independent-key-home'
            homedir.mkdir()
            result = subprocess.run(
                source.gpg_command(homedir, '--with-colons', '--list-keys', gpg_binary=str(gpg)),
                capture_output=True, text=True, timeout=30, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)


class SignatureIdentityTests(unittest.TestCase):
    def test_exact_primary_and_signing_subkey_required(self):
        self.assertEqual(source.verify_gpg_status(valid_status(), PRIMARY, SUBKEY), {
            'primary_fingerprint': PRIMARY,
            'signing_fingerprint': SUBKEY,
        })
        for status in [
            valid_status(primary='A' * 40),
            valid_status(signer='A' * 40),
            '[GNUPG:] GOODSIG 64ED7B1DCCE71CB2 OpenSSL\n',
            valid_status().replace(f' {PRIMARY}', ''),
            valid_status() + valid_status(),
        ]:
            with self.subTest(status=status), self.assertRaises(source.AcquisitionError):
                source.verify_gpg_status(status, PRIMARY, SUBKEY)

    def test_revoked_expired_bad_or_error_status_rejected_even_with_validsig(self):
        for marker in ['BADSIG', 'ERRSIG', 'EXPSIG', 'EXPKEYSIG', 'REVKEYSIG', 'KEYEXPIRED', 'SIGEXPIRED', 'KEYREVOKED', 'NO_PUBKEY', 'FAILURE']:
            with self.subTest(marker=marker), self.assertRaises(source.AcquisitionError):
                source.verify_gpg_status(valid_status() + f'[GNUPG:] {marker} ignored\n', PRIMARY, SUBKEY)

    def test_binary_signature_notation_preserves_validsig_and_never_hides_failure(self):
        status = b'[GNUPG:] NOTATION_DATA \xbb\xf2\x85%0Aopaque\n' + valid_status().encode('ascii')
        self.assertEqual(source.verify_gpg_status(status, PRIMARY, SUBKEY)['signing_fingerprint'], SUBKEY)
        for bad in [status + b'[GNUPG:] FAILURE gpg-exit 1\n',
                    status + valid_status().encode('ascii'),
                    valid_status().encode('ascii').replace(SUBKEY.encode('ascii'), b'\xbb' * 40)]:
            with self.subTest(status=bad), self.assertRaises(source.AcquisitionError):
                source.verify_gpg_status(bad, PRIMARY, SUBKEY)

    def test_certificate_subkey_must_belong_to_pinned_primary_and_be_valid(self):
        source.verify_certificate_listing(certificate_listing(), PRIMARY, SUBKEY)
        for listing in [
            certificate_listing(primary='A' * 40),
            certificate_listing(subkey='A' * 40),
            certificate_listing(sub_validity='r'),
            certificate_listing(sub_validity='e'),
            certificate_listing().replace('pub:-:', 'pub:r:'),
        ]:
            with self.subTest(listing=listing), self.assertRaises(source.AcquisitionError):
                source.verify_certificate_listing(listing, PRIMARY, SUBKEY)

    def test_private_key_input_cannot_be_retained_as_public_certificate(self):
        private = mock.Mock(returncode=0, stdout='sec:-:4096:1:64ED7B1DCCE71CB2:1:0::::::::\n', stderr='')
        with tempfile.TemporaryDirectory() as temp:
            with mock.patch.object(source.subprocess, 'run', side_effect=[private]):
                with self.assertRaisesRegex(source.AcquisitionError, 'public_keys_only'):
                    source.import_certificate(Path(temp) / 'home', Path(temp) / 'certificate.asc', PRIMARY, SUBKEY)


    @unittest.skipUnless(shutil.which('gpg'), 'GPG executable unavailable')
    def test_real_fresh_public_keyring_requires_no_secret_agent(self):
        certificate = Path(__file__).resolve().parent.parent / 'native' / 'openssl' / 'openssl-release-public-certificate.asc'
        with tempfile.TemporaryDirectory(prefix='guardian-public-only-') as home:
            inspected = source.import_certificate(Path(home), certificate, PRIMARY, SUBKEY)
            self.assertEqual(inspected.returncode, 0)
            self.assertTrue((Path(home) / 'openssl-release-public.gpg').is_file())
            self.assertFalse(any(line.startswith(('sec:', 'ssb:')) for line in inspected.stdout.splitlines()))
            with self.assertRaisesRegex(source.AcquisitionError, 'keyring_already_exists'):
                source.import_certificate(Path(home), certificate, PRIMARY, SUBKEY)


class DownloadIntegrityTests(unittest.TestCase):
    def spec(self, content):
        import hashlib
        return {'filename': 'source.tar.gz', 'url': 'https://github.com/openssl/openssl/releases/download/test/source.tar.gz',
                'sha256': hashlib.sha256(content).hexdigest(), 'size_bytes': len(content)}

    def test_verified_bytes_installed_atomically(self):
        data = b'bounded pinned source bytes'
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'source.tar.gz'
            with mock.patch.object(source.urllib.request, 'urlopen', return_value=io.BytesIO(data)) as request:
                source.download_file(self.spec(data), path)
            request.assert_called_once()
            self.assertEqual(path.read_bytes(), data)
            self.assertEqual(list(Path(temp).iterdir()), [path])

    def test_wrong_digest_or_size_never_installed(self):
        for data in [b'corrupt source', b'longer than pinned source']:
            with self.subTest(data=data), tempfile.TemporaryDirectory() as temp:
                path = Path(temp) / 'source.tar.gz'
                spec = self.spec(b'valid source!!')
                with mock.patch.object(source.urllib.request, 'urlopen', return_value=io.BytesIO(data)):
                    with self.assertRaises(source.AcquisitionError):
                        source.download_file(spec, path)
                self.assertFalse(path.exists())
                self.assertEqual(list(Path(temp).iterdir()), [])

    def test_same_size_corruption_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'source.tar.gz'
            path.write_bytes(b'good')
            spec = self.spec(b'good')
            source.verify_file(path, spec)
            path.write_bytes(b'evil')
            with self.assertRaises(source.AcquisitionError):
                source.verify_file(path, spec)

    def test_failed_transfer_does_not_overwrite_existing_file(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'source.tar.gz'
            path.write_bytes(b'keep existing data')
            with mock.patch.object(source.urllib.request, 'urlopen', side_effect=OSError('network unavailable')):
                with self.assertRaises(OSError):
                    source.download_file(self.spec(b'valid source'), path)
            self.assertEqual(path.read_bytes(), b'keep existing data')


class AcquisitionBoundaryTests(unittest.TestCase):
    def test_missing_certificate_fails_before_network_or_output(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'output'
            with mock.patch.object(source.urllib.request, 'urlopen') as request:
                with self.assertRaisesRegex(source.AcquisitionError, 'signing_certificate_missing'):
                    source.acquire(Path(temp) / 'absent.asc', output, source.DEFAULT_LOCK)
            request.assert_not_called()
            self.assertFalse(output.exists())

    def test_supplied_certificate_is_validated_before_network(self):
        with tempfile.TemporaryDirectory() as temp:
            certificate = Path(temp) / 'certificate.asc'
            certificate.write_text('untrusted certificate input')
            output = Path(temp) / 'output'
            with mock.patch.object(source, 'import_certificate', side_effect=source.AcquisitionError('certificate_identity_mismatch')):
                with mock.patch.object(source.urllib.request, 'urlopen') as request:
                    with self.assertRaisesRegex(source.AcquisitionError, 'certificate_identity_mismatch'):
                        source.acquire(certificate, output, source.DEFAULT_LOCK)
            request.assert_not_called()
            self.assertFalse(output.exists())

    def test_bad_signature_prevents_nasm_download_and_success_evidence(self):
        with tempfile.TemporaryDirectory() as temp:
            certificate = Path(temp) / 'certificate.asc'
            certificate.write_text('public-certificate-fixture-not-a-real-key')
            output = Path(temp) / 'output'
            imported = mock.Mock(stdout='', stderr='')
            with mock.patch.object(source, 'import_certificate', return_value=imported):
                with mock.patch.object(source, 'download_file') as download:
                    with mock.patch.object(source, 'verify_signature', side_effect=source.AcquisitionError('BADSIG')):
                        with self.assertRaisesRegex(source.AcquisitionError, 'BADSIG'):
                            source.acquire(certificate, output)
            self.assertEqual([call.args[0]['filename'] for call in download.call_args_list],
                             ['openssl-3.5.9.tar.gz', 'openssl-3.5.9.tar.gz.asc'])
            self.assertFalse((output / 'source-verification.json').exists())
            self.assertFalse((output / 'openssl-release-signers.asc').exists())

    def test_previous_output_cannot_leave_stale_success_after_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            certificate = Path(temp) / 'certificate.asc'
            certificate.write_text('public-certificate-fixture-not-a-real-key')
            output = Path(temp) / 'output'
            output.mkdir()
            (output / 'source-verification.json').write_text('{"stale":true}')
            with mock.patch.object(source.urllib.request, 'urlopen') as request:
                with self.assertRaisesRegex(source.AcquisitionError, 'directory_must_be_empty'):
                    source.acquire(certificate, output)
            request.assert_not_called()

    def test_lock_contains_exact_source_and_signature_hashes(self):
        lock = source.load_lock(source.DEFAULT_LOCK)
        self.assertEqual(lock['openssl']['version'], '3.5.9')
        self.assertEqual(lock['openssl']['archive']['sha256'], '603f5602e2eef00d77fbd429d34dcd5822bb301757a1bc9cdb24c670f1eb859a')
        self.assertEqual(lock['openssl']['signature']['sha256'], 'bdccf2057a7c4ae377b40e832cb8c632ae8b532d4fb64cc7b843066eee748f89')
        self.assertEqual(lock['nasm']['archive']['sha256'], '77ad39a2c82908b6b39ebc7cf0368a510fa1cf3d427b682055eb6357a985b1ee')
        self.assertIn(lock['nasm']['release_commit'], lock['nasm']['archive']['url'])
        self.assertEqual(lock['configure_args'], ['VC-WIN64A', '--release', 'no-shared', 'no-module', 'no-dso', 'no-engine', 'no-autoload-config', 'no-legacy', 'ASFLAGS=--reproducible'])
        self.assertEqual(lock['openssl']['source_date_epoch'], 1790690724)

    def test_gpg_cannot_report_success_without_valid_signature(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp)
            fake = mock.Mock(returncode=0, stdout='[GNUPG:] GOODSIG 64ED7B1DCCE71CB2 OpenSSL\n', stderr='')
            with mock.patch.object(source.subprocess, 'run', return_value=fake):
                with self.assertRaises(source.AcquisitionError):
                    source.verify_signature(output, output / 'archive', output / 'signature', PRIMARY, SUBKEY, output)


class OfflineReverificationTests(unittest.TestCase):
    def fixture(self, directory):
        import hashlib
        directory.mkdir()
        lock = source.load_lock(source.DEFAULT_LOCK)
        for component, member, data in [
            ('openssl', 'archive', b'archive fixture'),
            ('openssl', 'signature', b'detached signature fixture'),
            ('nasm', 'archive', b'nasm fixture'),
        ]:
            spec = lock[component][member]
            spec['size_bytes'] = len(data)
            spec['sha256'] = hashlib.sha256(data).hexdigest()
            (directory / spec['filename']).write_bytes(data)
        (directory / 'openssl-release-signers.asc').write_bytes(b'public certificate fixture, not a real key')
        (directory / 'gpg-status.txt').write_text(valid_status())
        (directory / 'guardian-openssl-source-lock.json').write_bytes(source.DEFAULT_LOCK.read_bytes())
        producer = {
            'schema': source.EVIDENCE_SCHEMA,
            'source_head': 'a' * 40,
            'lock_sha256': source.sha256_file(source.DEFAULT_LOCK),
            'openssl': {
                'version': lock['openssl']['version'],
                'archive_sha256': lock['openssl']['archive']['sha256'],
                'signature_sha256': lock['openssl']['signature']['sha256'],
                'signing_primary_fingerprint': PRIMARY,
                'signing_subkey_fingerprint': SUBKEY,
                # Deliberately hand-authored; actual GPG must still run.
                'signature_verified': True,
            },
            'nasm': {'version': lock['nasm']['version'], 'archive_sha256': lock['nasm']['archive']['sha256']},
            'certificate_sha256': source.sha256_file(directory / 'openssl-release-signers.asc'),
            'gpg_status_sha256': source.sha256_file(directory / 'gpg-status.txt'),
            'windows_tests_executed': False,
            'production_qualified': False,
        }
        (directory / 'source-verification.json').write_text(json.dumps(producer))
        return lock, producer

    def test_forged_signature_verified_flag_cannot_bypass_actual_gpg(self):
        import sys
        with tempfile.TemporaryDirectory() as temp:
            prepared, output = Path(temp) / 'prepared', Path(temp) / 'consumer-evidence'
            lock, unused_producer = self.fixture(prepared)
            imported = mock.Mock(stdout='', stderr='')
            with mock.patch.object(source, 'load_lock', return_value=lock), mock.patch.object(source, 'checkout_head', return_value='a' * 40):
                with mock.patch.object(source, 'import_certificate', return_value=imported):
                    with mock.patch.object(source.subprocess, 'run', return_value=mock.Mock(returncode=2, stdout='[GNUPG:] BADSIG forged\n', stderr='Bad signature')) as process:
                        with mock.patch.object(source.urllib.request, 'urlopen') as request:
                            with self.assertRaisesRegex(source.AcquisitionError, 'signature_gpg_exit_2'):
                                source.verify_local_source(prepared, output, Path(sys.executable).resolve())
                        request.assert_not_called()
                    self.assertIn('--verify', process.call_args.args[0])
                    self.assertEqual(process.call_args.args[0][0], str(Path(sys.executable).resolve()))
                    self.assertIn('--no-auto-key-retrieve', process.call_args.args[0])
            self.assertFalse((output / 'source-verification.json').exists())

    def test_offline_mode_requires_an_existing_absolute_gpg_binary(self):
        with tempfile.TemporaryDirectory() as temp:
            for binary in ['gpg', str(Path(temp) / 'absent-gpg')]:
                with self.subTest(binary=binary), self.assertRaisesRegex(source.AcquisitionError, 'gpg_executable'):
                    source.verify_local_source(Path(temp) / 'prepared', Path(temp) / 'output', binary)

    def test_success_requires_new_validsig_and_writes_separate_offline_evidence(self):
        import sys
        with tempfile.TemporaryDirectory() as temp:
            prepared, output = Path(temp) / 'prepared', Path(temp) / 'consumer-evidence'
            lock, producer = self.fixture(prepared)
            producer_bytes = (prepared / 'source-verification.json').read_bytes()
            gpg = mock.Mock(returncode=0, stdout=valid_status(), stderr='')
            with mock.patch.object(source, 'load_lock', return_value=lock), mock.patch.object(source, 'checkout_head', return_value='a' * 40):
                with mock.patch.object(source, 'import_certificate', return_value=mock.Mock(stdout='', stderr='')):
                    with mock.patch.object(source.subprocess, 'run', return_value=gpg) as process:
                        with mock.patch.object(source.urllib.request, 'urlopen') as request:
                            result = source.verify_local_source(prepared, output, Path(sys.executable).resolve())
                        request.assert_not_called()
                    process.assert_called_once()
            self.assertEqual(result['verification_mode'], 'offline_local_reverification')
            self.assertIs(result['network_used'], False)
            self.assertIs(result['openssl']['signature_verified'], True)
            self.assertIs(result['production_qualified'], False)
            self.assertEqual(result['gpg_status_sha256'], source.sha256_file(output / 'gpg-status.txt'))
            self.assertEqual(result['producer_evidence_sha256'], source.hashlib.sha256(producer_bytes).hexdigest())
            self.assertEqual((prepared / 'source-verification.json').read_bytes(), producer_bytes)
            self.assertEqual(json.loads((output / 'source-verification.json').read_text()), result)

    def test_handoff_pin_or_digest_mismatch_rejected_before_gpg(self):
        import sys
        for field in ['source_head', 'lock_sha256', 'certificate_sha256', 'gpg_status_sha256']:
            with self.subTest(field=field), tempfile.TemporaryDirectory() as temp:
                prepared, output = Path(temp) / 'prepared', Path(temp) / 'consumer-evidence'
                lock, producer = self.fixture(prepared)
                producer[field] = '0' * 64
                (prepared / 'source-verification.json').write_text(json.dumps(producer))
                with mock.patch.object(source, 'load_lock', return_value=lock), mock.patch.object(source, 'checkout_head', return_value='a' * 40):
                    with mock.patch.object(source, 'import_certificate') as imported, mock.patch.object(source.urllib.request, 'urlopen') as request:
                        with self.assertRaisesRegex(source.AcquisitionError, 'pin_or_digest_mismatch'):
                            source.verify_local_source(prepared, output, Path(sys.executable).resolve())
                    imported.assert_not_called()
                    request.assert_not_called()
                self.assertFalse(output.exists())

    def test_handoff_archive_corruption_rejected_before_gpg(self):
        import sys
        with tempfile.TemporaryDirectory() as temp:
            prepared, output = Path(temp) / 'prepared', Path(temp) / 'consumer-evidence'
            lock, unused_producer = self.fixture(prepared)
            (prepared / lock['openssl']['archive']['filename']).write_bytes(b'evil archive!!!')
            with mock.patch.object(source, 'load_lock', return_value=lock), mock.patch.object(source, 'checkout_head', return_value='a' * 40):
                with mock.patch.object(source, 'import_certificate') as imported, mock.patch.object(source.urllib.request, 'urlopen') as request:
                    with self.assertRaises(source.AcquisitionError):
                        source.verify_local_source(prepared, output, Path(sys.executable).resolve())
                imported.assert_not_called()
                request.assert_not_called()

    def test_evidence_directory_cannot_overwrite_producer_source_directory(self):
        import sys
        with tempfile.TemporaryDirectory() as temp:
            prepared = Path(temp) / 'prepared'
            self.fixture(prepared)
            with self.assertRaisesRegex(source.AcquisitionError, 'outside_source_directory'):
                source.verify_local_source(prepared, prepared / 'evidence', Path(sys.executable).resolve())


class CliModeTests(unittest.TestCase):
    def test_original_acquisition_cli_is_preserved(self):
        with mock.patch.object(source, 'acquire', return_value={'mode': 'acquire'}) as acquire:
            with redirect_stdout(io.StringIO()):
                self.assertEqual(source.main(['--certificate-file', '/public.asc', '--output-dir', '/output']), 0)
        acquire.assert_called_once_with(Path('/public.asc'), Path('/output'))

    def test_offline_cli_requires_explicit_gpg_and_evidence_and_cannot_mix_modes(self):
        for args in [
            ['--verify-local-source-dir', '/prepared', '--evidence-dir', '/evidence'],
            ['--verify-local-source-dir', '/prepared', '--gpg', '/gpg'],
            ['--verify-local-source-dir', '/prepared', '--evidence-dir', '/evidence', '--gpg', '/gpg', '--output-dir', '/output'],
            ['--certificate-file', '/public.asc', '--verify-local-source-dir', '/prepared', '--output-dir', '/output'],
        ]:
            with self.subTest(args=args), redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as failed:
                source.main(args)
            self.assertEqual(failed.exception.code, 2)

    def test_offline_cli_dispatches_without_acquisition(self):
        with mock.patch.object(source, 'acquire') as acquire, mock.patch.object(source, 'verify_local_source', return_value={'mode': 'offline'}) as verify:
            with redirect_stdout(io.StringIO()):
                self.assertEqual(source.main(['--verify-local-source-dir', '/prepared', '--evidence-dir', '/evidence', '--gpg', '/absolute/gpg']), 0)
        acquire.assert_not_called()
        verify.assert_called_once_with(Path('/prepared'), Path('/evidence'), Path('/absolute/gpg'))


if __name__ == '__main__':
    unittest.main()
