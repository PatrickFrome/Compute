import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from controller.rsi.promotion_attestation import (
    EXPECTED_REPOSITORY,
    EXPECTED_REPOSITORY_ID,
    GATE_SCHEMA,
    PREDICATE_TYPE,
    TRUSTED_WORKFLOW_PATH,
    VERIFICATION_SCHEMA,
    PromotionAttestationError,
    _canonical_bytes,
    _sha256_json,
    build_attestation_predicate,
    build_promotion_subject,
    validate_gate,
    validate_verification_result,
)


CANDIDATE = "b" * 40
PARENT = "a" * 40
CANDIDATE_ID = "candidate_sha256_" + "c" * 64
SOURCE_HEAD = "d" * 40
SOURCE_RUN = 123456789


def gate(**overrides):
    core = {
        "schema": GATE_SCHEMA,
        "version": 1,
        "state": "READY_FOR_EXTERNAL_PROMOTION_REVIEW",
        "blockers": [],
        "candidate_id": CANDIDATE_ID,
        "candidate_sha": CANDIDATE,
        "parent_sha": PARENT,
        "handoff_digest": "sha256:" + "1" * 64,
        "tournament_plan_digest": "sha256:" + "2" * 64,
        "tournament_result_digest": "sha256:" + "3" * 64,
        "archive_admission_digest": "sha256:" + "4" * 64,
        "qualification_digest": "sha256:" + "5" * 64,
        "artifact_digest": "sha256:" + "6" * 64,
        "provenance_digest": "sha256:" + "7" * 64,
        "ready_for_external_promotion_review": True,
        "existing_self_update_handoff_authorized": False,
        "direct_install_authorized": False,
        "promotion_token": None,
        "scalar_winner": None,
        "execution_authority": False,
        "production_mutation_authority": False,
        "promotion_authority": False,
        "self_update_authority": False,
        "automatic_retry_allowed": False,
        "authority_effect": False,
    }
    core.update(overrides)
    core["gate_digest"] = "sha256:" + _sha256_json(core)
    return core


def write_subject(path: Path, subject: dict) -> str:
    raw = _canonical_bytes(subject) + b"\n"
    path.write_bytes(raw)
    return hashlib.sha256(raw).hexdigest()


def verification_for(subject_path: Path, predicate: dict, *, source_override=None, subject_digest_override=None):
    subject_sha = hashlib.sha256(subject_path.read_bytes()).hexdigest()
    pred = json.loads(json.dumps(predicate))
    if source_override:
        pred["source"].update(source_override)
        core = dict(pred)
        core.pop("predicate_sha256", None)
        pred["predicate_sha256"] = _sha256_json(core)
    return [{
        "verificationResult": {
            "verifiedTimestamps": [{"type": "TLOG", "timestamp": "2026-09-17T11:00:00Z"}],
            "statement": {
                "predicateType": PREDICATE_TYPE,
                "subject": [{"name": "rsi-promotion-review-subject.json", "digest": {"sha256": subject_digest_override or subject_sha}}],
                "predicate": pred,
            },
        },
    }]


