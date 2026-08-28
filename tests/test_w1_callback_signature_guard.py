from __future__ import annotations

import base64
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from controller.w1 import w1_callback_signature_guard as guard
from controller.w1 import w1_execution_marker_guard as marker_guard


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def der_to_p1363(raw: bytes) -> bytes:
    def read_len(pos):
        first = raw[pos]
        pos += 1
        if first < 0x80:
            return first, pos
        n = first & 0x7F
        return int.from_bytes(raw[pos:pos+n], "big"), pos+n

    pos = 0
    assert raw[pos] == 0x30
    pos += 1
    seq_len, pos = read_len(pos)
    assert pos + seq_len == len(raw)
    values = []
    for _ in range(2):
        assert raw[pos] == 0x02
        pos += 1
        n, pos = read_len(pos)
        value = raw[pos:pos+n]
        pos += n
        value = value.lstrip(b"\x00")
        values.append(value.rjust(32, b"\x00"))
    assert pos == len(raw)
    return b"".join(values)


class CallbackSignatureGuardTests(unittest.TestCase):
    worker_id = "w1-worker-01"
    instance_id = "i-0123456789abcdef0"
    challenge = "d" * 64
    callback_id = "44444444-4444-4444-8444-444444444444"

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix="w1-callback-test-")
        cls.private_key = Path(cls.tmp.name) / "private.pem"
        subprocess.run(
            ["openssl", "genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:P-256",
             "-out", str(cls.private_key)],
            check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        public_der = subprocess.run(
            ["openssl", "pkey", "-in", str(cls.private_key), "-pubout", "-outform", "DER"],
            check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        ).stdout
        assert public_der.startswith(guard.P256_SPKI_PREFIX)
        point = public_der[len(guard.P256_SPKI_PREFIX):]
        b64u = lambda raw: base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")
        cls.jwk = {"crv": "P-256", "kty": "EC", "x": b64u(point[:32]), "y": b64u(point[32:])}
        cls.key_id = guard.jwk_key_id(cls.jwk)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def enrollment_record(self):
        return {
            "schema": guard.ENROLLMENT_SCHEMA,
            "provider_kind": "AWS_EC2",
            "provider_instance_id": self.instance_id,
            "algorithm": guard.ALGORITHM,
            "key_id": self.key_id,
            "public_jwk": copy.deepcopy(self.jwk),
            "observed_at": "2026-08-28T02:00:00+00:00",
            "private_key_exported": False,
            "canonical": False,
            "authority_effect": False,
            "worker_admitted": False,
            "w1_verified": False,
            "persistent_worker_proof": False,
            "reboot_completion_proven": False,
        }

    def enrollment_invocation(self, record=None):
        record = record or self.enrollment_record()
        return {
            "CommandId": "11111111-1111-4111-8111-111111111111",
            "InstanceId": self.instance_id,
            "DocumentName": guard.KEY_DOCUMENT_NAME,
            "DocumentVersion": guard.KEY_DOCUMENT_VERSION,
            "PluginName": guard.KEY_PLUGIN_NAME,
            "Status": "Success",
            "StatusDetails": "Success",
            "ResponseCode": 0,
            "StandardOutputContent": guard.ENROLLMENT_PREFIX + canonical(record).decode() + "\n",
            "StandardOutputUrl": "",
            "StandardErrorContent": "",
            "StandardErrorUrl": "",
            "CloudWatchOutputConfig": {"CloudWatchOutputEnabled": False, "CloudWatchLogGroupName": ""},
        }

    def marker(self):
        return {
            "schema": marker_guard.MARKER_SCHEMA,
            "marker_id": "33333333-3333-4333-8333-333333333333",
            "worker_id": self.worker_id,
            "provider_kind": "AWS_EC2",
            "provider_instance_id": self.instance_id,
            "package_source_commit": "73ab09c75b71a6ea40f11e953cbcf9d9b94b9a89",
            "package_sha256": "a" * 64,
            "payload_lock_sha256": "b" * 64,
            "execution_payload_sha256": "c" * 64,
            "callback_key_id": self.key_id,
            "callback_challenge_nonce": self.challenge,
            "observed_at": "2026-08-28T02:00:03+00:00",
            "host_safety_verified": False,
            "persistent_worker_proof": False,
            "worker_admitted": False,
            "w1_verified": False,
            "canonical": False,
            "authority_effect": False,
        }

    def envelope(self, marker=None):
        marker = marker or self.marker()
        message = guard.DOMAIN + canonical(marker)
        der = subprocess.run(
            ["openssl", "dgst", "-sha256", "-sign", str(self.private_key)],
            input=message, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        ).stdout
        raw = der_to_p1363(der)
        return {
            "schema": guard.CALLBACK_ENVELOPE_SCHEMA,
            "algorithm": guard.ALGORITHM,
            "key_id": self.key_id,
            "marker": marker,
            "signed_payload_sha256": hashlib.sha256(message).hexdigest(),
            "signature_b64u": base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii"),
        }

    def verify(self, envelope=None, enrollment=None, challenge=None, received_at=None):
        return guard.verify_callback_envelope(
            envelope or self.envelope(),
            key_enrollment_invocation=enrollment or self.enrollment_invocation(),
            expected_worker_id=self.worker_id,
            expected_instance_id=self.instance_id,
            expected_challenge_nonce=challenge or self.challenge,
            callback_receipt_id=self.callback_id,
            received_at=received_at or "2026-08-28T02:00:04+00:00",
        )

    def test_real_openssl_signature_verifies_and_yields_nonauthority_attestation(self):
        result = self.verify()
        self.assertTrue(result["accepted"])
        self.assertTrue(result["auth_verified"])
        self.assertEqual("WORKER_ENROLLMENT_SIGNATURE_V1", result["auth_kind"])
        self.assertEqual(self.key_id, result["key_id"])
        for field in ("database_persistence_verified", "persistent_worker_proof", "worker_admitted",
                      "w1_verified", "canonical", "authority_effect"):
            self.assertIs(result[field], False, field)

    def test_webcrypto_p1363_interoperability(self):
        envelope = self.envelope()
        marker = envelope["marker"]
        message = guard.DOMAIN + canonical(marker)
        script = r"""
const { webcrypto } = require('node:crypto');
(async () => {
  const jwk = JSON.parse(process.argv[1]);
  const sig = Buffer.from(process.argv[2].replace(/-/g,'+').replace(/_/g,'/'), 'base64');
  const msg = Buffer.from(process.argv[3], 'base64');
  const key = await webcrypto.subtle.importKey('jwk', jwk, {name:'ECDSA', namedCurve:'P-256'}, false, ['verify']);
  const ok = await webcrypto.subtle.verify({name:'ECDSA', hash:'SHA-256'}, key, sig, msg);
  process.stdout.write(ok ? 'OK' : 'FAIL');
})().catch((e) => { console.error(e); process.exit(2); });
"""
        proc = subprocess.run(
            ["node", "-e", script, json.dumps(self.jwk), envelope["signature_b64u"],
             base64.b64encode(message).decode("ascii")],
            check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        self.assertEqual("OK", proc.stdout)

    def test_tampered_marker_signature_fails_closed(self):
        envelope = self.envelope()
        envelope["marker"]["package_sha256"] = "e" * 64
        envelope["signed_payload_sha256"] = hashlib.sha256(
            guard.DOMAIN + canonical(envelope["marker"])
        ).hexdigest()
        with self.assertRaisesRegex(guard.CallbackSignatureError, "signature_verification_failed"):
            self.verify(envelope=envelope)

    def test_wrong_challenge_fails_before_signature_acceptance(self):
        with self.assertRaisesRegex(guard.CallbackSignatureError, "callback_challenge_mismatch"):
            self.verify(challenge="e" * 64)

    def test_wrong_key_id_and_instance_are_rejected(self):
        envelope = self.envelope()
        envelope["key_id"] = "f" * 64
        with self.assertRaisesRegex(guard.CallbackSignatureError, "key_binding_invalid"):
            self.verify(envelope=envelope)
        enrollment = self.enrollment_invocation()
        enrollment["InstanceId"] = "i-0fedcba9876543210"
        with self.assertRaisesRegex(guard.CallbackSignatureError, "instance_mismatch"):
            self.verify(enrollment=enrollment)

    def test_enrollment_transport_side_channels_are_rejected(self):
        enrollment = self.enrollment_invocation()
        enrollment["StandardOutputUrl"] = "https://example.invalid/leak"
        with self.assertRaisesRegex(guard.CallbackSignatureError, "output_url_forbidden"):
            self.verify(enrollment=enrollment)
        enrollment = self.enrollment_invocation()
        enrollment["CloudWatchOutputConfig"]["CloudWatchOutputEnabled"] = True
        with self.assertRaisesRegex(guard.CallbackSignatureError, "cloudwatch_forbidden"):
            self.verify(enrollment=enrollment)

    def test_private_key_export_claim_and_authority_escalation_are_rejected(self):
        record = self.enrollment_record()
        record["private_key_exported"] = True
        with self.assertRaisesRegex(guard.CallbackSignatureError, "private_key_export_claim_invalid"):
            self.verify(enrollment=self.enrollment_invocation(record))
        marker = self.marker()
        marker["w1_verified"] = True
        with self.assertRaisesRegex(guard.CallbackSignatureError, "callback_marker_nonclaim_invalid:w1_verified"):
            self.verify(envelope=self.envelope(marker))

    def test_stale_or_future_receipt_is_rejected(self):
        with self.assertRaisesRegex(guard.CallbackSignatureError, "time_outside_window"):
            self.verify(received_at="2026-08-28T02:10:04+00:00")
        with self.assertRaisesRegex(guard.CallbackSignatureError, "time_outside_window"):
            self.verify(received_at="2026-08-28T01:58:00+00:00")

    def test_malformed_signature_and_jwk_fail_closed(self):
        envelope = self.envelope()
        envelope["signature_b64u"] = "AA"
        with self.assertRaisesRegex(guard.CallbackSignatureError, "signature_size_invalid"):
            self.verify(envelope=envelope)
        record = self.enrollment_record()
        record["public_jwk"]["crv"] = "P-384"
        with self.assertRaisesRegex(guard.CallbackSignatureError, "public_jwk_curve_invalid"):
            self.verify(enrollment=self.enrollment_invocation(record))


if __name__ == "__main__":
    unittest.main()
