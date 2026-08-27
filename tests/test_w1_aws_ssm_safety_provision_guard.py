from __future__ import annotations

import copy
import json
import unittest

from controller.w1 import aws_ssm_safety_provision_guard as guard
from controller.w1 import build_host_safety_package as package_builder
from controller.w1 import build_ssm_safety_provision_document as provision_builder


INSTANCE_ID = "i-0123456789abcdef0"
WORKER_ID = "w1-worker-01"
ACCOUNT_ID = "123456789012"
REGION = "us-east-2"
COMMAND_ID = "12345678-1234-1234-1234-123456789abc"


def make_courier() -> dict:
    build = provision_builder.build_document()
    return {
        "schema": guard.COURIER_SCHEMA,
        "source": "HOST_UNTRUSTED_TRANSPORT",
        "transport": "AWS_SSM_RUN_COMMAND_FIXED_EMBEDDED_PACKAGE",
        "package_id": package_builder.PACKAGE_ID,
        "package_version": package_builder.PACKAGE_VERSION,
        "package_zip_sha256": build["package_sha256"],
        "package_zip_bytes": build["package_bytes"],
        "payload_lock_sha256": build["payload_lock_sha256"],
        "source_commit_sha": package_builder.SOURCE_COMMIT,
        "source_tree_sha": package_builder.SOURCE_TREE,
        "install_root": package_builder.INSTALL_ROOT,
        "execution_user": package_builder.EXECUTION_USER,
        "workspace_root": package_builder.WORKSPACE_ROOT,
        "package_install_observed": True,
        "package_provisioning_verified": False,
        "host_safety_verified": False,
        "capture_executed": False,
        "provider_identity_verified": False,
        "reboot_completion_proven": False,
        "persistent_worker_proof": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }


def remote_document_fixture() -> tuple[dict, dict]:
    build = provision_builder.build_document()
    description = {
        "Document": {
            "Name": guard.DOCUMENT_NAME,
            "Owner": ACCOUNT_ID,
            "DocumentType": "Command",
            "Status": "Active",
            "DocumentVersion": "1",
            "HashType": "Sha256",
            "Hash": "a" * 64,
            "PlatformTypes": ["Linux"],
        }
    }
    get_document = {
        "Name": guard.DOCUMENT_NAME,
        "DocumentVersion": "1",
        "DocumentType": "Command",
        "Status": "Active",
        "Content": json.dumps(build["document"]),
    }
    return description, get_document


class ProvisionSessionBoundaryTests(unittest.TestCase):
    def test_expected_document_is_exact_parameterless_generated_program(self):
        build = guard.expected_build()
        expected = guard.validate_expected_document(build["document"])
        self.assertEqual({}, expected["parameters"])
        self.assertEqual("aws:runShellScript", expected["mainSteps"][0]["action"])
        self.assertEqual(guard.expected_document_bytes(), provision_builder.canonical_bytes(expected))
        self.assertEqual(build["document_sha256"], provision_builder.sha256_bytes(guard.expected_document_bytes()))

    def test_session_policy_is_exact_provision_doc_and_tagged_instance_only(self):
        boundary = guard.build_session_boundary(
            instance_id=INSTANCE_ID,
            worker_id=WORKER_ID,
            account_id=ACCOUNT_ID,
            region=REGION,
        )
        policy = json.dumps(boundary["session_policy"], sort_keys=True)
        for required in (
            "ssm:SendCommand",
            "ssm:GetCommandInvocation",
            "ssm:DescribeInstanceInformation",
            guard.DOCUMENT_NAME,
            "ssm:resourceTag/metaengine:worker_id",
        ):
            self.assertIn(required, policy)
        for forbidden in (
            "AWS-ConfigureAWSPackage",
            "Metaengine-W1-Safety-Capture-H205F22",
            "ssm:StartSession",
            "ssm:CreateDocument",
            "ssm:UpdateDocument",
            "ssm:DeleteDocument",
            "ec2:RebootInstances",
            "s3:",
            "kms:Decrypt",
            "secretsmanager:",
        ):
            self.assertNotIn(forbidden, policy)
        self.assertFalse(boundary["arbitrary_command_parameters_allowed"])
        self.assertFalse(boundary["generic_package_document_allowed"])
        self.assertFalse(boundary["capture_document_allowed"])
        self.assertFalse(boundary["reboot_allowed"])
        self.assertFalse(boundary["database_mutation_allowed"])
        self.assertFalse(boundary["package_provisioning_verified"])
        self.assertFalse(boundary["w1_verified"])
        self.assertFalse(boundary["authority_effect"])

    def test_managed_node_must_be_exact_online_linux_ec2(self):
        result = guard.validate_managed_node(
            {
                "InstanceInformationList": [
                    {
                        "InstanceId": INSTANCE_ID,
                        "PingStatus": "Online",
                        "PlatformType": "Linux",
                        "ResourceType": "EC2Instance",
                        "AgentVersion": "3.3.3000.0",
                    }
                ]
            },
            expected_instance_id=INSTANCE_ID,
        )
        self.assertEqual(INSTANCE_ID, result["instance_id"])
        bad = {
            "InstanceInformationList": [
                {
                    "InstanceId": INSTANCE_ID,
                    "PingStatus": "ConnectionLost",
                    "PlatformType": "Linux",
                    "ResourceType": "EC2Instance",
                }
            ]
        }
        with self.assertRaises(guard.SSMProvisionError):
            guard.validate_managed_node(bad, expected_instance_id=INSTANCE_ID)


