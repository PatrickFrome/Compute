from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

from controller.w1 import aws_ssm_iid_capture_guard as g
from worker.native_linux import aws_iid_courier as courier

INSTANCE_ID = "i-0123456789abcdef0"
WORKER_ID = "glm-sandbox-worker-01"
W1_SHA = "a" * 40
ACCOUNT_ID = "123456789012"
REGION = "us-east-2"
AWS_DOC_SHA = "b" * 64
COMMAND_ID = "11111111-2222-3333-4444-555555555555"
DOC_PATH = Path("infra/w1/ssm/Metaengine-W1-IID-Capture-H205F22.json")
DOC_SOURCE = DOC_PATH.read_bytes()
REPO_DOC_SHA = g._sha_bytes(DOC_SOURCE)


def boundary():
    return g.build_session_boundary(
        instance_id=INSTANCE_ID,
        worker_id=WORKER_ID,
        w1_sha=W1_SHA,
        account_id=ACCOUNT_ID,
        region=REGION,
        local_document_source=DOC_SOURCE,
    )


def plan():
    return g.build_command_plan(
        instance_id=INSTANCE_ID,
        aws_document_sha256=AWS_DOC_SHA,
        repository_document_source_sha256=REPO_DOC_SHA,
    )


def envelope():
    document = b'{"accountId":"123456789012","instanceId":"i-0123456789abcdef0","region":"us-east-2"}'
    rsa = b"M" * 512
    import base64, hashlib
    return {
        "schema": courier.SCHEMA,
        "source": "HOST_UNTRUSTED_TRANSPORT",
        "transport": "AWS_IMDSV2_LINK_LOCAL_IPV4",
        "document_base64": base64.b64encode(document).decode(),
        "document_sha256": hashlib.sha256(document).hexdigest(),
        "rsa2048_base64": base64.b64encode(rsa).decode(),
        "rsa2048_transport_sha256": hashlib.sha256(rsa).hexdigest(),
        "provider_identity_verified": False,
        "reboot_completion_proven": False,
        "persistent_worker_proof": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }


