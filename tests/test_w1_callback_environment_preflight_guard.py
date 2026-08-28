from __future__ import annotations

import copy
import json
from pathlib import Path
import unittest

from controller.w1 import w1_callback_environment_preflight_guard as guard

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/w1-callback-environment-preflight.yml"


def environment() -> dict:
    return {
        "id": 123456,
        "name": guard.ENVIRONMENT,
        "can_admins_bypass": False,
        "protection_rules": [
            {
                "id": 1,
                "type": "required_reviewers",
                "prevent_self_review": True,
                "reviewers": [
                    {"type": "User", "reviewer": {"id": 999, "login": "reviewer"}},
                ],
            },
            {"id": 2, "type": "branch_policy"},
        ],
        "deployment_branch_policy": {
            "protected_branches": False,
            "custom_branch_policies": True,
        },
    }


def branch() -> dict:
    return {"name": "main", "protected": True, "commit": {"sha": "1" * 40}}


def branch_policies() -> dict:
    return {"total_count": 1, "branch_policies": [{"id": 77, "name": "main", "type": "branch"}]}


def custom_rules() -> dict:
    return {"total_count": 0, "custom_deployment_protection_rules": []}


def valid_receipt() -> dict:
    return guard.validate_environment(
        environment=environment(), branch=branch(), branch_policies=branch_policies(), custom_rules=custom_rules()
    )


