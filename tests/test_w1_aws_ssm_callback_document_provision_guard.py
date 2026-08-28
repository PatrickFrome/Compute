from __future__ import annotations

import copy
import json
from pathlib import Path
import unittest

from controller.w1 import aws_ssm_callback_document_provision_guard as guard

ROOT = Path(__file__).resolve().parents[1]
DOCS = {
    guard.KEY_KIND: ROOT / "infra/w1/ssm/Metaengine-W1-Callback-Key-Enroll-H205F22.json",
    guard.EXEC_KIND: ROOT / "infra/w1/ssm/Metaengine-W1-Execution-Marker-H205F22.json",
}
ACCOUNT = "123456789012"
REGION = "us-east-1"
AWS_HASH = "a" * 64


def source(kind: str) -> bytes:
    return DOCS[kind].read_bytes()


def responses(kind: str, raw: bytes):
    plan = guard.build_provision_plan(document_kind=kind, account_id=ACCOUNT, region=REGION,
                                      local_document_source=raw)
    name = plan["document_name"]
    description = {
        "Name": name,
        "Owner": ACCOUNT,
        "DocumentType": "Command",
        "DocumentFormat": "JSON",
        "DocumentVersion": "1",
        "LatestVersion": "1",
        "DefaultVersion": "1",
        "Status": "Active",
        "HashType": "Sha256",
        "Hash": AWS_HASH,
        "PlatformTypes": ["Linux"],
        "TargetType": "/AWS::EC2::Instance",
    }
    create = {"DocumentDescription": copy.deepcopy(description)}
    describe = {"Document": copy.deepcopy(description)}
    get = {
        "Name": name,
        "DocumentVersion": "1",
        "DocumentType": "Command",
        "DocumentFormat": "JSON",
        "Status": "Active",
        "Content": json.dumps(json.loads(raw)),
    }
    return plan, create, describe, get


