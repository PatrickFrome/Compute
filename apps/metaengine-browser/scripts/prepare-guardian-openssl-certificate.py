"""Stage an existing PUBLIC OpenSSL certificate; this does not authenticate a release.

The existing acquisition verifier still enforces the pinned primary/subkey and
archive/signature digests. This removes a non-secret CI configuration dependency,
not any METAENGINE release-root/Authenticode or installer qualification gate.
"""
import argparse
import base64
import hashlib
import os
from pathlib import Path

BUNDLED = Path(__file__).resolve().parent.parent / 'native' / 'openssl' / 'openssl-release-public-certificate.asc'
BUNDLED_SHA256 = '06b6ff8018b0eacf2c965493c0d1347ea58649733a233c84923d2a0387ac3660'


def public_certificate(encoded=''):
    if not isinstance(encoded, str) or len(encoded) > 262144:
        raise ValueError('openssl_public_certificate_input_size_invalid')
    if encoded.strip():
        certificate = base64.b64decode(encoded.strip(), validate=True)
    else:
        certificate = BUNDLED.read_bytes()
        if hashlib.sha256(certificate).hexdigest() != BUNDLED_SHA256:
            raise ValueError('openssl_bundled_public_certificate_changed')
    if not 0 < len(certificate) <= 131072:
        raise ValueError('openssl_public_certificate_size_invalid')
    if not certificate.startswith(b'-----BEGIN PGP PUBLIC KEY BLOCK-----') or b'PRIVATE KEY' in certificate:
        raise ValueError('openssl_public_certificate_required')
    return certificate


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-file', required=True)
    args = parser.parse_args()
    certificate = public_certificate(os.environ.get('OPENSSL_SIGNING_CERTIFICATE_B64', ''))
    target = Path(args.output_file)
    with target.open('xb') as output:
        output.write(certificate)
    print('public_certificate_staged_sha256=' + hashlib.sha256(certificate).hexdigest())


if __name__ == '__main__':
    main()
