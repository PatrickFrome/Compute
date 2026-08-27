from __future__ import annotations

import json
from pathlib import Path
import unittest
from unittest.mock import patch

from controller.w1 import aws_ssm_safety_readiness_guard as g


ACCOUNT = "123456789012"
REGION = "us-east-2"
INSTANCE = "i-0123456789abcdef0"
WORKER = "w1-worker-01"
PROVISION_ROLE = f"arn:aws:iam::{ACCOUNT}:role/w1-provision"
IID_ROLE = f"arn:aws:iam::{ACCOUNT}:role/w1-iid"
VERIFY_ROLE = f"arn:aws:iam::{ACCOUNT}:role/w1-verify"


class ReadinessBoundaryTests(unittest.TestCase):
    def test_readonly_boundary_has_both_exact_documents_and_zero_mutation_surface(self):
        value = g.build_readonly_session_boundary(account_id=ACCOUNT, region=REGION)
        policy = json.dumps(value["session_policy"], sort_keys=True)
        self.assertIn("ec2:DescribeInstances", policy)
        self.assertIn("ssm:DescribeInstanceInformation", policy)
        self.assertIn("Metaengine-W1-Safety-Provision-H205F22", policy)
        self.assertIn("Metaengine-W1-IID-Capture-H205F22", policy)
        for forbidden in (
            "ssm:SendCommand", "ssm:StartSession", "ssm:CreateDocument", "ssm:UpdateDocument",
            "ssm:DeleteDocument", "ec2:RebootInstances", "ec2:RunInstances", "ec2:TerminateInstances",
            "cloudtrail:LookupEvents", "s3:", "secretsmanager:", "kms:Decrypt",
        ):
            self.assertNotIn(forbidden, policy, forbidden)
        self.assertFalse(value["provider_execution_authorized"])
        self.assertFalse(value["authority_effect"])

    def test_three_roles_must_be_distinct_and_same_account(self):
        roles = g.validate_role_configuration(
            account_id=ACCOUNT,
            provision_role_arn=PROVISION_ROLE,
            iid_role_arn=IID_ROLE,
            verifier_role_arn=VERIFY_ROLE,
        )
        self.assertEqual(3, len(set(roles.values())))
        with self.assertRaisesRegex(g.ReadinessError, "distinct_role_arns_required"):
            g.validate_role_configuration(
                account_id=ACCOUNT,
                provision_role_arn=PROVISION_ROLE,
                iid_role_arn=PROVISION_ROLE,
                verifier_role_arn=VERIFY_ROLE,
            )
        with self.assertRaisesRegex(g.ReadinessError, "iid_role_arn_invalid"):
            g.validate_role_configuration(
                account_id=ACCOUNT,
                provision_role_arn=PROVISION_ROLE,
                iid_role_arn="arn:aws:iam::999999999999:role/w1-iid",
                verifier_role_arn=VERIFY_ROLE,
            )

    def test_readonly_caller_must_be_exact_configured_verifier_role(self):
        caller = {
            "Account": ACCOUNT,
            "Arn": f"arn:aws:sts::{ACCOUNT}:assumed-role/w1-verify/w1-readiness-123",
            "UserId": "AROAEXAMPLE:w1-readiness-123",
        }
        result = g.validate_readonly_caller(caller, account_id=ACCOUNT, verifier_role_arn=VERIFY_ROLE)
        self.assertEqual("w1-verify", result["role_name"])
        wrong = dict(caller)
        wrong["Arn"] = f"arn:aws:sts::{ACCOUNT}:assumed-role/w1-provision/w1-readiness-123"
        with self.assertRaisesRegex(g.ReadinessError, "readonly_caller_role_mismatch"):
            g.validate_readonly_caller(wrong, account_id=ACCOUNT, verifier_role_arn=VERIFY_ROLE)


class ReadinessCompositionTests(unittest.TestCase):
    def test_success_composes_only_readiness_and_preserves_all_execution_nonclaims(self):
        environment = {"receipt_sha256": "e" * 64}
        deployment = {"receipt_sha256": "d" * 64}
        preflight = {"schema": "preflight", "instance_id": INSTANCE}
        managed = {"instance_id": INSTANCE, "ping_status": "Online"}
        provision = {
            "aws_document_sha256": "a" * 64,
            "repository_generated_document_sha256": "b" * 64,
            "package_sha256": "c" * 64,
        }
        iid = {"aws_document_sha256": "f" * 64, "repository_document_source_sha256": "1" * 64}
        caller = {
            "Account": ACCOUNT,
            "Arn": f"arn:aws:sts::{ACCOUNT}:assumed-role/w1-verify/w1-readiness-123",
            "UserId": "AROAEXAMPLE:w1-readiness-123",
        }
        with patch.object(g.deployment_guard, "validate_environment_receipt", return_value=environment), \
             patch.object(g.deployment_guard, "validate_deployment_receipt", return_value=deployment), \
             patch.object(g.provider_guard, "validate_preflight_bundle", return_value=preflight), \
             patch.object(g.provision_guard, "validate_managed_node", return_value=managed), \
             patch.object(g.provision_guard, "validate_remote_document", return_value=provision), \
             patch.object(g.iid_guard, "validate_remote_document", return_value=iid):
            result = g.compose_readiness(
                environment_receipt={}, deployment_receipt={}, caller_identity=caller,
                preflight_bundle={}, managed_node_response={},
                provision_document_description={}, provision_get_document={},
                iid_document_description={}, iid_get_document={}, iid_document_source=b"{}",
                instance_id=INSTANCE, worker_id=WORKER, account_id=ACCOUNT, region=REGION,
                provision_role_arn=PROVISION_ROLE, iid_role_arn=IID_ROLE, verifier_role_arn=VERIFY_ROLE,
            )
        self.assertTrue(result["readiness_preflight_passed"])
        for key in (
            "send_command_executed", "document_mutation", "host_filesystem_mutation", "reboot_performed",
            "database_mutation", "worker_admitted", "persistent_worker_proof", "w1_verified", "canonical", "authority_effect",
        ):
            self.assertFalse(result[key], key)
        self.assertEqual("EXPLICITLY_APPROVED_MAIN_BRANCH_W1_SSM_PROVISIONING_DISPATCH", result["required_next"])

    def test_source_has_no_network_provider_or_database_execution_client(self):
        source = Path(g.__file__).read_text(encoding="utf-8").lower()
        for forbidden in (
            "import boto3", "from boto3", "requests.", "urllib.", "socket.socket", "subprocess.",
            "os.system", "from supabase", "import supabase", "create_client(", "send-command", "reboot-instances",
        ):
            self.assertNotIn(forbidden, source, forbidden)


if __name__ == "__main__":
    unittest.main()
