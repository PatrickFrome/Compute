import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from controller.r1.supervisor_r2_ingestion_authority_gate import (
    AUTHORITY_GATE_SCHEMA,
    AuthorityGateError,
    build_gh_verify_command,
    evaluate_authority_gate,
)
from controller.r1.supervisor_r2_ingestion_gate import build_root_context

NOW = datetime(2026, 8, 21, 21, 45, tzinfo=timezone.utc)
HEAD = "1" * 40


class SupervisorR2IngestionAuthorityGateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.package = self.root / "package.tar"
        self.package.write_bytes(b"placeholder")
        self.receipt = self.root / "receipt.json"
        self.receipt.write_text("{}\n")
        self.ciphertext = self.root / "ciphertext.age"
        self.ciphertext.write_bytes(b"exact ciphertext\n")
        self.trusted_root = self.root / "trusted-root.jsonl"
        self.trusted_root.write_text(json.dumps({"root": "fresh"}) + "\n")
        context = build_root_context(
            trusted_root_path=self.trusted_root,
            acquired_at=(NOW - timedelta(minutes=1)).isoformat(),
            source_head_sha=HEAD,
        )
        self.context = self.root / "root-context.json"
        self.context.write_text(json.dumps(context, sort_keys=True, separators=(",", ":")) + "\n")
        self.entries = {
            "source/r1-recovery-source-verification.json": json.dumps({"source": {"head_sha": HEAD, "run_id": 123}}).encode() + b"\n",
            "source/r1-recovery-source-attestation.sigstore.jsonl": json.dumps({"bundle": "portable"}).encode() + b"\n",
        }
        self.package_receipt = {"package_sha256": "a" * 64, "db_projection_sha256": "b" * 64}
        self.core = {
            "gate_receipt_sha256": "c" * 64,
            "ingestion_eligible": True,
            "database_write_performed": False,
            "canonical": False,
            "authority_effect": False,
            "r2_proven": False,
            "r3_proven": False,
            "persisted_seal_allowed": False,
        }

    def tearDown(self):
        self.tmp.cleanup()

    def _run(self, runner, core=None):
        with patch("controller.r1.supervisor_r2_ingestion_authority_gate._load_package", return_value=(self.entries, self.package_receipt, {}, {})), \
             patch("controller.r1.supervisor_r2_ingestion_authority_gate.evaluate_gate", return_value=core or self.core):
            return evaluate_authority_gate(
                package_path=self.package,
                package_receipt_path=self.receipt,
                ciphertext_path=self.ciphertext,
                fresh_trusted_root_path=self.trusted_root,
                root_context_path=self.context,
                effective_at=NOW.isoformat(),
                gh_bin="gh-test",
                runner=runner,
            )

    def test_command_pins_all_required_identity_policy(self):
        command = build_gh_verify_command(
            gh_bin="gh",
            ciphertext_path=Path("cipher.age"),
            bundle_path=Path("bundle.jsonl"),
            trusted_root_path=Path("root.jsonl"),
            source_head_sha=HEAD,
        )
        joined = " ".join(command)
        self.assertIn("--repo PatrickFrome/Compute", joined)
        self.assertIn("--signer-workflow PatrickFrome/Compute/.github/workflows/r1-live-recovery-source.yml", joined)
        self.assertIn(f"--signer-digest {HEAD}", joined)
        self.assertIn("--source-ref refs/heads/main", joined)
        self.assertIn(f"--source-digest {HEAD}", joined)
        self.assertIn("--cert-oidc-issuer https://token.actions.githubusercontent.com", joined)
        self.assertIn("--predicate-type https://github.com/PatrickFrome/Compute/attestations/r1-recovery-source/v1", joined)
        self.assertIn("--deny-self-hosted-runners", command)
        self.assertIn("--custom-trusted-root", command)
        self.assertEqual(command[-2:], ["--format", "json"])

    def test_wrapper_executes_gh_itself_and_only_then_marks_step09b_eligible(self):
        seen = []

        def runner(command):
            seen.append(command)
            return json.dumps([{"verificationResult": {"statement": {}, "verifiedTimestamps": [{"type": "tlog"}]}}])

        result = self._run(runner)
        self.assertEqual(result["schema"], AUTHORITY_GATE_SCHEMA)
        self.assertTrue(result["step09b_ingestion_eligible"])
        self.assertTrue(result["gh_attestation_verification"]["executed_by_this_gate"])
        self.assertTrue(result["gh_attestation_verification"]["offline_bundle_used"])
        self.assertTrue(result["gh_attestation_verification"]["custom_fresh_trusted_root_used"])
        self.assertEqual(len(seen), 1)
        self.assertEqual(seen[0][0], "gh-test")
        self.assertFalse(result["database_credential_present"])
        self.assertFalse(result["database_write_performed"])
        self.assertFalse(result["r2_proven"])
        self.assertFalse(result["persisted_seal_allowed"])

    def test_invalid_gh_json_fails_closed_before_step09b(self):
        with self.assertRaisesRegex(AuthorityGateError, "invalid_json"):
            self._run(lambda _command: "not-json")

    def test_multiple_verified_results_are_rejected(self):
        data = json.dumps([{"verificationResult": {}}, {"verificationResult": {}}])
        with self.assertRaisesRegex(AuthorityGateError, "result_not_single"):
            self._run(lambda _command: data)

    def test_core_candidate_must_be_eligible_and_nonauthoritative(self):
        bad = dict(self.core)
        bad["ingestion_eligible"] = False
        with self.assertRaisesRegex(AuthorityGateError, "core_ingestion_gate_not_eligible"):
            self._run(lambda _command: json.dumps([{"verificationResult": {}}]), core=bad)

        escalated = dict(self.core)
        escalated["r2_proven"] = True
        with self.assertRaisesRegex(AuthorityGateError, "authority_boundary"):
            self._run(lambda _command: json.dumps([{"verificationResult": {}}]), core=escalated)


if __name__ == "__main__":
    unittest.main()
