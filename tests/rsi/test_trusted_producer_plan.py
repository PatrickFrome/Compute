import copy
import unittest

from controller.rsi.promotion_attestation import PromotionAttestationError, _sha256_json
from controller.rsi.trusted_producer_plan import (
    ACTIVATION_SCHEMA,
    EVIDENCE_MANIFEST_SCHEMA,
    FORBIDDEN_CAPABILITIES,
    PINNED_ATTEST_ACTION,
    REQUIRED_EVIDENCE,
    TRUSTED_ENVIRONMENT,
    TRUSTED_REF,
    create_trusted_producer_plan,
    evaluate_trusted_producer_activation,
    validate_evidence_manifest,
    validate_trusted_producer_plan,
)


CANDIDATE = "b" * 40
CONTROL = "a" * 40
RUN_ID = 987654321


def plan():
    return create_trusted_producer_plan(
        candidate_sha=CANDIDATE,
        trusted_control_sha=CONTROL,
        evidence_run_id=RUN_ID,
    )


def manifest(**overrides):
    value = {
        "schema": EVIDENCE_MANIFEST_SCHEMA,
        "version": 1,
        "candidate_sha": CANDIDATE,
        "source_run_id": RUN_ID,
        "persisted_readback": True,
        "authored_by_candidate": False,
        "caller_supplied_truth_trusted": False,
        "files": [
            {
                "name": name,
                "sha256": f"{index + 1:064x}",
                "bytes": 100 + index,
            }
            for index, name in enumerate(REQUIRED_EVIDENCE)
        ],
    }
    value.update(overrides)
    return value


