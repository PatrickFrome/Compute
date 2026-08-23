from __future__ import annotations

import base64
import json
import unittest
from pathlib import Path

from controller.w1 import aws_ssm_iid_document_provision_guard as p

ACCOUNT = "123456789012"
REGION = "us-east-2"
DOC_PATH = Path(__file__).parents[1] / "infra" / "w1" / "ssm" / "Metaengine-W1-IID-Capture-H205F22.json"


def source() -> bytes:
    return DOC_PATH.read_bytes()


def source_b64() -> str:
    return base64.b64encode(source()).decode("ascii")


def plan() -> dict:
    return p.build_provision_plan(account_id=ACCOUNT, region=REGION, local_document_source=source())


def readback():
    local = json.loads(source())
    description = {
        "Name": p.capture.DOCUMENT_NAME,
        "Owner": ACCOUNT,
        "DocumentType": "Command",
        "DocumentVersion": "1",
        "LatestVersion": "1",
        "DefaultVersion": "1",
        "Status": "Active",
        "HashType": "Sha256",
        "Hash": "a" * 64,
        "PlatformTypes": ["Linux"],
    }
    create = {"DocumentDescription": {k: v for k, v in description.items() if k != "Status" and k != "PlatformTypes"}}
    describe = {"Document": description}
    get_doc = {
        "Name": p.capture.DOCUMENT_NAME,
        "DocumentVersion": "1",
        "DocumentType": "Command",
        "Status": "Active",
        "Content": json.dumps(local, sort_keys=True, separators=(",", ":")),
    }
    return create, describe, get_doc


class ProvisionPlanTests(unittest.TestCase):
    def test_plan_is_create_once_and_nonauthority(self):
        value = plan()
        self.assertEqual(value["required_document_version"], "1")
        self.assertTrue(value["create_once"])
        self.assertFalse(value["document_update_allowed"])
        self.assertFalse(value["document_delete_allowed"])
        self.assertFalse(value["document_share_allowed"])
        self.assertFalse(value["send_command_allowed"])
        self.assertFalse(value["authority_effect"])
        self.assertFalse(value["w1_verified"])

    def test_create_request_is_exact_parameterless_document(self):
        value = plan()
        request = value["create_request"]
        self.assertEqual(request["Name"], p.capture.DOCUMENT_NAME)
        self.assertEqual(request["DocumentType"], "Command")
        self.assertEqual(request["TargetType"], p.TARGET_TYPE)
        self.assertNotIn("Parameters", request)
        content = json.loads(request["Content"])
        self.assertEqual(content["parameters"], {})
        self.assertEqual(len(content["mainSteps"]), 1)

    def test_provisioning_role_cannot_execute_or_mutate(self):
        statements = plan()["provisioning_policy"]["Statement"]
        actions = {a for s in statements for a in ([s["Action"]] if isinstance(s["Action"], str) else s["Action"])}
        self.assertEqual(actions, {"ssm:CreateDocument", "ssm:DescribeDocument", "ssm:GetDocument"})
        for forbidden in ("ssm:SendCommand", "ssm:UpdateDocument", "ssm:DeleteDocument", "ssm:ModifyDocumentPermission", "ssm:StartSession"):
            self.assertNotIn(forbidden, actions)

    def test_create_is_restricted_to_account_owned_exact_arn_and_tags(self):
        statement = plan()["provisioning_policy"]["Statement"][0]
        self.assertEqual(statement["Resource"], f"arn:aws:ssm:{REGION}:{ACCOUNT}:document/{p.capture.DOCUMENT_NAME}")
        cond = statement["Condition"]
        self.assertEqual(cond["StringEquals"]["ssm:DocumentType"], "Command")
        self.assertEqual(cond["StringEquals"]["aws:RequestTag/metaengine:project"], "H205F22")
        self.assertEqual(cond["StringEquals"]["aws:RequestTag/metaengine:milestone"], "W1_PERSISTENT_LINUX_WORKER_SAFETY")
        self.assertEqual(set(cond["ForAllValues:StringEquals"]["aws:TagKeys"]), set(p._tags()))

    def test_bad_account_or_region_rejected(self):
        with self.assertRaises(p.ProvisionError):
            p.build_provision_plan(account_id="123", region=REGION, local_document_source=source())
        with self.assertRaises(p.ProvisionError):
            p.build_provision_plan(account_id=ACCOUNT, region="invalid", local_document_source=source())
        with self.assertRaises(p.ProvisionError):
            p.build_provision_plan(account_id=123456789012, region=REGION, local_document_source=source())