class PromotionAttestationTest(unittest.TestCase):
    def make_fixture(self):
        g = gate()
        subject = build_promotion_subject(
            g,
            canary_evidence_digest="8" * 64,
            rollback_evidence_digest="9" * 64,
        )
        predicate = build_attestation_predicate(subject, source_head_sha=SOURCE_HEAD, run_id=SOURCE_RUN, run_attempt=1)
        return g, subject, predicate

    def test_subject_is_digest_bound_but_explicitly_non_authoritative(self):
        g, subject, _ = self.make_fixture()
        normalized = validate_gate(g)
        self.assertEqual(normalized["candidate_sha"], CANDIDATE)
        self.assertEqual(subject["artifact_sha256"], "6" * 64)
        self.assertEqual(subject["classification"], "RSI_PROMOTION_REVIEW_SUBJECT_NONAUTHORITY")
        self.assertFalse(subject["candidate_authored_subject_allowed"])
        self.assertFalse(subject["promotion_authority"])
        self.assertFalse(subject["self_update_authority"])
        self.assertFalse(subject["authority_effect"])
        self.assertRegex(subject["subject_sha256"], r"^[0-9a-f]{64}$")

    def test_consumer_accepts_exact_gh_attestation_verification_binding_only(self):
        _, subject, predicate = self.make_fixture()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "subject.json"
            write_subject(path, subject)
            receipt = validate_verification_result(
                verification=verification_for(path, predicate),
                subject_path=path,
                expected_source_head_sha=SOURCE_HEAD,
                expected_source_run_id=SOURCE_RUN,
            )
        self.assertEqual(receipt["schema"], VERIFICATION_SCHEMA)
        self.assertEqual(receipt["classification"], "CRYPTOGRAPHICALLY_VERIFIED_RSI_PROMOTION_REVIEW_NONAUTHORITATIVE")
        self.assertEqual(receipt["source"]["repository_id"], EXPECTED_REPOSITORY_ID)
        self.assertEqual(receipt["source"]["repository"], EXPECTED_REPOSITORY)
        self.assertEqual(receipt["source"]["workflow_path"], TRUSTED_WORKFLOW_PATH)
        self.assertTrue(receipt["source_attestation_verified"])
        self.assertFalse(receipt["promotion_authority"])
        self.assertFalse(receipt["self_update_authority"])
        self.assertFalse(receipt["direct_install_authorized"])
        self.assertRegex(receipt["verification_receipt_sha256"], r"^[0-9a-f]{64}$")

    def test_self_hash_or_claimed_verified_boolean_cannot_replace_attestation_origin(self):
        g, _, _ = self.make_fixture()
        forged = dict(g)
        forged["external_verifier"] = True
        forged["source_attestation_verified"] = True
        forged.pop("gate_digest", None)
        forged["gate_digest"] = "sha256:" + _sha256_json(forged)
        normalized = validate_gate(forged)
        self.assertEqual(normalized["candidate_sha"], CANDIDATE)
        # validate_gate proves only internal gate integrity. There is intentionally
        # no path from it to a cryptographically verified attestation receipt.
        self.assertNotIn("source_attestation_verified", normalized)

    def test_wrong_repository_workflow_head_or_run_binding_is_rejected(self):
        _, subject, predicate = self.make_fixture()
        mutations = [
            {"repository_id": 999},
            {"repository": "attacker/repo"},
            {"workflow_path": ".github/workflows/untrusted.yml"},
            {"head_sha": "e" * 40},
            {"run_id": SOURCE_RUN + 1},
            {"event": "pull_request"},
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "subject.json"
            write_subject(path, subject)
            for mutation in mutations:
                with self.subTest(mutation=mutation):
                    with self.assertRaisesRegex(PromotionAttestationError, "source_binding_mismatch"):
                        validate_verification_result(
                            verification=verification_for(path, predicate, source_override=mutation),
                            subject_path=path,
                            expected_source_head_sha=SOURCE_HEAD,
                            expected_source_run_id=SOURCE_RUN,
                        )

    def test_attested_file_digest_mismatch_is_rejected(self):
        _, subject, predicate = self.make_fixture()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "subject.json"
            write_subject(path, subject)
            with self.assertRaisesRegex(PromotionAttestationError, "subject_digest_mismatch"):
                validate_verification_result(
                    verification=verification_for(path, predicate, subject_digest_override="0" * 64),
                    subject_path=path,
                    expected_source_head_sha=SOURCE_HEAD,
                    expected_source_run_id=SOURCE_RUN,
                )

    def test_predicate_subject_binding_drift_is_rejected_even_with_rehashed_predicate(self):
        _, subject, predicate = self.make_fixture()
        forged = json.loads(json.dumps(predicate))
        forged["promotion_subject"]["candidate_sha"] = "e" * 40
        core = dict(forged)
        core.pop("predicate_sha256", None)
        forged["predicate_sha256"] = _sha256_json(core)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "subject.json"
            write_subject(path, subject)
            with self.assertRaisesRegex(PromotionAttestationError, "subject_binding_mismatch:candidate_sha"):
                validate_verification_result(
                    verification=verification_for(path, forged),
                    subject_path=path,
                    expected_source_head_sha=SOURCE_HEAD,
                    expected_source_run_id=SOURCE_RUN,
                )

    def test_missing_verified_timestamp_is_rejected(self):
        _, subject, predicate = self.make_fixture()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "subject.json"
            write_subject(path, subject)
            verification = verification_for(path, predicate)
            verification[0]["verificationResult"]["verifiedTimestamps"] = []
            with self.assertRaisesRegex(PromotionAttestationError, "verified_timestamp_missing"):
                validate_verification_result(
                    verification=verification,
                    subject_path=path,
                    expected_source_head_sha=SOURCE_HEAD,
                    expected_source_run_id=SOURCE_RUN,
                )


if __name__ == "__main__":
    unittest.main()
