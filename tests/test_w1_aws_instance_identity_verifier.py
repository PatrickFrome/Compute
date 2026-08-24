from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from controller.w1 import aws_instance_identity_verifier as v


INSTANCE_ID = "i-0123456789abcdef0"
ACCOUNT_ID = "123456789012"
REGION = "us-east-2"


def make_document(**overrides) -> bytes:
    doc = {
        "accountId": ACCOUNT_ID,
        "architecture": "x86_64",
        "availabilityZone": "us-east-2a",
        "imageId": "ami-0123456789abcdef0",
        "instanceId": INSTANCE_ID,
        "instanceType": "t3.small",
        "pendingTime": "2026-08-23T08:00:00Z",
        "privateIp": "10.0.1.20",
        "region": REGION,
        "version": "2017-09-30",
    }
    doc.update(overrides)
    return json.dumps(doc, sort_keys=True, separators=(",", ":")).encode()


def make_signing_material(document: bytes):
    td = tempfile.TemporaryDirectory()
    root = Path(td.name)
    key = root / "key.pem"
    cert = root / "cert.pem"
    sig = root / "sig.pem"
    doc = root / "document.json"
    doc.write_bytes(document)
    subprocess.run(
        [
            "openssl",
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-keyout",
            str(key),
            "-out",
            str(cert),
            "-subj",
            "/CN=metaengine-test",
            "-days",
            "1",
        ],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    subprocess.run(
        [
            "openssl",
            "smime",
            "-sign",
            "-binary",
            "-in",
            str(doc),
            "-signer",
            str(cert),
            "-inkey",
            str(key),
            "-outform",
            "PEM",
            "-nodetach",
            "-out",
            str(sig),
        ],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return td, cert.read_bytes(), sig.read_bytes()


def trusted_verify(document: bytes):
    td, cert, sig = make_signing_material(document)
    fp = v.certificate_der_sha256(cert)
    patcher = patch.dict(v.AWS_RSA2048_CERT_DER_SHA256_BY_REGION, {REGION: fp}, clear=False)
    patcher.start()
    try:
        result = v.verify_instance_identity(
            document_raw=document,
            rsa2048_signature_raw=sig,
            certificate_pem=cert,
            expected_instance_id=INSTANCE_ID,
            expected_account_id=ACCOUNT_ID,
            expected_region=REGION,
        )
    finally:
        patcher.stop()
        td.cleanup()
    return result


def reboot_receipt():
    return {
        "schema": v.INPUT_RECEIPT_SCHEMA,
        "classification": "LIVE_PROVIDER_CONTROLLER_RECEIPT_UNINGESTED",
        "worker_id": "w1-aws-001",
        "provider_kind": "AWS_EC2",
        "provider_instance_id": INSTANCE_ID,
        "action_kind": "REBOOT",
        "action_id": "11111111-2222-3333-4444-555555555555",
        "requested_at": "2026-08-23T08:01:00+00:00",
        "completed_at": "2026-08-23T08:01:02Z",
        "completed_at_semantics": "PROVIDER_REQUEST_ACCEPTED_AT_NOT_REBOOT_COMPLETION",
        "identity_attestation_kind": "PROVIDER_METADATA",
        "identity_attestation_verified": False,
        "evidence": {
            "schema": "metaengine.compute.w1-aws-provider-evidence.h205f22.v1",
            "provider_action_semantics": "ASYNC_REBOOT_REQUEST_ACCEPTED",
            "schema_completed_at_semantics": "CLOUDTRAIL_PROVIDER_REQUEST_EVENT_TIME",
            "github": {"run_id": "1", "run_attempt": "1", "role_session": "w1-1-1"},
            "caller_identity": {
                "Account": ACCOUNT_ID,
                "Arn": "arn:aws:sts::123456789012:assumed-role/metaengine-w1-controller/w1-1-1",
            },
            "preflight": {
                "schema": "metaengine.compute.w1-aws-preflight.h205f22.v1",
                "instance_id": INSTANCE_ID,
                "worker_id": "w1-aws-001",
                "worker_bundle_github_sha": "a" * 40,
                "state": "running",
                "availability_zone": "us-east-2a",
                "instance_type": "t3.small",
                "image_id": "ami-0123456789abcdef0",
                "private_ip": "10.0.1.20",
                "public_ip_present": False,
                "security_group_ids": ["sg-0123abcd"],
                "root_volume_id": "vol-0123abcd",
                "root_volume_encrypted": True,
                "root_volume_type": "gp3",
                "imdsv2_required": True,
                "imds_hop_limit": 1,
                "authority_effect": False,
                "canonical": False,
            },
            "cloudtrail": {
                "cloudtrail_event": {
                    "eventSource": "ec2.amazonaws.com",
                    "eventName": "RebootInstances",
                    "awsRegion": REGION,
                    "eventID": "11111111-2222-3333-4444-555555555555",
                    "eventTime": "2026-08-23T08:01:02Z",
                },
                "lookup_event": {"EventName": "RebootInstances"},
            },
            "api_returned_at": "2026-08-23T08:01:01+00:00",
        },
        "evidence_artifact_sha256": "a" * 64,
        "canonical": False,
        "authority_effect": False,
        "persistent_worker_proof": False,
        "w1_verified": False,
    }


class IdentityVerifierTests(unittest.TestCase):
    def test_production_pin_is_exact_lowercase_sha256(self):
        pin = v.AWS_RSA2048_CERT_DER_SHA256_BY_REGION[REGION]
        self.assertRegex(pin, r"^[0-9a-f]{64}$")
        self.assertEqual(
            pin,
            "aa6f3e8afcd5e477501fbaf9d19f0945c7d94548f5a2de6375d8bfbab744cae0",
        )

    def test_valid_signed_identity_is_non_authoritative(self):
        result = trusted_verify(make_document())
        self.assertEqual(result["classification"], "SIGNED_PROVIDER_IDENTITY_VERIFIED_NONAUTHORITY")
        self.assertEqual(result["identity_attestation_kind"], "SIGNED_PROVIDER_IDENTITY")
        self.assertTrue(result["identity_attestation_verified"])
        self.assertEqual(result["evidence"]["provider_instance_id"], INSTANCE_ID)
        self.assertFalse(result["persistent_worker_proof"])
        self.assertFalse(result["reboot_completion_proven"])
        self.assertFalse(result["w1_verified"])
        self.assertFalse(result["canonical"])
        self.assertFalse(result["authority_effect"])

    def test_unpinned_certificate_is_rejected(self):
        document = make_document()
        td, cert, sig = make_signing_material(document)
        try:
            with self.assertRaisesRegex(v.IdentityVerificationError, "aws_certificate_pin_mismatch"):
                v.verify_instance_identity(
                    document_raw=document,
                    rsa2048_signature_raw=sig,
                    certificate_pem=cert,
                    expected_instance_id=INSTANCE_ID,
                    expected_account_id=ACCOUNT_ID,
                    expected_region=REGION,
                )
        finally:
            td.cleanup()

    def test_embedded_attacker_certificate_cannot_override_pinned_signer(self):
        document = make_document()
        trusted_td, trusted_cert, _trusted_sig = make_signing_material(document)
        attacker_td, _attacker_cert, attacker_sig = make_signing_material(document)
        trusted_fp = v.certificate_der_sha256(trusted_cert)
        try:
            with patch.dict(v.AWS_RSA2048_CERT_DER_SHA256_BY_REGION, {REGION: trusted_fp}, clear=False):
                with self.assertRaisesRegex(v.IdentityVerificationError, "rsa2048_signature_verification_failed"):
                    v.verify_instance_identity(
                        document_raw=document,
                        rsa2048_signature_raw=attacker_sig,
                        certificate_pem=trusted_cert,
                        expected_instance_id=INSTANCE_ID,
                        expected_account_id=ACCOUNT_ID,
                        expected_region=REGION,
                    )
        finally:
            trusted_td.cleanup()
            attacker_td.cleanup()

    def test_tampered_document_is_rejected(self):
        original = make_document()
        td, cert, sig = make_signing_material(original)
        fp = v.certificate_der_sha256(cert)
        tampered = make_document(privateIp="10.0.1.99")
        try:
            with patch.dict(v.AWS_RSA2048_CERT_DER_SHA256_BY_REGION, {REGION: fp}, clear=False):
                with self.assertRaisesRegex(v.IdentityVerificationError, "signed_document_bytes_mismatch"):
                    v.verify_instance_identity(
                        document_raw=tampered,
                        rsa2048_signature_raw=sig,
                        certificate_pem=cert,
                        expected_instance_id=INSTANCE_ID,
                        expected_account_id=ACCOUNT_ID,
                        expected_region=REGION,
                    )
        finally:
            td.cleanup()

    def test_wrong_instance_account_and_region_are_rejected(self):
        with self.assertRaisesRegex(v.IdentityVerificationError, "instance_identity_mismatch"):
            trusted_verify(make_document(instanceId="i-0deadbeef"))
        with self.assertRaisesRegex(v.IdentityVerificationError, "account_identity_mismatch"):
            trusted_verify(make_document(accountId="999999999999"))
        with self.assertRaisesRegex(v.IdentityVerificationError, "region_identity_mismatch"):
            trusted_verify(make_document(region="us-east-1"))

    def test_unknown_region_without_pin_is_rejected(self):
        document = make_document(region="us-west-2", availabilityZone="us-west-2a")
        td, cert, sig = make_signing_material(document)
        try:
            with self.assertRaisesRegex(v.IdentityVerificationError, "region_certificate_pin_unavailable"):
                v.verify_instance_identity(
                    document_raw=document,
                    rsa2048_signature_raw=sig,
                    certificate_pem=cert,
                    expected_instance_id=INSTANCE_ID,
                    expected_account_id=ACCOUNT_ID,
                    expected_region="us-west-2",
                )
        finally:
            td.cleanup()

    def test_binding_upgrades_only_provider_identity(self):
        identity = trusted_verify(make_document())
        original = reboot_receipt()
        bound = v.bind_verified_identity(reboot_receipt=original, verified_identity=identity)
        self.assertEqual(bound["schema"], v.OUTPUT_RECEIPT_SCHEMA)
        self.assertEqual(bound["identity_attestation_kind"], "SIGNED_PROVIDER_IDENTITY")
        self.assertTrue(bound["identity_attestation_verified"])
        self.assertIn("signed_provider_identity", bound["evidence"])
        self.assertRegex(bound["evidence_artifact_sha256"], r"^[0-9a-f]{64}$")
        self.assertFalse(bound["persistent_worker_proof"])
        self.assertFalse(bound["w1_verified"])
        self.assertFalse(bound["canonical"])
        self.assertFalse(bound["authority_effect"])
        self.assertEqual(
            bound["completed_at_semantics"],
            "PROVIDER_REQUEST_ACCEPTED_AT_NOT_REBOOT_COMPLETION",
        )
        self.assertFalse(original["identity_attestation_verified"])

    def test_binding_rejects_instance_region_and_account_aliasing(self):
        identity = trusted_verify(make_document())

        bad = reboot_receipt()
        bad["provider_instance_id"] = "i-0badbadbad"
        with self.assertRaisesRegex(v.IdentityVerificationError, "provider_instance_binding_mismatch"):
            v.bind_verified_identity(reboot_receipt=bad, verified_identity=identity)

        bad = reboot_receipt()
        bad["evidence"]["cloudtrail"]["cloudtrail_event"]["awsRegion"] = "us-east-1"
        with self.assertRaisesRegex(v.IdentityVerificationError, "cloudtrail_region_binding_mismatch"):
            v.bind_verified_identity(reboot_receipt=bad, verified_identity=identity)

        bad = reboot_receipt()
        bad["evidence"]["caller_identity"]["Account"] = "999999999999"
        with self.assertRaisesRegex(v.IdentityVerificationError, "caller_account_binding_mismatch"):
            v.bind_verified_identity(reboot_receipt=bad, verified_identity=identity)

    def test_binding_rejects_authority_escalation_and_completion_reinterpretation(self):
        identity = trusted_verify(make_document())

        bad = reboot_receipt()
        bad["authority_effect"] = True
        with self.assertRaisesRegex(v.IdentityVerificationError, "authority_boundary_invalid"):
            v.bind_verified_identity(reboot_receipt=bad, verified_identity=identity)

        bad = reboot_receipt()
        bad["completed_at_semantics"] = "REBOOT_COMPLETED"
        with self.assertRaisesRegex(v.IdentityVerificationError, "completion_semantics_invalid"):
            v.bind_verified_identity(reboot_receipt=bad, verified_identity=identity)


if __name__ == "__main__":
    unittest.main()
