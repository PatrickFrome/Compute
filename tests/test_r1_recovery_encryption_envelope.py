import hashlib
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from controller.r1.recovery_encryption_envelope import (
    AGE_REQUIRED_VERSION,
    BUNDLE_CLASSIFICATION,
    BUNDLE_SCHEMA,
    PROFILE_COMPAT_TEST,
    PROFILE_PRODUCTION_PQ,
    EnvelopeError,
    _canonical_bytes,
    _sha256_bytes,
    build_envelope,
    load_recipients,
    validate_bundle_receipt,
    validate_envelope_receipt,
)


def fake_pq(ch: str) -> str:
    return "age1pq1" + ch * 80


def fake_classic(ch: str) -> str:
    return "age1" + ch * 64


class RecoveryEnvelopeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.bundle = self.root / "recovery.tar"
        self.bundle.write_bytes(b"deterministic recovery bundle bytes\n")
        bundle_sha = hashlib.sha256(self.bundle.read_bytes()).hexdigest()
        core = {
            "schema": BUNDLE_SCHEMA,
            "classification": BUNDLE_CLASSIFICATION,
            "manifest_sha256": "a" * 64,
            "bundle_sha256": bundle_sha,
            "bundle_bytes": self.bundle.stat().st_size,
            "storage_api_objects_included": False,
            "external_storage_ready": False,
            "canonical": False,
            "authority_effect": False,
            "r2_proven": False,
            "r3_proven": False,
            "persisted_seal_allowed": False,
            "required_next": "AGE_OR_EQUIVALENT_REVIEWED_ENCRYPTION_ENVELOPE",
        }
        receipt = dict(core)
        receipt["receipt_sha256"] = _sha256_bytes(_canonical_bytes(core))
        self.bundle_receipt = self.root / "bundle-receipt.json"
        self.bundle_receipt.write_bytes(_canonical_bytes(receipt) + b"\n")

    def tearDown(self):
        self.tmp.cleanup()

    def recipients(self, values):
        path = self.root / "recipients.txt"
        path.write_text("\n".join(values) + "\n")
        return path

    def test_production_requires_two_unique_pq_recipients(self):
        with self.assertRaisesRegex(EnvelopeError, "minimum_two"):
            load_recipients(self.recipients([fake_pq("a")]), PROFILE_PRODUCTION_PQ)
        with self.assertRaisesRegex(EnvelopeError, "duplicate"):
            load_recipients(self.recipients([fake_pq("a"), fake_pq("a")]), PROFILE_PRODUCTION_PQ)
        parsed = load_recipients(self.recipients([fake_pq("a"), fake_pq("b")]), PROFILE_PRODUCTION_PQ)
        self.assertEqual({x["kind"] for x in parsed}, {"MLKEM768_X25519_HYBRID"})

    def test_production_rejects_classic_recipient(self):
        with self.assertRaisesRegex(EnvelopeError, "requires_all_pq"):
            load_recipients(self.recipients([fake_pq("a"), fake_classic("b")]), PROFILE_PRODUCTION_PQ)

    def test_compatibility_profile_accepts_classic_but_is_not_production_ready(self):
        recipients = self.recipients([fake_classic("a"), fake_classic("b")])
        out = self.root / "compat.age"
        receipt_path = self.root / "compat.json"

        def fake_encrypt(_age, _recips, source, output):
            output.write_bytes(b"AGE-CIPHERTEXT:" + source.read_bytes())

        with mock.patch("controller.r1.recovery_encryption_envelope._age_version", return_value=AGE_REQUIRED_VERSION), \
             mock.patch("controller.r1.recovery_encryption_envelope._run_age_encrypt", side_effect=fake_encrypt):
            receipt = build_envelope(
                bundle=self.bundle,
                bundle_receipt_path=self.bundle_receipt,
                recipients_file=recipients,
                profile=PROFILE_COMPAT_TEST,
                age_bin=Path("/fake/age"),
                output_ciphertext=out,
                output_receipt=receipt_path,
            )
        self.assertFalse(receipt["security"]["external_storage_ready"])
        with self.assertRaisesRegex(EnvelopeError, "not_production_storage_ready"):
            validate_envelope_receipt(out, receipt_path)
        validate_envelope_receipt(out, receipt_path, require_production_ready=False)

    def test_identity_material_and_plugin_recipients_rejected(self):
        with self.assertRaisesRegex(EnvelopeError, "identity_material"):
            load_recipients(self.recipients(["AGE-SECRET-KEY-PQ-1" + "A" * 60, fake_pq("b")]), PROFILE_PRODUCTION_PQ)
        with self.assertRaisesRegex(EnvelopeError, "unsupported_age_recipient_type"):
            load_recipients(self.recipients(["age1plugin1" + "a" * 60, fake_pq("b")]), PROFILE_PRODUCTION_PQ)

    def test_bundle_bytes_tamper_rejected(self):
        self.bundle.write_bytes(self.bundle.read_bytes() + b"tamper")
        with self.assertRaisesRegex(EnvelopeError, "bundle_sha256_mismatch"):
            validate_bundle_receipt(self.bundle, self.bundle_receipt)

    def test_bundle_receipt_self_hash_tamper_rejected(self):
        value = json.loads(self.bundle_receipt.read_text())
        value["bundle_bytes"] += 1
        self.bundle_receipt.write_text(json.dumps(value))
        with self.assertRaisesRegex(EnvelopeError, "receipt_sha256_mismatch"):
            validate_bundle_receipt(self.bundle, self.bundle_receipt)

    def test_envelope_receipt_tamper_rejected(self):
        recipients = self.recipients([fake_pq("a"), fake_pq("b")])
        out = self.root / "prod.age"
        receipt_path = self.root / "prod.json"

        def fake_encrypt(_age, _recips, source, output):
            output.write_bytes(b"AGE-CIPHERTEXT:" + source.read_bytes())

        with mock.patch("controller.r1.recovery_encryption_envelope._age_version", return_value=AGE_REQUIRED_VERSION), \
             mock.patch("controller.r1.recovery_encryption_envelope._run_age_encrypt", side_effect=fake_encrypt):
            build_envelope(
                bundle=self.bundle,
                bundle_receipt_path=self.bundle_receipt,
                recipients_file=recipients,
                profile=PROFILE_PRODUCTION_PQ,
                age_bin=Path("/fake/age"),
                output_ciphertext=out,
                output_receipt=receipt_path,
            )
        value = json.loads(receipt_path.read_text())
        value["ciphertext"]["bytes"] += 1
        receipt_path.write_text(json.dumps(value))
        with self.assertRaisesRegex(EnvelopeError, "receipt_sha256_mismatch"):
            validate_envelope_receipt(out, receipt_path)

    def test_ciphertext_tamper_rejected(self):
        recipients = self.recipients([fake_pq("a"), fake_pq("b")])
        out = self.root / "prod.age"
        receipt_path = self.root / "prod.json"

        def fake_encrypt(_age, _recips, source, output):
            output.write_bytes(b"AGE-CIPHERTEXT:" + source.read_bytes())

        with mock.patch("controller.r1.recovery_encryption_envelope._age_version", return_value=AGE_REQUIRED_VERSION), \
             mock.patch("controller.r1.recovery_encryption_envelope._run_age_encrypt", side_effect=fake_encrypt):
            build_envelope(
                bundle=self.bundle,
                bundle_receipt_path=self.bundle_receipt,
                recipients_file=recipients,
                profile=PROFILE_PRODUCTION_PQ,
                age_bin=Path("/fake/age"),
                output_ciphertext=out,
                output_receipt=receipt_path,
            )
        out.write_bytes(out.read_bytes() + b"tamper")
        with self.assertRaisesRegex(EnvelopeError, "ciphertext_receipt_mismatch"):
            validate_envelope_receipt(out, receipt_path)

    @unittest.skipUnless(os.environ.get("AGE_BIN") and os.environ.get("AGE_KEYGEN_BIN"), "official age binaries not supplied")
    def test_official_age_pq_roundtrip_and_reencrypt_changes_ciphertext(self):
        age = Path(os.environ["AGE_BIN"])
        keygen = Path(os.environ["AGE_KEYGEN_BIN"])
        identities = []
        recipients = []
        for idx in (1, 2):
            identity = self.root / f"identity-{idx}.txt"
            subprocess.run([str(keygen), "-pq", "-o", str(identity)], check=True, capture_output=True, text=True)
            pub = subprocess.run([str(keygen), "-y", str(identity)], check=True, capture_output=True, text=True).stdout.strip()
            identities.append(identity)
            recipients.append(pub)
        recipients_file = self.recipients(recipients)

        out1 = self.root / "one.age"
        rec1 = self.root / "one.json"
        receipt1 = build_envelope(
            bundle=self.bundle,
            bundle_receipt_path=self.bundle_receipt,
            recipients_file=recipients_file,
            profile=PROFILE_PRODUCTION_PQ,
            age_bin=age,
            output_ciphertext=out1,
            output_receipt=rec1,
        )
        validate_envelope_receipt(out1, rec1)
        self.assertTrue(receipt1["security"]["external_storage_ready"])
        self.assertEqual(receipt1["encryption"]["recipient_count"], 2)

        decrypted = self.root / "decrypted.tar"
        subprocess.run([str(age), "--decrypt", "--identity", str(identities[0]), "--output", str(decrypted), str(out1)], check=True, capture_output=True)
        self.assertEqual(decrypted.read_bytes(), self.bundle.read_bytes())

        out2 = self.root / "two.age"
        rec2 = self.root / "two.json"
        receipt2 = build_envelope(
            bundle=self.bundle,
            bundle_receipt_path=self.bundle_receipt,
            recipients_file=recipients_file,
            profile=PROFILE_PRODUCTION_PQ,
            age_bin=age,
            output_ciphertext=out2,
            output_receipt=rec2,
        )
        self.assertNotEqual(receipt1["ciphertext"]["sha256"], receipt2["ciphertext"]["sha256"])
        self.assertEqual(receipt1["source_bundle"]["bundle_sha256"], receipt2["source_bundle"]["bundle_sha256"])


if __name__ == "__main__":
    unittest.main()