class ProvisionReadbackTests(unittest.TestCase):
    def test_version_one_exact_readback_forms_nonauthority_receipt(self):
        create, describe, get_doc = readback()
        receipt = p.validate_provisioned_document(
            plan=plan(), create_response=create, describe_response=describe,
            get_document_response=get_doc, local_document_source=source(),
        )
        self.assertEqual(receipt["classification"], "W1_AWS_SSM_IID_DOCUMENT_PROVISIONED_NON_AUTHORITY")
        self.assertTrue(receipt["document_provisioned"])
        self.assertFalse(receipt["runtime_execution_authority"])
        self.assertFalse(receipt["provider_identity_verified"])
        self.assertFalse(receipt["persistent_worker_proof"])
        self.assertFalse(receipt["authority_effect"])

    def test_any_second_version_fails_closed(self):
        create, describe, get_doc = readback()
        describe["Document"]["LatestVersion"] = "2"
        with self.assertRaisesRegex(p.ProvisionError, "latest_version_not_one"):
            p.validate_provisioned_document(
                plan=plan(), create_response=create, describe_response=describe,
                get_document_response=get_doc, local_document_source=source(),
            )

    def test_wrong_owner_fails_closed(self):
        create, describe, get_doc = readback()
        describe["Document"]["Owner"] = "999999999999"
        with self.assertRaisesRegex(p.ProvisionError, "owner_mismatch"):
            p.validate_provisioned_document(
                plan=plan(), create_response=create, describe_response=describe,
                get_document_response=get_doc, local_document_source=source(),
            )

    def test_remote_content_drift_fails_closed(self):
        create, describe, get_doc = readback()
        remote = json.loads(get_doc["Content"])
        remote["description"] = "tampered"
        get_doc["Content"] = json.dumps(remote)
        with self.assertRaises(p.capture.SSMCaptureError):
            p.validate_provisioned_document(
                plan=plan(), create_response=create, describe_response=describe,
                get_document_response=get_doc, local_document_source=source(),
            )

    def test_any_plan_field_substitution_fails_closed(self):
        value = plan()
        value["document_arn"] = "arn:aws:ssm:us-east-2:123456789012:document/attacker"
        create, describe, get_doc = readback()
        with self.assertRaisesRegex(p.ProvisionError, "plan_content_mismatch"):
            p.validate_provisioned_document(
                plan=value, create_response=create, describe_response=describe,
                get_document_response=get_doc, local_document_source=source(),
            )

    def test_local_digest_substitution_fails_closed(self):
        value = plan()
        value["repository_document_source_sha256"] = "b" * 64
        create, describe, get_doc = readback()
        with self.assertRaisesRegex(p.ProvisionError, "plan_content_mismatch"):
            p.validate_provisioned_document(
                plan=value, create_response=create, describe_response=describe,
                get_document_response=get_doc, local_document_source=source(),
            )


class StdioBoundaryTests(unittest.TestCase):
    def test_plan_request_preserves_exact_raw_document_digest(self):
        result = p.handle_request({
            "command": "plan",
            "account_id": ACCOUNT,
            "region": REGION,
            "document_source_base64": source_b64(),
        })
        self.assertEqual(result, plan())

    def test_verify_request_forms_same_nonauthority_receipt(self):
        create, describe, get_doc = readback()
        result = p.handle_request({
            "command": "verify",
            "plan": plan(),
            "create_response": create,
            "describe_response": describe,
            "get_document_response": get_doc,
            "document_source_base64": source_b64(),
        })
        self.assertEqual(result["classification"], "W1_AWS_SSM_IID_DOCUMENT_PROVISIONED_NON_AUTHORITY")
        self.assertFalse(result["authority_effect"])

    def test_unknown_request_field_rejected(self):
        with self.assertRaisesRegex(p.ProvisionError, "request_shape_invalid"):
            p.handle_request({
                "command": "plan",
                "account_id": ACCOUNT,
                "region": REGION,
                "document_source_base64": source_b64(),
                "path": "/etc/passwd",
            })

    def test_invalid_or_oversized_document_transport_rejected(self):
        with self.assertRaisesRegex(p.ProvisionError, "document_source_base64_invalid"):
            p.handle_request({
                "command": "plan",
                "account_id": ACCOUNT,
                "region": REGION,
                "document_source_base64": "not-base64!",
            })
        with self.assertRaisesRegex(p.ProvisionError, "document_source_size_invalid"):
            p._decode_document_source(base64.b64encode(b"x" * (p.MAX_DOCUMENT_SOURCE_BYTES + 1)).decode("ascii"))


if __name__ == "__main__":
    unittest.main()
