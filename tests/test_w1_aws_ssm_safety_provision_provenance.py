from __future__ import annotations

import copy
import json
import unittest

from controller.w1 import aws_instance_identity_verifier as iid_verifier
from controller.w1 import aws_ssm_safety_provision_guard as provision_guard
from controller.w1 import aws_ssm_safety_provision_provenance as provenance
from controller.w1 import build_host_safety_package as package_builder
from controller.w1 import build_ssm_safety_provision_document as provision_builder


INSTANCE_ID = "i-0123456789abcdef0"
WORKER_ID = "w1-worker-01"
ACCOUNT_ID = "123456789012"
REGION = "us-east-2"
AZ = "us-east-2a"
IMAGE_ID = "ami-0123456789abcdef0"
COMMAND_ID = "12345678-1234-1234-1234-123456789abc"
PROVISIONER_ROLE_ARN = "arn:aws:iam::123456789012:role/MetaengineW1Provision"
ROLE_SESSION = "w1-provision-123"
REQUESTED_AT = "2026-08-27T21:20:00Z"
RETURNED_AT = "2026-08-27T21:20:02Z"


def make_courier() -> dict:
    build = provision_builder.build_document()
    return {
        "schema": provision_guard.COURIER_SCHEMA,
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


def preflight_bundle() -> dict:
    return {
        "instance": {
            "InstanceId": INSTANCE_ID,
            "State": {"Name": "running"},
            "Tags": [
                {"Key": "metaengine:project", "Value": "H205F22"},
                {"Key": "metaengine:milestone", "Value": "W1_PERSISTENT_LINUX_WORKER_SAFETY"},
                {"Key": "metaengine:worker_id", "Value": WORKER_ID},
                {"Key": "metaengine:github_sha", "Value": package_builder.SOURCE_COMMIT},
                {"Key": "metaengine:authority", "Value": "noncanonical-worker"},
                {"Key": "metaengine:execution_tier", "Value": "persistent-host"},
            ],
            "MetadataOptions": {
                "HttpTokens": "required",
                "HttpPutResponseHopLimit": 1,
                "HttpEndpoint": "enabled",
            },
            "SecurityGroups": [{"GroupId": "sg-0123456789abcdef0"}],
            "Placement": {"AvailabilityZone": AZ},
            "InstanceType": "t3.small",
            "ImageId": IMAGE_ID,
            "PrivateIpAddress": "10.0.0.10",
        },
        "security_groups": [{"GroupId": "sg-0123456789abcdef0", "IpPermissions": []}],
        "root_volume": {"VolumeId": "vol-0123456789abcdef0", "Encrypted": True, "VolumeType": "gp3"},
    }


def managed_node_response() -> dict:
    return {
        "InstanceInformationList": [
            {
                "InstanceId": INSTANCE_ID,
                "PingStatus": "Online",
                "PlatformType": "Linux",
                "ResourceType": "EC2Instance",
                "AgentVersion": "3.3.3000.0",
                "LastPingDateTime": "2026-08-27T21:20:01Z",
            }
        ]
    }


def document_responses() -> tuple[dict, dict]:
    build = provision_builder.build_document()
    description = {
        "Document": {
            "Name": provision_guard.DOCUMENT_NAME,
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
        "Name": provision_guard.DOCUMENT_NAME,
        "DocumentVersion": "1",
        "DocumentType": "Command",
        "Status": "Active",
        "Content": json.dumps(build["document"]),
    }
    return description, get_document


def verified_iid() -> dict:
    evidence = {
        "provider_kind": "AWS_EC2",
        "provider_instance_id": INSTANCE_ID,
        "provider_account_id": ACCOUNT_ID,
        "region": REGION,
        "availability_zone": AZ,
        "architecture": "x86_64",
        "image_id": IMAGE_ID,
        "private_ip": "10.0.0.10",
        "pending_time": "2026-08-27T20:00:00Z",
        "signature_format": "AWS_EC2_IID_RSA2048_PKCS7_SHA256",
        "certificate_der_sha256": "b" * 64,
        "document_sha256": "c" * 64,
        "signature_der_sha256": "d" * 64,
    }
    return {
        "schema": iid_verifier.VERIFICATION_SCHEMA,
        "classification": "SIGNED_PROVIDER_IDENTITY_VERIFIED_NONAUTHORITY",
        "identity_attestation_kind": "SIGNED_PROVIDER_IDENTITY",
        "identity_attestation_verified": True,
        "evidence": evidence,
        "verification_receipt_sha256": provenance._sha(evidence),
        "persistent_worker_proof": False,
        "reboot_completion_proven": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }


def verifier_caller() -> dict:
    return {
        "Account": ACCOUNT_ID,
        "Arn": f"arn:aws:sts::{ACCOUNT_ID}:assumed-role/MetaengineW1Verify/w1-verify-123",
        "UserId": "AROAVERIFIEREXAMPLE:w1-verify-123",
    }


def cloudtrail_raw() -> dict:
    return {
        "eventVersion": "1.10",
        "userIdentity": {
            "type": "AssumedRole",
            "principalId": f"AROAPROVISIONEXAMPLE:{ROLE_SESSION}",
            "arn": f"arn:aws:sts::{ACCOUNT_ID}:assumed-role/MetaengineW1Provision/{ROLE_SESSION}",
            "accountId": ACCOUNT_ID,
            "sessionContext": {
                "sessionIssuer": {
                    "type": "Role",
                    "arn": PROVISIONER_ROLE_ARN,
                    "accountId": ACCOUNT_ID,
                    "userName": "MetaengineW1Provision",
                }
            },
        },
        "eventTime": "2026-08-27T21:20:01Z",
        "eventSource": "ssm.amazonaws.com",
        "eventName": "SendCommand",
        "awsRegion": REGION,
        "requestParameters": {
            "documentName": provision_guard.DOCUMENT_NAME,
            "documentVersion": "1",
            "documentHash": "a" * 64,
            "documentHashType": "Sha256",
            "instanceIds": [INSTANCE_ID],
            "parameters": {},
            "timeoutSeconds": 120,
        },
        "responseElements": {
            "command": {
                "commandId": COMMAND_ID,
                "documentName": provision_guard.DOCUMENT_NAME,
                "documentVersion": "1",
                "instanceIds": [INSTANCE_ID],
                "parameters": {},
            }
        },
        "eventID": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        "recipientAccountId": ACCOUNT_ID,
        "eventType": "AwsApiCall",
        "managementEvent": True,
        "eventCategory": "Management",
    }


def cloudtrail_lookup(raw: dict | None = None) -> dict:
    raw = cloudtrail_raw() if raw is None else raw
    return {
        "Events": [
            {
                "EventName": "SendCommand",
                "EventTime": raw["eventTime"],
                "CloudTrailEvent": json.dumps(raw, sort_keys=True, separators=(",", ":")),
            }
        ]
    }


def command_invocation() -> dict:
    return {
        "CommandId": COMMAND_ID,
        "InstanceId": INSTANCE_ID,
        "DocumentName": provision_guard.DOCUMENT_NAME,
        "DocumentVersion": "1",
        "PluginName": "installPinnedSafetyPackage",
        "ResponseCode": 0,
        "ExecutionStartDateTime": "2026-08-27T21:20:03Z",
        "ExecutionEndDateTime": "2026-08-27T21:20:04Z",
        "Status": "Success",
        "StatusDetails": "Success",
        "StandardOutputContent": json.dumps(make_courier(), sort_keys=True, separators=(",", ":")),
        "StandardErrorContent": "",
    }


def compose(**overrides) -> dict:
    description, get_document = document_responses()
    args = {
        "instance_id": INSTANCE_ID,
        "worker_id": WORKER_ID,
        "account_id": ACCOUNT_ID,
        "region": REGION,
        "provisioner_role_arn": PROVISIONER_ROLE_ARN,
        "role_session": ROLE_SESSION,
        "requested_at": REQUESTED_AT,
        "api_returned_at": RETURNED_AT,
        "verifier_caller_identity": verifier_caller(),
        "preflight_bundle": preflight_bundle(),
        "managed_node_response": managed_node_response(),
        "document_description": description,
        "get_document_response": get_document,
        "cloudtrail_lookup": cloudtrail_lookup(),
        "command_invocation": command_invocation(),
        "verified_iid": verified_iid(),
    }
    args.update(overrides)
    return provenance.compose_provisioning_provenance(**args)


class ReadOnlyVerifierBoundaryTests(unittest.TestCase):
    def test_verifier_policy_has_zero_mutation_surface(self):
        boundary = provenance.build_verifier_session_boundary(account_id=ACCOUNT_ID, region=REGION)
        policy = json.dumps(boundary["session_policy"], sort_keys=True)
        for required in (
            "ec2:DescribeInstances",
            "ssm:DescribeInstanceInformation",
            "ssm:GetDocument",
            "ssm:GetCommandInvocation",
            "cloudtrail:LookupEvents",
            provision_guard.DOCUMENT_NAME,
        ):
            self.assertIn(required, policy)
        for forbidden in (
            "ssm:SendCommand",
            "ssm:StartSession",
            "ssm:CreateDocument",
            "ssm:UpdateDocument",
            "ec2:RebootInstances",
            "ec2:RunInstances",
            "ec2:TerminateInstances",
            "s3:",
            "kms:",
            "secretsmanager:",
        ):
            self.assertNotIn(forbidden, policy)
        self.assertFalse(boundary["send_command_allowed"])
        self.assertFalse(boundary["reboot_allowed"])
        self.assertFalse(boundary["database_mutation_allowed"])
        self.assertFalse(boundary["w1_verified"])


class ProvisioningProvenanceTests(unittest.TestCase):
    def test_full_independent_bundle_verifies_only_package_provisioning(self):
        result = compose()
        self.assertEqual(provenance.PROVENANCE_SCHEMA, result["schema"])
        self.assertTrue(result["cloudtrail_send_command_verified"])
        self.assertTrue(result["signed_provider_identity_verified"])
        self.assertTrue(result["provider_host_binding_verified"])
        self.assertTrue(result["managed_node_binding_verified"])
        self.assertTrue(result["remote_document_identity_verified"])
        self.assertTrue(result["command_invocation_verified"])
        self.assertTrue(result["package_install_observed"])
        self.assertTrue(result["package_provisioning_verified"])
        self.assertTrue(result["provider_api_mutation_observed"])
        self.assertTrue(result["host_filesystem_mutation_observed"])
        self.assertFalse(result["capture_executed"])
        self.assertFalse(result["host_safety_verified"])
        self.assertFalse(result["reboot_completion_proven"])
        self.assertFalse(result["persistent_worker_proof"])
        self.assertFalse(result["worker_admitted"])
        self.assertFalse(result["w1_verified"])
        self.assertFalse(result["database_mutation"])
        self.assertFalse(result["canonical"])
        self.assertFalse(result["authority_effect"])
        self.assertEqual(COMMAND_ID, result["evidence"]["command_id"])
        self.assertEqual(provision_builder.build_document()["package_sha256"], result["evidence"]["package_sha256"])

    def test_composition_is_deterministic(self):
        first = compose()
        second = compose()
        self.assertEqual(first, second)
        self.assertEqual(first["evidence_sha256"], provenance._sha(first["evidence"]))

    def test_cloudtrail_wrong_role_hash_target_or_parameters_fail_closed(self):
        mutations = []
        raw = cloudtrail_raw()
        bad = copy.deepcopy(raw)
        bad["userIdentity"]["sessionContext"]["sessionIssuer"]["arn"] = f"arn:aws:iam::{ACCOUNT_ID}:role/OtherRole"
        mutations.append(bad)
        bad = copy.deepcopy(raw)
        bad["requestParameters"]["documentHash"] = "f" * 64
        mutations.append(bad)
        bad = copy.deepcopy(raw)
        bad["requestParameters"]["instanceIds"] = ["i-0abcdef0123456789"]
        mutations.append(bad)
        bad = copy.deepcopy(raw)
        bad["requestParameters"]["parameters"] = {"commands": ["id"]}
        mutations.append(bad)
        for candidate in mutations:
            with self.subTest(candidate=candidate["requestParameters"]):
                with self.assertRaises(provenance.ProvisionProvenanceError):
                    compose(cloudtrail_lookup=cloudtrail_lookup(candidate))

    def test_duplicate_matching_cloudtrail_events_fail_closed(self):
        one = cloudtrail_lookup()["Events"][0]
        with self.assertRaises(provenance.ProvisionProvenanceError):
            compose(cloudtrail_lookup={"Events": [copy.deepcopy(one), copy.deepcopy(one)]})

    def test_signed_iid_must_bind_image_and_availability_zone(self):
        iid = verified_iid()
        iid["evidence"]["image_id"] = "ami-0ffffffffffffffff"
        iid["verification_receipt_sha256"] = provenance._sha(iid["evidence"])
        with self.assertRaises(provenance.ProvisionProvenanceError):
            compose(verified_iid=iid)

        iid = verified_iid()
        iid["evidence"]["availability_zone"] = "us-east-2b"
        iid["verification_receipt_sha256"] = provenance._sha(iid["evidence"])
        with self.assertRaises(provenance.ProvisionProvenanceError):
            compose(verified_iid=iid)

    def test_invocation_must_pin_version_plugin_response_code_and_times(self):
        for field, value in (
            ("DocumentVersion", "2"),
            ("PluginName", "otherStep"),
            ("ResponseCode", 1),
            ("ExecutionEndDateTime", "2026-08-27T21:20:02Z"),
        ):
            invocation = command_invocation()
            invocation[field] = value
            with self.subTest(field=field):
                with self.assertRaises((provenance.ProvisionProvenanceError, provision_guard.SSMProvisionError)):
                    compose(command_invocation=invocation)

    def test_verifier_must_be_assumed_role_in_same_account(self):
        caller = verifier_caller()
        caller["Account"] = "999999999999"
        with self.assertRaises(provenance.ProvisionProvenanceError):
            compose(verifier_caller_identity=caller)
        caller = verifier_caller()
        caller["Arn"] = f"arn:aws:iam::{ACCOUNT_ID}:user/not-allowed"
        with self.assertRaises(provenance.ProvisionProvenanceError):
            compose(verifier_caller_identity=caller)

    def test_host_courier_cannot_self_assert_verified_provisioning(self):
        invocation = command_invocation()
        courier = make_courier()
        courier["package_provisioning_verified"] = True
        invocation["StandardOutputContent"] = json.dumps(courier, sort_keys=True, separators=(",", ":"))
        with self.assertRaises(provision_guard.SSMProvisionError):
            compose(command_invocation=invocation)


if __name__ == "__main__":
    unittest.main()
