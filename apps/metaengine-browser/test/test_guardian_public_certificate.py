import base64
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import subprocess
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('certificate', Path(__file__).resolve().parent.parent / 'scripts' / 'prepare-guardian-openssl-certificate.py')
certificate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(certificate)


class PublicCertificateTests(unittest.TestCase):
    def test_bundled_bytes_match_existing_official_public_certificate(self):
        data = certificate.public_certificate()
        self.assertEqual(len(data), 6043)
        self.assertEqual(hashlib.sha256(data).hexdigest(), certificate.BUNDLED_SHA256)
        self.assertNotIn(b'PRIVATE KEY', data)

    def test_autocrlf_checkout_preserves_pinned_certificate_bytes(self):
        root = Path(__file__).resolve().parents[3]
        relative = certificate.BUNDLED.relative_to(root)
        with tempfile.TemporaryDirectory() as directory:
            checkout = Path(directory)
            def git(*args):
                return subprocess.run(['git', '-C', directory, *args], check=True,
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            git('init', '--quiet')
            git('config', 'core.autocrlf', 'true')
            (checkout / '.gitattributes').write_bytes((root / '.gitattributes').read_bytes())
            target = checkout / relative
            target.parent.mkdir(parents=True)
            target.write_bytes(certificate.BUNDLED.read_bytes())
            git('add', '.gitattributes', relative.as_posix())
            target.unlink()
            git('checkout-index', '--force', '--', relative.as_posix())
            self.assertEqual(hashlib.sha256(target.read_bytes()).hexdigest(), certificate.BUNDLED_SHA256)

    def test_explicit_public_input_preserves_exact_bytes(self):
        data = certificate.public_certificate()
        self.assertEqual(certificate.public_certificate(base64.b64encode(data).decode()), data)

    def test_corrupted_bundled_input_refuses_instead_of_network_or_new_key(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'cert.asc'
            path.write_bytes(b'changed')
            with mock.patch.object(certificate, 'BUNDLED', path):
                with self.assertRaisesRegex(ValueError, 'bundled_public_certificate_changed'):
                    certificate.public_certificate()

    def test_private_noncanonical_or_excessive_inputs_refuse(self):
        for value in ['invalid base64!', 'x' * 262145,
                      base64.b64encode(b'-----BEGIN PGP PRIVATE KEY BLOCK-----').decode(),
                      base64.b64encode(b'-----BEGIN PGP PUBLIC KEY BLOCK-----' + b'x' * 131072).decode()]:
            with self.subTest(value=value[:30]), self.assertRaises(ValueError):
                certificate.public_certificate(value)


if __name__ == '__main__':
    unittest.main()