class CallbackEnvironmentPreflightTests(unittest.TestCase):
    def test_valid_environment_is_non_authority(self):
        result = valid_receipt()
        self.assertEqual(guard.SCHEMA, result["schema"])
        self.assertEqual("EXACT_CUSTOM_MAIN_ONLY", result["deployment_branch_policy_mode"])
        self.assertFalse(result["can_admins_bypass"])
        self.assertTrue(result["prevent_self_review"])
        self.assertEqual(1, result["required_reviewer_count"])
        self.assertFalse(result["provider_credentials_used"])
        self.assertFalse(result["oidc_token_validated"])
        for field in ("aws_execution_authorized", "supabase_mutation_authorized", "worker_admitted", "w1_verified", "canonical", "authority_effect"):
            self.assertIs(result[field], False, field)
        self.assertEqual(result, guard.validate_receipt(result))

    def test_admin_bypass_must_be_disabled(self):
        value = environment(); value["can_admins_bypass"] = True
        with self.assertRaisesRegex(guard.CallbackEnvironmentPreflightError, "admin_bypass"):
            guard.validate_environment(environment=value, branch=branch(), branch_policies=branch_policies(), custom_rules=custom_rules())

    def test_required_reviewers_and_self_review_are_hard_requirements(self):
        value = environment(); value["protection_rules"][0]["reviewers"] = []
        with self.assertRaisesRegex(guard.CallbackEnvironmentPreflightError, "required_reviewers_count"):
            guard.validate_environment(environment=value, branch=branch(), branch_policies=branch_policies(), custom_rules=custom_rules())
        value = environment(); value["protection_rules"][0]["prevent_self_review"] = False
        with self.assertRaisesRegex(guard.CallbackEnvironmentPreflightError, "prevent_self_review"):
            guard.validate_environment(environment=value, branch=branch(), branch_policies=branch_policies(), custom_rules=custom_rules())

    def test_reviewer_identity_is_typed_and_unique(self):
        value = environment()
        value["protection_rules"][0]["reviewers"] = [
            {"type": "User", "reviewer": {"id": 999, "login": "a"}},
            {"type": "User", "reviewer": {"id": 999, "login": "a"}},
        ]
        with self.assertRaisesRegex(guard.CallbackEnvironmentPreflightError, "duplicate_required_reviewer"):
            guard.validate_environment(environment=value, branch=branch(), branch_policies=branch_policies(), custom_rules=custom_rules())
        value = environment(); value["protection_rules"][0]["reviewers"] = [{"type": "Bot", "reviewer": {"id": 1}}]
        with self.assertRaisesRegex(guard.CallbackEnvironmentPreflightError, "reviewer_type_invalid"):
            guard.validate_environment(environment=value, branch=branch(), branch_policies=branch_policies(), custom_rules=custom_rules())

    def test_only_exact_custom_main_policy_is_accepted(self):
        value = environment(); value["deployment_branch_policy"] = {"protected_branches": True, "custom_branch_policies": False}
        with self.assertRaisesRegex(guard.CallbackEnvironmentPreflightError, "exact_custom_branch_policy"):
            guard.validate_environment(environment=value, branch=branch(), branch_policies=branch_policies(), custom_rules=custom_rules())
        policies = branch_policies(); policies["branch_policies"].append({"id": 78, "name": "release/*", "type": "branch"}); policies["total_count"] = 2
        with self.assertRaisesRegex(guard.CallbackEnvironmentPreflightError, "exact_main_only"):
            guard.validate_environment(environment=environment(), branch=branch(), branch_policies=policies, custom_rules=custom_rules())
        policies = {"total_count": 1, "branch_policies": [{"id": 77, "name": "main", "type": "tag"}]}
        with self.assertRaisesRegex(guard.CallbackEnvironmentPreflightError, "must_be_branch"):
            guard.validate_environment(environment=environment(), branch=branch(), branch_policies=policies, custom_rules=custom_rules())

    def test_main_itself_must_be_protected(self):
        value = branch(); value["protected"] = False
        with self.assertRaisesRegex(guard.CallbackEnvironmentPreflightError, "protected_main_branch_required"):
            guard.validate_environment(environment=environment(), branch=value, branch_policies=branch_policies(), custom_rules=custom_rules())

    def test_custom_protection_apps_are_rejected_for_determinism(self):
        rules = {"total_count": 1, "custom_deployment_protection_rules": [{"id": 3, "enabled": True, "app": {"id": 9}}]}
        with self.assertRaisesRegex(guard.CallbackEnvironmentPreflightError, "custom_protection_rules_not_supported"):
            guard.validate_environment(environment=environment(), branch=branch(), branch_policies=branch_policies(), custom_rules=rules)

    def test_unknown_environment_rule_fails_closed(self):
        value = environment(); value["protection_rules"].append({"id": 3, "type": "mystery"})
        with self.assertRaisesRegex(guard.CallbackEnvironmentPreflightError, "unsupported_environment_protection_rule"):
            guard.validate_environment(environment=value, branch=branch(), branch_policies=branch_policies(), custom_rules=custom_rules())

    def test_wait_timer_is_optional_and_bounded(self):
        value = environment(); value["protection_rules"].append({"id": 3, "type": "wait_timer", "wait_timer": 15})
        result = guard.validate_environment(environment=value, branch=branch(), branch_policies=branch_policies(), custom_rules=custom_rules())
        self.assertEqual(15, result["wait_timer_minutes"])
        value["protection_rules"][-1]["wait_timer"] = 999999
        with self.assertRaisesRegex(guard.CallbackEnvironmentPreflightError, "wait_timer_invalid"):
            guard.validate_environment(environment=value, branch=branch(), branch_policies=branch_policies(), custom_rules=custom_rules())

    def test_receipt_hash_and_authority_tamper_fail_closed(self):
        receipt = valid_receipt(); receipt["w1_verified"] = True
        with self.assertRaisesRegex(guard.CallbackEnvironmentPreflightError, "receipt_sha256_mismatch"):
            guard.validate_receipt(receipt)

    def test_gate_requires_identical_pre_and_post_environment_receipts(self):
        before = valid_receipt()
        env2 = environment(); env2["protection_rules"][0]["reviewers"] = [{"type": "User", "reviewer": {"id": 998, "login": "other"}}]
        after = guard.validate_environment(environment=env2, branch=branch(), branch_policies=branch_policies(), custom_rules=custom_rules())
        with self.assertRaisesRegex(guard.CallbackEnvironmentPreflightError, "environment_drift_across_gate"):
            guard.seal_gate(before=before, after=after, run_id="123", run_attempt="1", repository=guard.REPOSITORY,
                            repository_id=guard.REPOSITORY_ID, owner_id=guard.REPOSITORY_OWNER_ID, ref="refs/heads/main")

    def test_gate_success_remains_non_authority_and_no_oidc(self):
        receipt = valid_receipt()
        result = guard.seal_gate(before=receipt, after=copy.deepcopy(receipt), run_id="123", run_attempt="1",
                                 repository=guard.REPOSITORY, repository_id=guard.REPOSITORY_ID,
                                 owner_id=guard.REPOSITORY_OWNER_ID, ref="refs/heads/main")
        self.assertEqual(guard.GATE_SCHEMA, result["schema"])
        self.assertTrue(result["environment_gate_job_started_after_protection_rules"])
        self.assertTrue(result["environment_metadata_stable_across_gate"])
        self.assertFalse(result["provider_credentials_used"])
        self.assertFalse(result["oidc_token_requested"])
        self.assertFalse(result["authority_effect"])

    def test_workflow_has_no_provider_credentials_or_mutation_surface(self):
        source = WORKFLOW.read_text()
        self.assertIn("READBACK_W1_CALLBACK_ENVIRONMENT_ONLY", source)
        self.assertIn("environment: w1-callback-readback", source)
        self.assertIn("/environments/w1-callback-readback", source)
        self.assertIn("/deployment-branch-policies?per_page=100", source)
        self.assertIn("/deployment_protection_rules", source)
        self.assertIn("/branches/main", source)
        self.assertNotIn("id-token: write", source)
        self.assertNotIn("secrets.", source)
        self.assertNotIn("AWS_", source)
        self.assertNotIn("SUPABASE_", source)
        self.assertNotIn("configure-aws-credentials", source)
        self.assertNotIn("ssm:SendCommand", source)
        self.assertNotIn("supabase functions deploy", source)
        self.assertNotIn("curl -X POST", source)
        self.assertNotIn("curl -X PUT", source)
        self.assertNotIn("curl -X PATCH", source)
        self.assertNotIn("curl -X DELETE", source)

    def test_environment_api_reads_are_public_get_only(self):
        source = WORKFLOW.read_text()
        self.assertNotIn("Authorization: Bearer", source)
        self.assertNotIn("GH_TOKEN", source)
        self.assertGreaterEqual(source.count("curl --fail-with-body --silent --show-error --location"), 8)


if __name__ == "__main__":
    unittest.main()
