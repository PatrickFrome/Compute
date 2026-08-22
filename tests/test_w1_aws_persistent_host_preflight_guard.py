import copy
import hashlib
import json
import unittest

from controller.w1.aws_persistent_host_preflight_guard import (
    BINDING_CLASSIFICATION,
    BINDING_SCHEMA,
    BOUNDARY_SCHEMA,
    ENVIRONMENT,
    ENV_RECEIPT_CLASSIFICATION,
    ENV_RECEIPT_SCHEMA,
    ProtectedHostPreflightError,
    build_session_boundary,
    finalize_preflight_binding,
    validate_boundary,
)

INSTANCE_ID = "i-0123456789abcdef0"
WORKER_ID = "w1-linux-persistent-001"
W1_SHA = "a" * 40
ACCOUNT_ID = "123456789012"
REGION = "us-east-2"


def canonical_sha(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def rehash(value, field="receipt_sha256"):
    core = dict(value)
    core.pop(field, None)
    value[field] = canonical_sha(core)
    return value


def environment_receipt():
    core = {
        "schema": ENV_RECEIPT_SCHEMA,
        "classification": ENV_RECEIPT_CLASSIFICATION,
        "environment": ENVIRONMENT,
        "required_reviewer_count": 1,
        "prevent_self_review": True,
        "branch_policy": {"protected_branches": True, "custom_branch_policies": False},
        "credential_release_requires_environment_approval": True,
        "provider_execution_authorized": False,
        "persistent_worker_proof": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }
    result = dict(core)
    result["receipt_sha256"] = canonical_sha(core)
    return result


def preflight_summary(worker_id=WORKER_ID, sha=W1_SHA, instance_id=INSTANCE_ID):
    return {
        "schema": "metaengine.compute.w1-aws-preflight.h205f22.v1",
        "instance_id": instance_id,
        "worker_id": worker_id,
        "worker_bundle_github_sha": sha,
        "state": "running",
        "availability_zone": "us-east-2a",
        "instance_type": "t3.small",
        "image_id": "ami-0123456789abcdef0",
        "private_ip": "10.0.0.10",
        "public_ip_present": False,
        "security_group_ids": ["sg-0123456789abcdef0"],
        "root_volume_id": "vol-0123456789abcdef0",
        "root_volume_encrypted": True,
        "root_volume_type": "gp3",
        "imdsv2_required": True,
        "imds_hop_limit": 1,
        "authority_effect": False,
        "canonical": False,
    }


class ProtectedHostPreflightGuardTests(unittest.TestCase):
    def setUp(self):
        self.boundary = build_session_boundary(
            instance_id=INSTANCE_ID,
            worker_id=WORKER_ID,
            w1_sha=W1_SHA,
            account_id=ACCOUNT_ID,
            region=REGION,
        )

    def test_session_boundary_binds_exact_host_worker_sha_and_tags(self):
        self.assertEqual(self.boundary["schema"], BOUNDARY_SCHEMA)
        self.assertEqual(self.boundary["instance_id"], INSTANCE_ID)
        self.assertEqual(self.boundary["worker_id"], WORKER_ID)
        self.assertEqual(self.boundary["w1_sha"], W1_SHA)
        self.assertFalse(self.boundary["persistent_worker_proof"])
        self.assertFalse(self.boundary["w1_verified"])

        statements = self.boundary["session_policy"]["Statement"]
        describe = next(s for s in statements if s["Sid"] == "ReadProtectedW1HostSurface")
        dry_run = next(s for s in statements if s["Sid"] == "DryRunExactProtectedW1Host")
        self.assertEqual(
            set(describe["Action"]),
            {"ec2:DescribeInstances", "ec2:DescribeVolumes", "ec2:DescribeSecurityGroups"},
        )
        self.assertEqual(dry_run["Action"], "ec2:RebootInstances")
        self.assertEqual(
            dry_run["Resource"],
            f"arn:aws:ec2:{REGION}:{ACCOUNT_ID}:instance/{INSTANCE_ID}",
        )
        conditions = dry_run["Condition"]["StringEquals"]
        self.assertEqual(conditions["aws:ResourceTag/metaengine:worker_id"], WORKER_ID)
        self.assertEqual(conditions["aws:ResourceTag/metaengine:github_sha"], W1_SHA)
        self.assertEqual(conditions["aws:ResourceTag/metaengine:project"], "H205F22")
        self.assertEqual(
            conditions["aws:ResourceTag/metaengine:milestone"],
            "W1_PERSISTENT_LINUX_WORKER_SAFETY",
        )
        self.assertEqual(conditions["aws:ResourceTag/metaengine:authority"], "noncanonical-worker")
        self.assertEqual(conditions["aws:ResourceTag/metaengine:execution_tier"], "persistent-host")

    def test_invalid_or_control_character_identity_fails_closed(self):
        with self.assertRaisesRegex(ProtectedHostPreflightError, "instance_id_invalid"):
            build_session_boundary(instance_id="i-nothex", worker_id=WORKER_ID, w1_sha=W1_SHA, account_id=ACCOUNT_ID, region=REGION)
        with self.assertRaisesRegex(ProtectedHostPreflightError, "worker_id_control_character"):
            build_session_boundary(instance_id=INSTANCE_ID, worker_id=WORKER_ID + "\nX", w1_sha=W1_SHA, account_id=ACCOUNT_ID, region=REGION)
        with self.assertRaisesRegex(ProtectedHostPreflightError, "w1_sha_invalid"):
            build_session_boundary(instance_id=INSTANCE_ID, worker_id=WORKER_ID, w1_sha="b" * 39, account_id=ACCOUNT_ID, region=REGION)

    def test_rehashed_policy_forgery_is_rejected_by_exact_contract(self):
        forged = copy.deepcopy(self.boundary)
        dry_run = next(s for s in forged["session_policy"]["Statement"] if s["Sid"] == "DryRunExactProtectedW1Host")
        dry_run["Condition"]["StringEquals"].pop("aws:ResourceTag/metaengine:github_sha")
        rehash(forged)
        with self.assertRaisesRegex(ProtectedHostPreflightError, "session_boundary_not_exact_contract"):
            validate_boundary(forged)

    def test_environment_receipt_tamper_fails_even_when_binding_inputs_match(self):
        env = environment_receipt()
        env["prevent_self_review"] = False
        rehash(env)
        with self.assertRaisesRegex(ProtectedHostPreflightError, "self_review_boundary_invalid"):
            finalize_preflight_binding(
                environment_receipt=env,
                session_boundary=self.boundary,
                preflight_summary=preflight_summary(),
                dry_run_result="DryRunOperation",
            )

    def test_preflight_must_match_protected_worker_and_w1_sha(self):
        with self.assertRaisesRegex(ProtectedHostPreflightError, "preflight_worker_identity_mismatch"):
            finalize_preflight_binding(
                environment_receipt=environment_receipt(),
                session_boundary=self.boundary,
                preflight_summary=preflight_summary(worker_id="other-worker"),
                dry_run_result="DryRunOperation",
            )
        with self.assertRaisesRegex(ProtectedHostPreflightError, "preflight_w1_sha_mismatch"):
            finalize_preflight_binding(
                environment_receipt=environment_receipt(),
                session_boundary=self.boundary,
                preflight_summary=preflight_summary(sha="b" * 40),
                dry_run_result="DryRunOperation",
            )

    def test_only_dry_run_operation_can_finalize_and_never_grants_w1_authority(self):
        with self.assertRaisesRegex(ProtectedHostPreflightError, "dry_run_not_proven"):
            finalize_preflight_binding(
                environment_receipt=environment_receipt(),
                session_boundary=self.boundary,
                preflight_summary=preflight_summary(),
                dry_run_result="UnauthorizedOperation",
            )

        result = finalize_preflight_binding(
            environment_receipt=environment_receipt(),
            session_boundary=self.boundary,
            preflight_summary=preflight_summary(),
            dry_run_result="DryRunOperation",
        )
        self.assertEqual(result["schema"], BINDING_SCHEMA)
        self.assertEqual(result["classification"], BINDING_CLASSIFICATION)
        self.assertEqual(result["reboot_permission_dry_run"], "DryRunOperation")
        self.assertFalse(result["real_reboot_requested"])
        self.assertFalse(result["real_reboot_performed"])
        self.assertFalse(result["backend_binding_created"])
        self.assertFalse(result["persistent_worker_proof"])
        self.assertFalse(result["w1_verified"])
        self.assertFalse(result["canonical_c1_promoted"])
        self.assertFalse(result["authority_effect"])
        self.assertEqual(result["required_next"], "SUPERVISOR_REVIEW_PREFLIGHT_EVIDENCE_BEFORE_ANY_REAL_REBOOT")
        self.assertRegex(result["receipt_sha256"], r"^[0-9a-f]{64}$")


if __name__ == "__main__":
    unittest.main()