class CallbackDocumentProvisionGuardTests(unittest.TestCase):
    def test_both_reviewed_documents_build_create_once_non_authority_plans(self):
        for kind in DOCS:
            raw = source(kind)
            plan = guard.build_provision_plan(document_kind=kind, account_id=ACCOUNT, region=REGION,
                                              local_document_source=raw)
            self.assertEqual(guard.PLAN_SCHEMA, plan["schema"])
            self.assertEqual("ssm:CreateDocument", plan["provisioning_policy"]["Statement"][0]["Action"])
            self.assertEqual(["ssm:DescribeDocument", "ssm:GetDocument"],
                             plan["provisioning_policy"]["Statement"][1]["Action"])
            self.assertEqual("Command", plan["create_request"]["DocumentType"])
            self.assertEqual("JSON", plan["create_request"]["DocumentFormat"])
            self.assertEqual("/AWS::EC2::Instance", plan["create_request"]["TargetType"])
            self.assertTrue(plan["create_once"])
            for field in (
                "policy_template_update_document_allow",
                "policy_template_update_default_version_allow",
                "policy_template_delete_document_allow",
                "policy_template_modify_document_permission_allow",
                "policy_template_put_resource_policy_allow",
                "policy_template_send_command_allow",
                "policy_template_start_session_allow",
                "effective_principal_permissions_verified",
                "canonical", "authority_effect", "runtime_execution_authority",
                "provider_identity_verified", "persistent_worker_proof", "worker_admitted", "w1_verified",
            ):
                self.assertIs(plan[field], False, (kind, field))
            actions = json.dumps(plan["provisioning_policy"])
            for forbidden in ("UpdateDocument", "UpdateDocumentDefaultVersion", "DeleteDocument",
                              "ModifyDocumentPermission", "PutResourcePolicy", "SendCommand", "StartSession"):
                self.assertNotIn(forbidden, actions)

    def test_parameter_contracts_are_exact(self):
        key = guard.parse_local_document(source(guard.KEY_KIND), kind=guard.KEY_KIND)
        self.assertEqual({}, key["parameters"])
        execution = guard.parse_local_document(source(guard.EXEC_KIND), kind=guard.EXEC_KIND)
        self.assertEqual(guard.EXEC_PARAMETERS, execution["parameters"])
        for name, spec in execution["parameters"].items():
            self.assertEqual("ENV_VAR", spec["interpolationType"], name)
            self.assertIn("allowedPattern", spec, name)

    def test_verified_transport_receipt_remains_non_authority(self):
        for kind in DOCS:
            raw = source(kind)
            plan, create, describe, get = responses(kind, raw)
            receipt = guard.validate_provisioned_document(
                plan=plan, create_response=create, describe_response=describe,
                get_document_response=get, local_document_source=raw)
            self.assertTrue(receipt["document_provisioning_observation_validated"])
            self.assertTrue(receipt["evidence"]["remote_content_matches_repository"])
            self.assertFalse(receipt["document_provisioned"])
            self.assertFalse(receipt["document_provisioned_authoritatively_verified"])
            self.assertFalse(receipt["runtime_execution_authority"])
            self.assertFalse(receipt["worker_admitted"])
            self.assertFalse(receipt["w1_verified"])
            self.assertFalse(receipt["canonical"])
            self.assertFalse(receipt["authority_effect"])
            self.assertEqual(guard.AWS_RESPONSE_PROVENANCE,
                             receipt["evidence"]["aws_api_response_provenance"])

    def test_plan_tamper_fails_closed(self):
        raw = source(guard.KEY_KIND)
        plan, create, describe, get = responses(guard.KEY_KIND, raw)
        plan = copy.deepcopy(plan)
        plan["provisioning_policy"]["Statement"][0]["Action"] = ["ssm:CreateDocument", "ssm:SendCommand"]
        with self.assertRaisesRegex(guard.CallbackDocumentProvisionError, "plan_content_mismatch"):
            guard.validate_provisioned_document(plan=plan, create_response=create,
                                                describe_response=describe, get_document_response=get,
                                                local_document_source=raw)

    def test_wrong_owner_version_hash_or_state_fails_closed(self):
        raw = source(guard.EXEC_KIND)
        for target, field, value in (
            ("create", "Owner", "999999999999"),
            ("describe", "LatestVersion", "2"),
            ("describe", "DefaultVersion", "2"),
            ("describe", "DocumentVersion", "2"),
            ("describe", "HashType", "Sha1"),
            ("describe", "Hash", "not-a-sha"),
            ("describe", "Status", "Updating"),
            ("describe", "TargetType", "/"),
        ):
            plan, create, describe, get = responses(guard.EXEC_KIND, raw)
            response = create if target == "create" else describe
            key = "DocumentDescription" if target == "create" else "Document"
            response[key][field] = value
            with self.assertRaises(guard.CallbackDocumentProvisionError, msg=(target, field)):
                guard.validate_provisioned_document(plan=plan, create_response=create,
                                                    describe_response=describe, get_document_response=get,
                                                    local_document_source=raw)

    def test_remote_content_tamper_fails_closed(self):
        for kind in DOCS:
            raw = source(kind)
            plan, create, describe, get = responses(kind, raw)
            remote = json.loads(get["Content"])
            remote["description"] += " tampered"
            get["Content"] = json.dumps(remote)
            with self.assertRaisesRegex(guard.CallbackDocumentProvisionError,
                                        "remote_document_content_mismatch"):
                guard.validate_provisioned_document(plan=plan, create_response=create,
                                                    describe_response=describe, get_document_response=get,
                                                    local_document_source=raw)

    def test_key_document_parameter_injection_fails(self):
        doc = json.loads(source(guard.KEY_KIND))
        doc["parameters"]["Command"] = {"type": "String"}
        with self.assertRaisesRegex(guard.CallbackDocumentProvisionError, "parameters_forbidden"):
            guard.validate_local_document(doc, kind=guard.KEY_KIND)

    def test_execution_parameter_injection_or_weakened_interpolation_fails(self):
        original = json.loads(source(guard.EXEC_KIND))
        cases = []
        extra = copy.deepcopy(original)
        extra["parameters"]["ShellCommand"] = {"type": "String"}
        cases.append(extra)
        raw_substitution = copy.deepcopy(original)
        del raw_substitution["parameters"]["WorkerId"]["interpolationType"]
        cases.append(raw_substitution)
        weak_pattern = copy.deepcopy(original)
        weak_pattern["parameters"]["ChallengeNonce"]["allowedPattern"] = ".*"
        cases.append(weak_pattern)
        for doc in cases:
            with self.assertRaisesRegex(guard.CallbackDocumentProvisionError,
                                        "execution_document_parameters_mismatch"):
                guard.validate_local_document(doc, kind=guard.EXEC_KIND)

    def test_remote_document_cannot_switch_to_run_document_or_external_source(self):
        original = json.loads(source(guard.EXEC_KIND))
        for injection in ("AWS-RunDocument", "aws:runDocument", "github.com", "s3://"):
            doc = copy.deepcopy(original)
            doc["mainSteps"][0]["inputs"]["runCommand"][0] += "\n# " + injection
            with self.assertRaises(guard.CallbackDocumentProvisionError, msg=injection):
                guard.validate_local_document(doc, kind=guard.EXEC_KIND)

    def test_create_request_tags_are_exact_and_distinct(self):
        key = guard.build_provision_plan(document_kind=guard.KEY_KIND, account_id=ACCOUNT, region=REGION,
                                         local_document_source=source(guard.KEY_KIND))
        execution = guard.build_provision_plan(document_kind=guard.EXEC_KIND, account_id=ACCOUNT, region=REGION,
                                               local_document_source=source(guard.EXEC_KIND))
        self.assertNotEqual(key["required_tags"]["metaengine:purpose"],
                            execution["required_tags"]["metaengine:purpose"])
        for plan in (key, execution):
            request_tags = {item["Key"]: item["Value"] for item in plan["create_request"]["Tags"]}
            self.assertEqual(plan["required_tags"], request_tags)
            tag_keys = plan["provisioning_policy"]["Statement"][0]["Condition"]["ForAllValues:StringEquals"]["aws:TagKeys"]
            self.assertEqual(sorted(plan["required_tags"]), tag_keys)


if __name__ == "__main__":
    unittest.main()
