import copy
import unittest

from controller.rsi.promotion_attestation import GATE_SCHEMA, _sha256_json
from controller.rsi.promotion_evidence_producer import (
    QUALIFICATION_SCHEMA,
    REQUIRED_WORKFLOWS,
    build_subject_from_persisted_evidence,
    validate_persisted_github_runs,
    validate_qualification,
)
from controller.rsi.promotion_attestation import PromotionAttestationError


CANDIDATE = "b" * 40
PARENT = "a" * 40
CANDIDATE_ID = "candidate_sha256_" + "c" * 64
ARTIFACT = "6" * 64
PROVENANCE = "7" * 64


def qualification():
    core = {
        "schema": QUALIFICATION_SCHEMA,
        "version": 1,
        "candidate_id": CANDIDATE_ID,
        "candidate_sha": CANDIDATE,
        "parent_sha": PARENT,
        "artifact": {
            "digest": "sha256:" + ARTIFACT,
            "signed": True,
            "signature_verified": True,
        },
        "provenance": {
            "digest": "sha256:" + PROVENANCE,
            "predicate_type": "https://slsa.dev/provenance/v1",
            "builder_id": "github-actions:metaengine-browser-release-v1",
            "source_repository": "PatrickFrome/Compute",
            "source_sha": CANDIDATE,
            "verified": True,
        },
        "ci_checks": [
            {
                "workflow": name,
                "run_id": 1000 + index,
                "head_sha": CANDIDATE,
                "conclusion": "SUCCESS",
                "evidence_ref": f"github:actions/run/{1000 + index}",
            }
            for index, name in enumerate(REQUIRED_WORKFLOWS)
        ],
        "canary": {
            "mode": "SHADOW_CANARY",
            "candidate_sha": CANDIDATE,
            "artifact_digest": "sha256:" + ARTIFACT,
            "result": "PASS",
            "duplicate_irreversible_effects": 0,
            "ambiguous_effect_retries": 0,
            "authority_violations": 0,
            "workspace_escapes": 0,
            "evidence_refs": ["github:artifact:shadow-canary"],
        },
        "rollback": {
            "predecessor_sha": PARENT,
            "artifact_digest": "sha256:" + "8" * 64,
            "ready": True,
            "ambiguous_effect_replay_allowed": False,
            "evidence_refs": ["github:artifact:rollback-proof"],
        },
        "evidence_refs": ["github:release-qualification:exact-head"],
        "external_verifier": True,
        "authored_by_candidate": False,
        "direct_install_authorized": False,
        "self_update_invocation_authorized": False,
        "execution_authority": False,
        "production_mutation_authority": False,
        "promotion_authority": False,
        "self_update_authority": False,
        "automatic_retry_allowed": False,
        "authority_effect": False,
    }
    return {**core, "qualification_digest": "sha256:" + _sha256_json(core)}


def gate(q):
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
        "qualification_digest": q["qualification_digest"],
        "artifact_digest": "sha256:" + ARTIFACT,
        "provenance_digest": "sha256:" + PROVENANCE,
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
    return {**core, "gate_digest": "sha256:" + _sha256_json(core)}


def github_runs(q):
    by_name = {row["workflow"]: row for row in q["ci_checks"]}
    return [
        {
            "id": by_name[name]["run_id"],
            "name": name,
            "run_attempt": 1,
            "head_sha": CANDIDATE,
            "event": "pull_request",
            "status": "completed",
            "conclusion": "success",
            "repository": {"id": 1341371143, "full_name": "PatrickFrome/Compute"},
        }
        for name in REQUIRED_WORKFLOWS
    ]


class PromotionEvidenceProducerTest(unittest.TestCase):
    def test_subject_binds_independently_read_ci_run_set(self):
        q = qualification()
        g = gate(q)
        runs = github_runs(q)
        subject = build_subject_from_persisted_evidence(
            gate=g,
            qualification=q,
            github_runs=runs,
            canary_evidence_digest="9" * 64,
            rollback_evidence_digest="a" * 64,
        )
        self.assertRegex(subject["ci_run_set_sha256"], r"^[0-9a-f]{64}$")
        self.assertEqual(subject["ci_run_ids"], [1000 + i for i in range(len(REQUIRED_WORKFLOWS))])
        self.assertEqual(subject["evidence_producer"], "TRUSTED_PERSISTED_GITHUB_RUN_READBACK_REQUIRED")
        self.assertFalse(subject["caller_supplied_ci_status_trusted"])
        self.assertFalse(subject["promotion_authority"])
        self.assertFalse(subject["self_update_authority"])

    def test_forged_qualification_cannot_change_run_id_without_gate_rebinding(self):
        q = qualification()
        g = gate(q)
        forged = copy.deepcopy(q)
        forged["ci_checks"][0]["run_id"] += 5000
        forged.pop("qualification_digest")
        forged["qualification_digest"] = "sha256:" + _sha256_json(forged)
        with self.assertRaisesRegex(PromotionAttestationError, "qualification_gate_digest_binding_mismatch"):
            validate_qualification(forged, g)

    def test_even_rebound_gate_cannot_turn_invented_run_id_into_persisted_evidence(self):
        q = qualification()
        forged = copy.deepcopy(q)
        forged["ci_checks"][0]["run_id"] += 5000
        forged.pop("qualification_digest")
        forged["qualification_digest"] = "sha256:" + _sha256_json(forged)
        g = gate(forged)
        projection = validate_qualification(forged, g)
        real_runs = github_runs(q)
        with self.assertRaisesRegex(PromotionAttestationError, "run_id_claim_mismatch"):
            validate_persisted_github_runs(real_runs, projection)

    def test_raw_github_repository_head_event_or_conclusion_drift_is_rejected(self):
        q = qualification()
        projection = validate_qualification(q, gate(q))
        mutations = [
            lambda row: row["repository"].update({"id": 999}),
            lambda row: row.update({"head_sha": "d" * 40}),
            lambda row: row.update({"event": "push"}),
            lambda row: row.update({"conclusion": "failure"}),
        ]
        for mutate in mutations:
            runs = github_runs(q)
            mutate(runs[0])
            with self.subTest(run=runs[0]):
                with self.assertRaises(PromotionAttestationError):
                    validate_persisted_github_runs(runs, projection)

    def test_missing_or_duplicate_workflow_evidence_is_rejected(self):
        q = qualification()
        projection = validate_qualification(q, gate(q))
        runs = github_runs(q)
        with self.assertRaisesRegex(PromotionAttestationError, "persisted_ci_runs_invalid"):
            validate_persisted_github_runs(runs[:-1], projection)
        duplicate = github_runs(q)
        duplicate[1]["name"] = duplicate[0]["name"]
        duplicate[1]["id"] = duplicate[0]["id"]
        with self.assertRaisesRegex(PromotionAttestationError, "persisted_ci_name_invalid"):
            validate_persisted_github_runs(duplicate, projection)


if __name__ == "__main__":
    unittest.main()
