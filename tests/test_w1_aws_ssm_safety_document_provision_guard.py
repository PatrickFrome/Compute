from __future__ import annotations

import copy
import json
import unittest

from controller.w1 import aws_ssm_safety_document_provision_guard as guard
from controller.w1 import aws_ssm_safety_provision_guard as runtime_guard
from controller.w1 import build_ssm_safety_provision_document as builder


ACCOUNT_ID = "123456789012"
REGION = "us-east-2"


def responses() -> tuple[dict, dict, dict]:
    built = builder.build_document()
    common = {
        "Name": runtime_guard.DOCUMENT_NAME,
        "Owner": ACCOUNT_ID,
        "DocumentType": "Command",
        "DocumentVersion": "1",
        "LatestVersion": "1",
        "DefaultVersion": "1",
        "HashType": "Sha256",
        "Hash": "a" * 64,
        "DocumentFormat": "JSON",
        "TargetType": guard.TARGET_TYPE,
        "VersionName": guard.VERSION_NAME,
        "Parameters": [],
        "PlatformTypes": ["Linux"],
    }
    create = {"DocumentDescription": {**common, "Status": "Creating"}}
    describe = {"Document": {**common, "Status": "Active"}}
    get_document = {
        "Name": runtime_guard.DOCUMENT_NAME,
        "DocumentVersion": "1",
        "DocumentType": "Command",
        "Status": "Active",
        "Content": json.dumps(built["document"]),
    }
    return create, describe, get_document


class SafetyDocumentProvisionPlanTests(unittest.TestCase):
    def test_plan_is_create_once_readback_only(self):
        plan = guard.build_provision_plan(account_id=ACCOUNT_ID, region=REGION)
        policy = json.dumps(plan["provisioning_policy"], sort_keys=True)
        self.assertIn("ssm:CreateDocument", policy)
        self.assertIn("ssm:DescribeDocument", policy)
        self.assertIn("ssm:GetDocument", policy)
        self.assertIn(runtime_guard.DOCUMENT_NAME, policy)
        self.assertIn("aws:RequestTag/metaengine:package_sha256", policy)
        for forbidden in (
            "ssm:SendCommand",
            "ssm:UpdateDocument",
            "ssm:DeleteDocument",
            "ssm:ModifyDocumentPermission",
            "ssm:StartSession",
            "ec2:RebootInstances",
            "s3:",
            "kms:",
            "secretsmanager:",
        ):
            self.assertNotIn(forbidden, policy)
        self.assertTrue(plan["create_once"])
        self.assertFalse(plan["update_allowed"])
        self.assertFalse(plan["delete_allowed"])
        self.assertFalse(plan["share_allowed"])
        self.assertFalse(plan["send_command_allowed"])
        self.assertFalse(plan["database_mutation_allowed"])
        self.assertFalse(plan["document_provisioned"])
        self.assertFalse(plan["w1_verified"])
        self.assertFalse(plan["canonical"])
        self.assertFalse(plan["authority_effect"])

    def test_create_request_is_exact_generated_document(self):
        plan = guard.build_provision_plan(account_id=ACCOUNT_ID, region=REGION)
        request = plan["create_request"]
        self.assertEqual(runtime_guard.DOCUMENT_NAME, request["Name"])
        self.assertEqual("Command", request["DocumentType"])
        self.assertEqual("JSON", request["DocumentFormat"])
        self.assertEqual(guard.TARGET_TYPE, request["TargetType"])
        self.assertEqual(guard.VERSION_NAME, request["VersionName"])
        self.assertEqual(builder.build_document()["document"], json.loads(request["Content"]))
        self.assertLessEqual(len(request["Content"].encode()), builder.MAX_SSM_DOCUMENT_BYTES)
        self.assertEqual(
            builder.build_document()["document_sha256"],
            plan["repository_generated_document_sha256"],
        )


class SafetyDocumentProvisionReadbackTests(unittest.TestCase):
    def test_exact_version_one_readback_is_observed_but_non_authoritative(self):
        plan = guard.build_provision_plan(account_id=ACCOUNT_ID, region=REGION)
        create, describe, get_document = responses()
        result = guard.validate_provisioned_document(
            plan=plan,
            create_response=create,
            describe_response=describe,
            get_document_response=get_document,
        )
        self.assertTrue(result["document_provisioning_observation_validated"])
        self.assertFalse(result["document_provisioned"])
        self.assertFalse(result["document_provisioned_authoritatively_verified"])
        self.assertFalse(result["runtime_execution_authority"])
        self.assertFalse(result["provider_identity_verified"])
        self.assertFalse(result["host_safety_verified"])
        self.assertFalse(result["persistent_worker_proof"])
        self.assertFalse(result["w1_verified"])
        self.assertFalse(result["canonical"])
        self.assertFalse(result["authority_effect"])

    def test_second_version_default_drift_or_content_tamper_fail_closed(self):
        plan = guard.build_provision_plan(account_id=ACCOUNT_ID, region=REGION)
        create, describe, get_document = responses()
        bad = copy.deepcopy(describe)
        bad["Document"]["LatestVersion"] = "2"
        with self.assertRaises(guard.SafetyDocumentProvisionError):
            guard.validate_provisioned_document(plan=plan, create_response=create, describe_response=bad, get_document_response=get_document)
        bad = copy.deepcopy(describe)
        bad["Document"]["DefaultVersion"] = "2"
        with self.assertRaises(guard.SafetyDocumentProvisionError):
            guard.validate_provisioned_document(plan=plan, create_response=create, describe_response=bad, get_document_response=get_document)
        bad_get = copy.deepcopy(get_document)
        document = json.loads(bad_get["Content"])
        document["description"] += " tampered"
        bad_get["Content"] = json.dumps(document)
        with self.assertRaises(runtime_guard.SSMProvisionError):
            guard.validate_provisioned_document(plan=plan, create_response=create, describe_response=describe, get_document_response=bad_get)

    def test_wrong_owner_target_version_name_or_parameters_fail_closed(self):
        plan = guard.build_provision_plan(account_id=ACCOUNT_ID, region=REGION)
        create, describe, get_document = responses()
        mutations = {
            "owner": ("Owner", "999999999999"),
            "target": ("TargetType", "/"),
            "version_name": ("VersionName", "other"),
            "parameters": ("Parameters", [{"Name": "commands", "Type": "String"}]),
        }
        for name, (key, value) in mutations.items():
            with self.subTest(name=name):
                bad = copy.deepcopy(describe)
                bad["Document"][key] = value
                with self.assertRaises(guard.SafetyDocumentProvisionError):
                    guard.validate_provisioned_document(plan=plan, create_response=create, describe_response=bad, get_document_response=get_document)

    def test_caller_cannot_tamper_plan_policy_or_hash_binding(self):
        plan = guard.build_provision_plan(account_id=ACCOUNT_ID, region=REGION)
        create, describe, get_document = responses()
        for mutate in (
            lambda p: p.__setitem__("send_command_allowed", True),
            lambda p: p.__setitem__("package_sha256", "f" * 64),
            lambda p: p["provisioning_policy"]["Statement"].append({"Effect": "Allow", "Action": "ssm:SendCommand", "Resource": "*"}),
        ):
            bad = copy.deepcopy(plan)
            mutate(bad)
            with self.assertRaises(guard.SafetyDocumentProvisionError):
                guard.validate_provisioned_document(plan=bad, create_response=create, describe_response=describe, get_document_response=get_document)


if __name__ == "__main__":
    unittest.main()