class ProvisionRemoteDocumentTests(unittest.TestCase):
    def test_exact_remote_version_one_document_passes(self):
        description, get_document = remote_document_fixture()
        result = guard.validate_remote_document(
            description=description,
            get_document=get_document,
            account_id=ACCOUNT_ID,
        )
        self.assertTrue(result["remote_content_matches_generated_document"])
        self.assertEqual({}, result["document_parameters"])
        self.assertEqual(provision_builder.build_document()["package_sha256"], result["package_sha256"])

    def test_remote_document_tamper_fails_even_when_shape_is_valid(self):
        description, get_document = remote_document_fixture()
        tampered = json.loads(get_document["Content"])
        tampered["description"] += " tampered"
        get_document["Content"] = json.dumps(tampered)
        with self.assertRaises(guard.SSMProvisionError):
            guard.validate_remote_document(
                description=description,
                get_document=get_document,
                account_id=ACCOUNT_ID,
            )

    def test_wrong_owner_or_version_fails(self):
        description, get_document = remote_document_fixture()
        wrong_owner = copy.deepcopy(description)
        wrong_owner["Document"]["Owner"] = "999999999999"
        with self.assertRaises(guard.SSMProvisionError):
            guard.validate_remote_document(description=wrong_owner, get_document=get_document, account_id=ACCOUNT_ID)
        wrong_version = copy.deepcopy(description)
        wrong_version["Document"]["DocumentVersion"] = "2"
        with self.assertRaises(guard.SSMProvisionError):
            guard.validate_remote_document(description=wrong_version, get_document=get_document, account_id=ACCOUNT_ID)


class ProvisionCommandTests(unittest.TestCase):
    def test_command_plan_pins_version_hash_target_and_empty_parameters(self):
        plan = guard.build_command_plan(instance_id=INSTANCE_ID, aws_document_sha256="a" * 64)
        self.assertEqual([INSTANCE_ID], plan["instance_ids"])
        self.assertEqual("1", plan["document_version"])
        self.assertEqual("Sha256", plan["document_hash_type"])
        self.assertEqual({}, plan["parameters"])
        self.assertFalse(plan["capture_authority"])
        self.assertFalse(plan["reboot_authority"])
        self.assertFalse(plan["database_mutation_authority"])
        self.assertFalse(plan["package_provisioning_verified"])

    def test_send_response_rejects_parameters_or_wrong_target(self):
        plan = guard.build_command_plan(instance_id=INSTANCE_ID, aws_document_sha256="a" * 64)
        good = {
            "Command": {
                "CommandId": COMMAND_ID,
                "DocumentName": guard.DOCUMENT_NAME,
                "DocumentVersion": "1",
                "InstanceIds": [INSTANCE_ID],
                "Parameters": {},
            }
        }
        self.assertEqual(COMMAND_ID, guard.validate_send_command_response(good, plan=plan))
        injected = copy.deepcopy(good)
        injected["Command"]["Parameters"] = {"commands": ["id"]}
        with self.assertRaises(guard.SSMProvisionError):
            guard.validate_send_command_response(injected, plan=plan)
        wrong_target = copy.deepcopy(good)
        wrong_target["Command"]["InstanceIds"] = ["i-0abcdef0123456789"]
        with self.assertRaises(guard.SSMProvisionError):
            guard.validate_send_command_response(wrong_target, plan=plan)


class ProvisionCourierTests(unittest.TestCase):
    def test_exact_courier_is_valid_transport_but_not_verified_provisioning(self):
        result = guard.validate_courier(make_courier())
        self.assertTrue(result["package_install_observed"])
        self.assertEqual(provision_builder.build_document()["package_sha256"], result["package_sha256"])

    def test_authority_injection_or_package_hash_tamper_is_rejected(self):
        authority = make_courier()
        authority["package_provisioning_verified"] = True
        with self.assertRaises(guard.SSMProvisionError):
            guard.validate_courier(authority)
        tampered = make_courier()
        tampered["package_zip_sha256"] = "f" * 64
        with self.assertRaises(guard.SSMProvisionError):
            guard.validate_courier(tampered)

    def test_command_invocation_receipt_remains_non_authoritative(self):
        courier = make_courier()
        receipt = guard.validate_command_invocation(
            {
                "CommandId": COMMAND_ID,
                "InstanceId": INSTANCE_ID,
                "DocumentName": guard.DOCUMENT_NAME,
                "Status": "Success",
                "StandardOutputContent": json.dumps(courier, sort_keys=True, separators=(",", ":")),
                "StandardErrorContent": "",
            },
            expected_command_id=COMMAND_ID,
            expected_instance_id=INSTANCE_ID,
        )
        self.assertTrue(receipt["provision_transport_validated"])
        self.assertTrue(receipt["package_install_observed"])
        self.assertFalse(receipt["package_provisioning_verified"])
        self.assertFalse(receipt["capture_executed"])
        self.assertFalse(receipt["host_safety_verified"])
        self.assertFalse(receipt["persistent_worker_proof"])
        self.assertFalse(receipt["w1_verified"])
        self.assertFalse(receipt["authority_effect"])
        self.assertFalse(receipt["evidence"]["aws_api_response_provenance_verified"])


if __name__ == "__main__":
    unittest.main()
