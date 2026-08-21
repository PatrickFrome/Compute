import copy
import hashlib
import io
import json
import tarfile
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from controller.r1.final_r2_evidence_package import PACKAGE_SCHEMA, PROJECTION_SCHEMA, RECEIPT_SCHEMA
from controller.r1.supervisor_r2_ingestion_gate import (
    GATE_SCHEMA,
    ROOT_CONTEXT_MAX_AGE,
    SupervisorGateError,
    build_root_context,
    evaluate_gate,
    expected_policy,
)

NOW = datetime(2026, 8, 21, 21, 30, tzinfo=timezone.utc)
HEAD = "1" * 40
CIPHER = b"materialized exact provider ciphertext\n"
CIPHER_SHA = hashlib.sha256(CIPHER).hexdigest()


def canon(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def seal(value, field):
    core = dict(value)
    core.pop(field, None)
    value[field] = hashlib.sha256(canon(core)).hexdigest()
    return value


class SupervisorR2IngestionGateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.ciphertext = self.root / "ciphertext.age"
        self.ciphertext.write_bytes(CIPHER)
        self.fresh_root = self.root / "fresh-root.jsonl"
        self.fresh_root.write_text(json.dumps({"mediaType": "application/vnd.dev.sigstore.trustedroot+json", "root": "current"}) + "\n")
        self.verification = self.root / "verification.json"
        self.predicate = {"schema": "test-predicate", "value": 7}
        self.verification.write_bytes(canon([{
            "verificationResult": {
                "verifiedTimestamps": [{"type": "tlog"}],
                "statement": {"predicate": self.predicate},
            }
        }]) + b"\n")
        self.package, self.receipt, self.source_verification = self._build_package()
        context = build_root_context(
            trusted_root_path=self.fresh_root,
            acquired_at=(NOW - timedelta(minutes=2)).isoformat(),
            source_head_sha=HEAD,
        )
        self.context = self._write_json("root-context.json", context)

    def tearDown(self):
        self.tmp.cleanup()

    def _write_json(self, name, value):
        path = self.root / name
        path.write_bytes(canon(value) + b"\n")
        return path

    def _tar(self, entries):
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w", format=tarfile.USTAR_FORMAT) as tf:
            for name in sorted(entries):
                data = entries[name]
                info = tarfile.TarInfo(name)
                info.size = len(data)
                info.mtime = 0
                info.mode = 0o600
                tf.addfile(info, io.BytesIO(data))
        return buf.getvalue()

    def _build_package(self, *, readback_age=timedelta(hours=1), projection_r2=False, extra_entry=None, traversal=False):
        readback_a = NOW - readback_age
        readback_b = readback_a + timedelta(minutes=2)
        latest = min(readback_a + timedelta(days=7), readback_b + timedelta(days=7))
        projection_core = {
            "schema": PROJECTION_SCHEMA,
            "classification": "PROPOSED_CONTINUITY_DB_INGESTION_NONAUTHORITATIVE",
            "object_insert_or_exact_match": {"subject_kind": "BACKUP_SET", "subject_id": f"r1-age-ciphertext:{CIPHER_SHA}", "expected_sha256": CIPHER_SHA},
            "domain_insert_or_exact_match": [{"domain_key": "aws-us-east-2"}, {"domain_key": "b2-us-west-004"}],
            "observation_inserts": [
                {"domain_key": "aws-us-east-2", "readback_at": readback_a.isoformat(), "status": "VERIFIED"},
                {"domain_key": "b2-us-west-004", "readback_at": readback_b.isoformat(), "status": "VERIFIED"},
            ],
            "r2_freshness_contract": {
                "max_age_seconds": 604800,
                "latest_effective_at_for_both_current_readbacks": latest.isoformat(),
                "package_does_not_refresh_readback_at": True,
            },
            "execution": {"sql_included": False, "database_write_performed": False},
            "canonical": False,
            "authority_effect": False,
            "r2_proven": projection_r2,
            "r3_proven": False,
            "persisted_seal_allowed": False,
        }
        projection = seal(projection_core, "projection_sha256")

        source_verification = {
            "source": {"head_sha": HEAD, "run_id": 12345},
            "source_environment_evidence": {
                "configuration": {"artifact_id": 5001},
                "approval": {"artifact_id": 5002},
            },
            "verification_receipt_sha256": "a" * 64,
        }
        entries = {
            "source/r1-recovery-source-verification.json": canon(source_verification) + b"\n",
            "source/r1-source-environment-readiness.json": b"{}\n",
            "source/r1-source-environment-approval.json": b"{}\n",
            "source/r1-recovery-source-predicate.json": canon(self.predicate) + b"\n",
            "source/r1-recovery-envelope-receipt.json": b"{}\n",
            "meta/r1-final-r2-db-ingestion-projection.json": canon(projection) + b"\n",
        }
        if extra_entry:
            entries[extra_entry] = b"unexpected\n"
        if traversal:
            entries["../escape.json"] = b"{}\n"

        content_entries = [
            {"path": name, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
            for name, data in sorted(entries.items())
        ]
        manifest_core = {
            "schema": PACKAGE_SCHEMA,
            "classification": "FINAL_R2_EVIDENCE_PACKAGE_NONAUTHORITATIVE",
            "content_entries": content_entries,
            "ciphertext": {"sha256": CIPHER_SHA, "bytes": len(CIPHER), "included_in_package": False},
            "db_projection_sha256": projection["projection_sha256"],
            "database_write_performed": False,
            "provider_call_performed": False,
            "canonical": False,
            "authority_effect": False,
            "r2_proven": False,
            "r3_proven": False,
            "persisted_seal_allowed": False,
        }
        manifest = seal(manifest_core, "manifest_sha256")
        entries["manifest.json"] = canon(manifest) + b"\n"
        package_bytes = self._tar(entries)
        package = self.root / f"package-{hashlib.sha256(package_bytes).hexdigest()[:8]}.tar"
        package.write_bytes(package_bytes)

        receipt_core = {
            "schema": RECEIPT_SCHEMA,
            "classification": "FINAL_R2_EVIDENCE_PACKAGE_NONAUTHORITATIVE",
            "package_sha256": hashlib.sha256(package_bytes).hexdigest(),
            "package_bytes": len(package_bytes),
            "manifest_sha256": manifest["manifest_sha256"],
            "db_projection_sha256": projection["projection_sha256"],
            "ciphertext_sha256": CIPHER_SHA,
            "ciphertext_included": False,
            "offline_reverification_required": True,
            "database_write_performed": False,
            "provider_call_performed": False,
            "canonical": False,
            "authority_effect": False,
            "r2_proven": False,
            "r3_proven": False,
            "persisted_seal_allowed": False,
        }
        receipt = seal(receipt_core, "receipt_sha256")
        receipt_path = self._write_json(f"receipt-{receipt['package_sha256'][:8]}.json", receipt)
        return package, receipt_path, source_verification

    def _base_verification(self):
        return {
            "verified_timestamp_count": 1,
            "verification_receipt_sha256": "b" * 64,
        }

    def _run(self, package=None, receipt=None, context=None, ciphertext=None, verification=None, effective=NOW):
        with patch("controller.r1.supervisor_r2_ingestion_gate.validate_verification_result", return_value=self._base_verification()), \
             patch("controller.r1.supervisor_r2_ingestion_gate.bind_verification", return_value=self.source_verification):
            return evaluate_gate(
                package_path=package or self.package,
                package_receipt_path=receipt or self.receipt,
                ciphertext_path=ciphertext or self.ciphertext,
                verification_path=verification or self.verification,
                fresh_trusted_root_path=self.fresh_root,
                root_context_path=context or self.context,
                effective_at=effective.isoformat(),
            )

    def test_valid_gate_is_ingestion_eligible_but_never_r2(self):
        result = self._run()
        self.assertEqual(result["schema"], GATE_SCHEMA)
        self.assertTrue(result["ingestion_eligible"])
        self.assertTrue(result["verification"]["source_attestation_reverified"])
        self.assertFalse(result["database_write_performed"])
        self.assertFalse(result["r2_proven"])
        self.assertFalse(result["persisted_seal_allowed"])
        core = dict(result); claimed = core.pop("gate_receipt_sha256")
        self.assertEqual(claimed, hashlib.sha256(canon(core)).hexdigest())

    def test_root_context_policy_is_exact_and_stale_root_is_rejected(self):
        root_sha = hashlib.sha256(self.fresh_root.read_bytes()).hexdigest()
        policy = expected_policy(HEAD, root_sha)
        self.assertTrue(policy["deny_self_hosted_runners"])
        self.assertEqual(policy["signer_digest"], HEAD)
        self.assertEqual(policy["source_digest"], HEAD)
        self.assertEqual(policy["source_ref"], "refs/heads/main")

        stale = build_root_context(
            trusted_root_path=self.fresh_root,
            acquired_at=(NOW - ROOT_CONTEXT_MAX_AGE - timedelta(seconds=1)).isoformat(),
            source_head_sha=HEAD,
        )
        stale_path = self._write_json("stale-context.json", stale)
        with self.assertRaisesRegex(SupervisorGateError, "context_stale"):
            self._run(context=stale_path)

    def test_recomputed_root_context_cannot_weaken_policy(self):
        value = json.loads(self.context.read_text())
        value["policy"]["deny_self_hosted_runners"] = False
        seal(value, "context_sha256")
        forged = self._write_json("forged-context.json", value)
        with self.assertRaisesRegex(SupervisorGateError, "policy_mismatch"):
            self._run(context=forged)

    def test_stale_readbacks_fail_before_db(self):
        package, receipt, source_verification = self._build_package(readback_age=timedelta(days=7, seconds=1))
        old = self.source_verification
        self.source_verification = source_verification
        try:
            with self.assertRaisesRegex(SupervisorGateError, "stale_for_ingestion"):
                self._run(package=package, receipt=receipt)
        finally:
            self.source_verification = old

    def test_materialized_ciphertext_identity_mismatch_rejected(self):
        bad = self.root / "bad.age"
        bad.write_bytes(CIPHER + b"tamper")
        with self.assertRaisesRegex(SupervisorGateError, "ciphertext_identity_mismatch"):
            self._run(ciphertext=bad)

    def test_verified_predicate_must_equal_packaged_predicate(self):
        bad_verification = self._write_json("bad-verification.json", [{
            "verificationResult": {
                "verifiedTimestamps": [{"type": "tlog"}],
                "statement": {"predicate": {"schema": "different"}},
            }
        }])
        with self.assertRaisesRegex(SupervisorGateError, "predicate_package_mismatch"):
            self._run(verification=bad_verification)

    def test_package_path_traversal_is_rejected(self):
        package, receipt, source_verification = self._build_package(traversal=True)
        old = self.source_verification
        self.source_verification = source_verification
        try:
            with self.assertRaisesRegex(SupervisorGateError, "member_path_invalid"):
                self._run(package=package, receipt=receipt)
        finally:
            self.source_verification = old

    def test_recomputed_projection_hash_cannot_claim_r2(self):
        package, receipt, source_verification = self._build_package(projection_r2=True)
        old = self.source_verification
        self.source_verification = source_verification
        try:
            with self.assertRaisesRegex(SupervisorGateError, "projection_authority_boundary_invalid"):
                self._run(package=package, receipt=receipt)
        finally:
            self.source_verification = old


if __name__ == "__main__":
    unittest.main()