class SSMCaptureGuardTests(unittest.TestCase):
    def test_static_document_is_parameterless_fixed_transport(self):
        value = g.parse_local_document(DOC_SOURCE)
        self.assertEqual(value["parameters"], {})
        script = value["mainSteps"][0]["inputs"]["runCommand"][0]
        self.assertIn("169.254.169.254", script)
        self.assertNotIn("{{", script)
        self.assertNotIn("https://", script)
        self.assertIn('"provider_identity_verified":False', script)
        self.assertIn('"authority_effect":False', script)

    def test_boundary_is_exact_least_privilege_parameterless_nonauthority(self):
        value = boundary()
        self.assertFalse(value["document_mutation_allowed"])
        self.assertFalse(value["arbitrary_command_parameters_allowed"])
        self.assertFalse(value["start_session_allowed"])
        self.assertFalse(value["port_forwarding_allowed"])
        self.assertFalse(value["provider_identity_verified"])
        actions = []
        for statement in value["session_policy"]["Statement"]:
            action = statement["Action"]
            actions.extend(action if isinstance(action, list) else [action])
        self.assertEqual(
            set(actions),
            {
                "ssm:DescribeInstanceInformation",
                "ssm:DescribeDocument",
                "ssm:GetDocument",
                "ssm:SendCommand",
                "ssm:GetCommandInvocation",
            },
        )
        for forbidden in ("ssm:StartSession", "ssm:CreateDocument", "ssm:UpdateDocument", "ssm:DeleteDocument"):
            self.assertNotIn(forbidden, actions)
        self.assertEqual(
            value["document_arn"],
            "arn:aws:ssm:us-east-2:123456789012:document/Metaengine-W1-IID-Capture-H205F22",
        )
        self.assertEqual(value["repository_document_source_sha256"], REPO_DOC_SHA)

    def test_parameterized_or_interpolated_document_is_rejected(self):
        raw = json.loads(DOC_SOURCE)
        raw["parameters"] = {"commands": {"type": "StringList"}}
        with self.assertRaisesRegex(g.SSMCaptureError, "parameters_forbidden"):
            g.validate_local_document(raw)
        raw = json.loads(DOC_SOURCE)
        raw["mainSteps"][0]["inputs"]["runCommand"][0] += "\necho {{ commands }}"
        with self.assertRaisesRegex(g.SSMCaptureError, "forbidden_surface"):
            g.validate_local_document(raw)

    def test_managed_node_requires_exact_online_linux_ec2(self):
        raw = {"InstanceInformationList": [{
            "InstanceId": INSTANCE_ID,
            "PingStatus": "Online",
            "PlatformType": "Linux",
            "ResourceType": "EC2Instance",
            "AgentVersion": "3.3.1957.0",
            "LastPingDateTime": 1787472000.0,
        }]}
        result = g.validate_managed_node(raw, expected_instance_id=INSTANCE_ID)
        self.assertEqual(result["ping_status"], "Online")
        for field, bad in (("PingStatus", "ConnectionLost"), ("PlatformType", "Windows"), ("InstanceId", "i-0badbadbad")):
            tampered = copy.deepcopy(raw)
            tampered["InstanceInformationList"][0][field] = bad
            with self.assertRaises(g.SSMCaptureError):
                g.validate_managed_node(tampered, expected_instance_id=INSTANCE_ID)

    def test_remote_version1_document_must_match_repository_content_exactly(self):
        content = DOC_SOURCE.decode()
        description = {"Document": {
            "Name": g.DOCUMENT_NAME,
            "Owner": ACCOUNT_ID,
            "DocumentType": "Command",
            "Status": "Active",
            "DocumentVersion": "1",
            "HashType": "Sha256",
            "Hash": AWS_DOC_SHA,
            "PlatformTypes": ["Linux"],
        }}
        get_document = {
            "Name": g.DOCUMENT_NAME,
            "DocumentVersion": "1",
            "DocumentType": "Command",
            "Status": "Active",
            "Content": content,
        }
        result = g.validate_remote_document(
            description=description, get_document=get_document,
            account_id=ACCOUNT_ID, local_document_source=DOC_SOURCE
        )
        self.assertTrue(result["remote_content_matches_repository"])
        self.assertEqual(result["aws_document_sha256"], AWS_DOC_SHA)

        bad = copy.deepcopy(description)
        bad["Document"]["Owner"] = "Amazon"
        with self.assertRaisesRegex(g.SSMCaptureError, "owner_account_mismatch"):
            g.validate_remote_document(description=bad, get_document=get_document, account_id=ACCOUNT_ID, local_document_source=DOC_SOURCE)

        remote = json.loads(content)
        remote["description"] += " tampered"
        bad_get = copy.deepcopy(get_document)
        bad_get["Content"] = json.dumps(remote)
        with self.assertRaisesRegex(g.SSMCaptureError, "remote_document_content_mismatch"):
            g.validate_remote_document(description=description, get_document=bad_get, account_id=ACCOUNT_ID, local_document_source=DOC_SOURCE)

    def test_plan_has_zero_parameters_and_binds_both_document_hashes(self):
        value = plan()
        self.assertEqual(value["parameters"], {})
        self.assertFalse(value["arbitrary_command_parameters_allowed"])
        self.assertEqual(value["document_hash"], AWS_DOC_SHA)
        self.assertEqual(value["repository_document_source_sha256"], REPO_DOC_SHA)
        self.assertFalse(value["s3_output"])
        self.assertFalse(value["cloudwatch_output"])

    def test_send_response_rejects_any_parameter_or_foreign_instance(self):
        p = plan()
        raw = {"Command": {
            "CommandId": COMMAND_ID,
            "DocumentName": g.DOCUMENT_NAME,
            "DocumentVersion": g.DOCUMENT_VERSION,
            "InstanceIds": [INSTANCE_ID],
            "Parameters": {},
        }}
        self.assertEqual(g.validate_send_command_response(raw, plan=p), COMMAND_ID)
        tampered = copy.deepcopy(raw)
        tampered["Command"]["InstanceIds"] = ["i-0badbadbad"]
        with self.assertRaisesRegex(g.SSMCaptureError, "send_command_instance_mismatch"):
            g.validate_send_command_response(tampered, plan=p)
        tampered = copy.deepcopy(raw)
        tampered["Command"]["Parameters"] = {"commands": ["id"]}
        with self.assertRaisesRegex(g.SSMCaptureError, "parameters_forbidden"):
            g.validate_send_command_response(tampered, plan=p)

    def test_invocation_success_yields_only_untrusted_transport_receipt(self):
        raw = {
            "CommandId": COMMAND_ID,
            "InstanceId": INSTANCE_ID,
            "DocumentName": g.DOCUMENT_NAME,
            "DocumentVersion": g.DOCUMENT_VERSION,
            "Status": "Success",
            "ResponseCode": 0,
            "StandardErrorContent": "",
            "StandardOutputContent": json.dumps(envelope(), sort_keys=True, separators=(",", ":")) + "\n",
        }
        result = g.validate_invocation(
            raw, command_id=COMMAND_ID, instance_id=INSTANCE_ID,
            aws_document_sha256=AWS_DOC_SHA, repository_document_source_sha256=REPO_DOC_SHA
        )
        self.assertEqual(result["classification"], "W1_AWS_SSM_IID_CAPTURE_UNTRUSTED_TRANSPORT_RECEIPT")
        self.assertFalse(result["provider_identity_verified"])
        self.assertFalse(result["persistent_worker_proof"])
        self.assertEqual(result["required_next"], "OFFHOST_PINNED_AWS_IID_CRYPTOGRAPHIC_VERIFICATION")

        bad = copy.deepcopy(raw)
        bad["StandardErrorContent"] = "warning"
        with self.assertRaisesRegex(g.SSMCaptureError, "stderr_not_empty"):
            g.validate_invocation(bad, command_id=COMMAND_ID, instance_id=INSTANCE_ID, aws_document_sha256=AWS_DOC_SHA, repository_document_source_sha256=REPO_DOC_SHA)

        bad = copy.deepcopy(raw)
        hostile = envelope()
        hostile["provider_identity_verified"] = True
        bad["StandardOutputContent"] = json.dumps(hostile)
        with self.assertRaisesRegex(g.SSMCaptureError, "courier_rejected"):
            g.validate_invocation(bad, command_id=COMMAND_ID, instance_id=INSTANCE_ID, aws_document_sha256=AWS_DOC_SHA, repository_document_source_sha256=REPO_DOC_SHA)


if __name__ == "__main__":
    unittest.main()
