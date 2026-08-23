from __future__ import annotations

import copy
import hashlib
import unittest
from unittest.mock import patch

from controller.w1 import aws_iid_courier_verifier as offhost
from worker.native_linux import aws_iid_courier as courier

DOCUMENT = b'{"accountId":"123456789012","instanceId":"i-0123456789abcdef0","region":"us-east-2"}'
RSA = b"M" * 512
TOKEN = b"test-imdsv2-token"


class FakeResponse:
    def __init__(self, status, body):
        self.status = status
        self.body = body

    def read(self, amount=None):
        if amount is None:
            return self.body
        return self.body[:amount]


class FakeConnection:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []
        self.closed = False

    def request(self, method, path, body=None, headers=None):
        self.requests.append((method, path, body, dict(headers or {})))

    def getresponse(self):
        return self.responses.pop(0)

    def close(self):
        self.closed = True


def factory_for(connection):
    def factory(host, port, timeout):
        if host != courier.IMDS_HOST or port != 80 or timeout != courier.TIMEOUT_SECONDS:
            raise AssertionError("unexpected IMDS target")
        return connection
    return factory


def golden_envelope():
    connection = FakeConnection(
        [FakeResponse(200, TOKEN), FakeResponse(200, DOCUMENT), FakeResponse(200, RSA)]
    )
    return courier.collect(factory_for(connection)), connection


class CourierTests(unittest.TestCase):
    def test_collects_only_imdsv2_link_local_bytes_and_nonclaims(self):
        envelope, connection = golden_envelope()
        self.assertEqual(
            [(x[0], x[1]) for x in connection.requests],
            [
                ("PUT", courier.TOKEN_PATH),
                ("GET", courier.DOCUMENT_PATH),
                ("GET", courier.RSA2048_PATH),
            ],
        )
        self.assertEqual(
            connection.requests[0][3],
            {"X-aws-ec2-metadata-token-ttl-seconds": "60"},
        )
        for request in connection.requests[1:]:
            self.assertEqual(request[3], {"X-aws-ec2-metadata-token": TOKEN.decode()})
        self.assertTrue(connection.closed)
        self.assertEqual(envelope["source"], "HOST_UNTRUSTED_TRANSPORT")
        self.assertFalse(envelope["provider_identity_verified"])
        self.assertFalse(envelope["persistent_worker_proof"])
        self.assertFalse(envelope["w1_verified"])
        self.assertFalse(envelope["canonical"])
        self.assertFalse(envelope["authority_effect"])

    def test_no_imdsv1_fallback_on_token_failure(self):
        connection = FakeConnection([FakeResponse(401, b"no")])
        with self.assertRaisesRegex(courier.CourierError, "token_http_status:401"):
            courier.collect(factory_for(connection))
        self.assertEqual(len(connection.requests), 1)
        self.assertEqual(connection.requests[0][0], "PUT")

    def test_redirect_is_rejected_not_followed(self):
        connection = FakeConnection([FakeResponse(200, TOKEN), FakeResponse(302, b"redirect")])
        with self.assertRaisesRegex(courier.CourierError, "document_http_status:302"):
            courier.collect(factory_for(connection))
        self.assertEqual(len(connection.requests), 2)

    def test_oversized_payload_is_rejected(self):
        connection = FakeConnection(
            [
                FakeResponse(200, TOKEN),
                FakeResponse(200, b"x" * (courier.MAX_DOCUMENT_BYTES + 1)),
            ]
        )
        with self.assertRaisesRegex(courier.CourierError, "document_response_too_large"):
            courier.collect(factory_for(connection))

    def test_offhost_decoder_recomputes_transport_hashes(self):
        envelope, _ = golden_envelope()
        document, rsa = offhost.decode_untrusted_envelope(envelope)
        self.assertEqual(document, DOCUMENT)
        self.assertEqual(rsa, RSA)

        tampered = copy.deepcopy(envelope)
        tampered["document_sha256"] = "0" * 64
        with self.assertRaisesRegex(offhost.CourierVerificationError, "document_transport_digest_mismatch"):
            offhost.decode_untrusted_envelope(tampered)

    def test_host_cannot_upgrade_identity_or_authority(self):
        envelope, _ = golden_envelope()
        for key in (
            "provider_identity_verified",
            "reboot_completion_proven",
            "persistent_worker_proof",
            "w1_verified",
            "canonical",
            "authority_effect",
        ):
            tampered = copy.deepcopy(envelope)
            tampered[key] = True
            with self.assertRaisesRegex(offhost.CourierVerificationError, "courier_nonclaim_violation"):
                offhost.decode_untrusted_envelope(tampered)

    def test_offhost_verifier_passes_only_decoded_bytes_to_core_crypto(self):
        envelope, _ = golden_envelope()
        core_result = {
            "schema": "metaengine.compute.w1-aws-signed-instance-identity.h205f22.v1",
            "classification": "SIGNED_PROVIDER_IDENTITY_VERIFIED_NONAUTHORITY",
            "identity_attestation_kind": "SIGNED_PROVIDER_IDENTITY",
            "identity_attestation_verified": True,
            "evidence": {"provider_kind": "AWS_EC2"},
            "verification_receipt_sha256": "a" * 64,
            "persistent_worker_proof": False,
            "reboot_completion_proven": False,
            "w1_verified": False,
            "canonical": False,
            "authority_effect": False,
        }
        with patch.object(offhost.iid, "verify_instance_identity", return_value=core_result) as verify:
            result = offhost.verify_envelope(
                envelope=envelope,
                certificate_pem=b"CERT",
                expected_instance_id="i-0123456789abcdef0",
                expected_account_id="123456789012",
                expected_region="us-east-2",
            )
        kwargs = verify.call_args.kwargs
        self.assertEqual(kwargs["document_raw"], DOCUMENT)
        self.assertEqual(kwargs["rsa2048_signature_raw"], RSA)
        self.assertEqual(kwargs["certificate_pem"], b"CERT")
        self.assertIn("courier_transport", result["evidence"])
        self.assertRegex(result["verification_receipt_sha256"], r"^[0-9a-f]{64}$")
        self.assertFalse(result["persistent_worker_proof"])


if __name__ == "__main__":
    unittest.main()
