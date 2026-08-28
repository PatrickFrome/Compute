from __future__ import annotations

import copy
import unittest

from controller.w1 import w1_trusted_receipt_attestor_guard as g


class TrustedReceiptAttestorGuardTests(unittest.TestCase):
    def setUp(self) -> None:
        self.subject = g.build_smoke_subject(
            source_sha="a" * 40,
            source_tree="b" * 40,
            source_ref="refs/heads/work/main-roadmap-accelerators-v16",
            run_id="33194000000",
            run_attempt="1",
        )
        self.raw = g.canonical(self.subject)
        self.sha = g.sha256_bytes(self.raw)
        self.workflow_ref = (
            "PatrickFrome/Compute/.github/workflows/"
            "w1-trusted-receipt-attestor-contract.yml@"
            "refs/heads/work/main-roadmap-accelerators-v16"
        )

    def validate(self, subject=None, sha=None, workflow_ref=None):
        return g.validate_smoke_subject(
            self.subject if subject is None else subject,
            expected_sha256=self.sha if sha is None else sha,
            source_sha="a" * 40,
            source_ref="refs/heads/work/main-roadmap-accelerators-v16",
            run_id="33194000000",
            run_attempt="1",
            workflow_ref=self.workflow_ref if workflow_ref is None else workflow_ref,
        )

    def test_happy_path_is_semantic_validation_only(self):
        receipt = self.validate()
        self.assertTrue(receipt["subject_semantics_validated"])
        self.assertTrue(receipt["caller_workflow_allowlist_verified"])
        self.assertTrue(receipt["reusable_signer_boundary_expected"])
        self.assertFalse(receipt["producer_attestation_verified"])
        self.assertFalse(receipt["live_w1_receipt_authenticated"])
        self.assertFalse(receipt["persistent_worker_proof"])
        self.assertFalse(receipt["w1_verified"])
        self.assertFalse(receipt["authority_effect"])
        self.assertEqual(receipt["evidence_sha256"], g.sha256_bytes(g.canonical(receipt["evidence"])))

    def test_subject_builder_is_deterministic(self):
        other = g.build_smoke_subject(
            source_sha="a" * 40,
            source_tree="b" * 40,
            source_ref="refs/heads/work/main-roadmap-accelerators-v16",
            run_id="33194000000",
            run_attempt="1",
        )
        self.assertEqual(self.subject, other)
        self.assertEqual(g.canonical(self.subject), g.canonical(other))

    def test_digest_tamper_rejected(self):
        with self.assertRaisesRegex(g.AttestorGuardError, "subject_sha256_mismatch"):
            self.validate(sha="f" * 64)

    def test_authority_injection_rejected(self):
        bad = copy.deepcopy(self.subject)
        bad["w1_verified"] = True
        bad_sha = g.sha256_bytes(g.canonical(bad))
        with self.assertRaisesRegex(g.AttestorGuardError, "authority_boundary_invalid:w1_verified"):
            self.validate(subject=bad, sha=bad_sha)

    def test_wrong_caller_workflow_ref_rejected(self):
        with self.assertRaisesRegex(g.AttestorGuardError, "caller_workflow_ref_mismatch"):
            self.validate(
                workflow_ref=(
                    "PatrickFrome/Compute/.github/workflows/arbitrary.yml@"
                    "refs/heads/work/main-roadmap-accelerators-v16"
                )
            )

    def test_subject_claimed_caller_workflow_drift_rejected(self):
        bad = copy.deepcopy(self.subject)
        bad["caller_workflow"] = ".github/workflows/arbitrary.yml"
        bad_sha = g.sha256_bytes(g.canonical(bad))
        with self.assertRaisesRegex(g.AttestorGuardError, "subject_field_mismatch:caller_workflow"):
            self.validate(subject=bad, sha=bad_sha)

    def test_source_sha_drift_rejected(self):
        bad = copy.deepcopy(self.subject)
        bad["source_sha"] = "c" * 40
        bad_sha = g.sha256_bytes(g.canonical(bad))
        with self.assertRaisesRegex(g.AttestorGuardError, "subject_field_mismatch:source_sha"):
            self.validate(subject=bad, sha=bad_sha)

    def test_source_ref_outside_v16_rejected_at_build(self):
        with self.assertRaisesRegex(g.AttestorGuardError, "source_ref_not_v16_smoke_branch"):
            g.build_smoke_subject(
                source_sha="a" * 40,
                source_tree="b" * 40,
                source_ref="refs/heads/main",
                run_id="33194000000",
                run_attempt="1",
            )

    def test_signer_workflow_claim_drift_rejected(self):
        bad = copy.deepcopy(self.subject)
        bad["signer_workflow"] = ".github/workflows/arbitrary-signer.yml"
        bad_sha = g.sha256_bytes(g.canonical(bad))
        with self.assertRaisesRegex(g.AttestorGuardError, "subject_field_mismatch:signer_workflow"):
            self.validate(subject=bad, sha=bad_sha)


if __name__ == "__main__":
    unittest.main()