class TrustedProducerPlanTest(unittest.TestCase):
    def test_plan_is_exact_pinned_privilege_separated_and_zero_authority(self):
        value = validate_trusted_producer_plan(plan())
        policy = value["workflow_policy"]
        self.assertEqual(value["candidate_sha"], CANDIDATE)
        self.assertEqual(value["trusted_control"]["ref"], TRUSTED_REF)
        self.assertEqual(value["trusted_control"]["environment"], TRUSTED_ENVIRONMENT)
        self.assertEqual(value["required_action_pins"]["attest"], PINNED_ATTEST_ACTION)
        self.assertEqual(value["required_evidence_files"], list(REQUIRED_EVIDENCE))
        self.assertEqual(value["forbidden_capabilities"], list(FORBIDDEN_CAPABILITIES))
        self.assertTrue(policy["workflow_dispatch_only"])
        self.assertTrue(policy["exact_trusted_control_sha_checkout_required"])
        self.assertFalse(policy["pull_request_signing_allowed"])
        self.assertFalse(policy["push_signing_allowed"])
        self.assertFalse(policy["pull_request_target_allowed"])
        self.assertFalse(policy["workflow_run_allowed"])
        self.assertFalse(policy["candidate_checkout_allowed"])
        self.assertFalse(value["signing_activation_authorized"])
        self.assertFalse(value["production_mutation_authority"])
        self.assertFalse(value["promotion_authority"])
        self.assertFalse(value["self_update_authority"])
        self.assertFalse(value["automatic_retry_allowed"])
        self.assertRegex(value["plan_sha256"], r"^[0-9a-f]{64}$")

    def test_rehashed_policy_tampering_still_fails_semantic_validation(self):
        for field in ("pull_request_signing_allowed", "pull_request_target_allowed", "workflow_run_allowed", "candidate_checkout_allowed"):
            value = plan()
            tampered = copy.deepcopy(value)
            tampered["workflow_policy"][field] = True
            tampered.pop("plan_sha256")
            tampered["plan_sha256"] = _sha256_json(tampered)
            with self.subTest(field=field):
                with self.assertRaisesRegex(PromotionAttestationError, f"{field}_invalid"):
                    validate_trusted_producer_plan(tampered)

    def test_rehashed_authority_escalation_still_fails_semantic_validation(self):
        for field in ("signing_activation_authorized", "production_mutation_authority", "promotion_authority", "self_update_authority", "execution_authority", "automatic_retry_allowed", "authority_effect"):
            value = plan()
            tampered = copy.deepcopy(value)
            tampered[field] = True
            tampered.pop("plan_sha256")
            tampered["plan_sha256"] = _sha256_json(tampered)
            with self.subTest(field=field):
                with self.assertRaisesRegex(PromotionAttestationError, f"trusted_producer_{field}_invalid"):
                    validate_trusted_producer_plan(tampered)

    def test_evidence_manifest_requires_actual_bounded_file_set(self):
        normalized = validate_evidence_manifest(manifest(), plan())
        self.assertEqual(normalized["candidate_sha"], CANDIDATE)
        self.assertEqual(normalized["source_run_id"], RUN_ID)
        self.assertEqual([row["name"] for row in normalized["files"]], list(REQUIRED_EVIDENCE))
        self.assertRegex(normalized["evidence_set_sha256"], r"^[0-9a-f]{64}$")

        missing = manifest()
        missing["files"] = missing["files"][:-1]
        with self.assertRaisesRegex(PromotionAttestationError, "files_invalid"):
            validate_evidence_manifest(missing, plan())

        candidate_authored = manifest(authored_by_candidate=True)
        with self.assertRaisesRegex(PromotionAttestationError, "origin_invalid"):
            validate_evidence_manifest(candidate_authored, plan())

    def test_ready_state_is_only_workflow_activation_readiness_not_signing_authority(self):
        result = evaluate_trusted_producer_activation(
            plan=plan(),
            evidence_manifest=manifest(),
            workflow_merged_to_trusted_ref=True,
            protected_environment_configured=True,
        )
        self.assertEqual(result["schema"], ACTIVATION_SCHEMA)
        self.assertEqual(result["state"], "READY_FOR_TRUSTED_WORKFLOW_ACTIVATION")
        self.assertTrue(result["ready_for_workflow_activation"])
        self.assertFalse(result["signing_activation_authorized"])
        self.assertFalse(result["production_mutation_authority"])
        self.assertFalse(result["promotion_authority"])
        self.assertFalse(result["self_update_authority"])
        self.assertFalse(result["execution_authority"])
        self.assertFalse(result["automatic_retry_allowed"])
        self.assertRegex(result["activation_sha256"], r"^[0-9a-f]{64}$")

    def test_missing_trusted_branch_or_environment_blocks_activation(self):
        for merged, environment, expected in [
            (False, True, "TRUSTED_WORKFLOW_NOT_MERGED"),
            (True, False, "PROTECTED_ENVIRONMENT_NOT_CONFIGURED"),
            (False, False, "TRUSTED_WORKFLOW_NOT_MERGED"),
        ]:
            with self.subTest(merged=merged, environment=environment):
                result = evaluate_trusted_producer_activation(
                    plan=plan(),
                    evidence_manifest=manifest(),
                    workflow_merged_to_trusted_ref=merged,
                    protected_environment_configured=environment,
                )
                self.assertEqual(result["state"], "BLOCKED")
                self.assertFalse(result["ready_for_workflow_activation"])
                self.assertIn(expected, result["blockers"])
                self.assertFalse(result["signing_activation_authorized"])

    def test_candidate_and_trusted_control_must_be_distinct_exact_shas(self):
        with self.assertRaisesRegex(PromotionAttestationError, "candidate_cannot_be_trusted_control_sha"):
            create_trusted_producer_plan(candidate_sha=CANDIDATE, trusted_control_sha=CANDIDATE, evidence_run_id=RUN_ID)
        with self.assertRaises(PromotionAttestationError):
            create_trusted_producer_plan(candidate_sha="release-branch", trusted_control_sha=CONTROL, evidence_run_id=RUN_ID)


if __name__ == "__main__":
    unittest.main()
