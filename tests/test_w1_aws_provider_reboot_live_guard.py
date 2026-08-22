import copy
import unittest

from controller.w1.aws_provider_reboot_live_guard import (
    ENVIRONMENT,
    LiveBoundaryError,
    build_session_policy,
    validate_environment,
)

INSTANCE_ID = "i-0123456789abcdef0"
ACCOUNT_ID = "123456789012"
REGION = "us-east-2"


def valid_environment():
    return {
        "name": ENVIRONMENT,
        "protection_rules": [
            {
                "type": "required_reviewers",
                "prevent_self_review": True,
                "reviewers": [{"type": "User", "reviewer": {"id": 7}}],
            },
            {"type": "branch_policy"},
        ],
        "deployment_branch_policy": {
            "protected_branches": True,
            "custom_branch_policies": False,
        },
    }


class LiveBoundaryGuardTests(unittest.TestCase):
    def test_environment_requires_review_self_review_block_and_branch_policy(self):
        receipt = validate_environment(valid_environment())
        self.assertEqual(receipt["environment"], ENVIRONMENT)
        self.assertEqual(receipt["required_reviewer_count"], 1)
        self.assertTrue(receipt["prevent_self_review"])
        self.assertTrue(receipt["credential_release_requires_environment_approval"])
        self.assertFalse(receipt["provider_execution_authorized"])
        self.assertFalse(receipt["w1_verified"])

    def test_environment_rejects_missing_self_review_or_branch_policy(self):
        value = valid_environment()
        value["protection_rules"][0]["prevent_self_review"] = False
        with self.assertRaisesRegex(LiveBoundaryError, "environment_prevent_self_review_required"):
            validate_environment(value)

        value = valid_environment()
        value["protection_rules"] = value["protection_rules"][:1]
        with self.assertRaisesRegex(LiveBoundaryError, "environment_branch_policy_rule_missing"):
            validate_environment(value)

    def test_session_policy_is_exact_instance_and_read_only_except_reboot(self):
        receipt = build_session_policy(instance_id=INSTANCE_ID, account_id=ACCOUNT_ID, region=REGION)
        self.assertEqual(
            receipt["instance_arn"],
            f"arn:aws:ec2:{REGION}:{ACCOUNT_ID}:instance/{INSTANCE_ID}",
        )
        statements = receipt["session_policy"]["Statement"]
        describe = next(s for s in statements if s["Sid"] == "ReadW1HostSurface")
        reboot = next(s for s in statements if s["Sid"] == "RebootExactTaggedW1Host")
        trail = next(s for s in statements if s["Sid"] == "ReadProviderAuditEvent")
        self.assertEqual(describe["Resource"], "*")
        self.assertEqual(
            set(describe["Action"]),
            {"ec2:DescribeInstances", "ec2:DescribeVolumes", "ec2:DescribeSecurityGroups"},
        )
        self.assertEqual(reboot["Action"], "ec2:RebootInstances")
        self.assertEqual(reboot["Resource"], receipt["instance_arn"])
        self.assertEqual(
            reboot["Condition"]["StringEquals"]["aws:ResourceTag/metaengine:project"],
            "H205F22",
        )
        self.assertEqual(trail, {
            "Sid": "ReadProviderAuditEvent",
            "Effect": "Allow",
            "Action": "cloudtrail:LookupEvents",
            "Resource": "*",
        })
        serialized = str(receipt["session_policy"])
        for forbidden in (
            "RunInstances",
            "TerminateInstances",
            "StopInstances",
            "StartInstances",
            "AuthorizeSecurityGroupIngress",
            "ssm:",
        ):
            self.assertNotIn(forbidden, serialized)
        self.assertEqual(receipt["credential_export_mode"], "STEP_OUTPUTS_ONLY")
        self.assertFalse(receipt["persistent_worker_proof"])
        self.assertFalse(receipt["w1_verified"])

    def test_session_policy_rejects_invalid_identity_and_control_characters(self):
        with self.assertRaisesRegex(LiveBoundaryError, "instance_id_invalid"):
            build_session_policy(instance_id="i-nothex", account_id=ACCOUNT_ID, region=REGION)
        with self.assertRaisesRegex(LiveBoundaryError, "account_id_invalid"):
            build_session_policy(instance_id=INSTANCE_ID, account_id="123", region=REGION)
        with self.assertRaisesRegex(LiveBoundaryError, "region_invalid"):
            build_session_policy(instance_id=INSTANCE_ID, account_id=ACCOUNT_ID, region="earth-1")
        with self.assertRaisesRegex(LiveBoundaryError, "region_control_character"):
            build_session_policy(instance_id=INSTANCE_ID, account_id=ACCOUNT_ID, region="us-east-2\nX")

    def test_policy_generation_is_deterministic_and_non_authoritative(self):
        a = build_session_policy(instance_id=INSTANCE_ID, account_id=ACCOUNT_ID, region=REGION)
        b = build_session_policy(instance_id=INSTANCE_ID, account_id=ACCOUNT_ID, region=REGION)
        self.assertEqual(a, b)
        self.assertFalse(a["provider_execution_authorized"])
        self.assertFalse(a["canonical"])
        self.assertFalse(a["authority_effect"])
        self.assertRegex(a["receipt_sha256"], r"^[0-9a-f]{64}$")


if __name__ == "__main__":
    unittest.main()
