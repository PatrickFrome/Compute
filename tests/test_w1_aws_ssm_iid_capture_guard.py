from __future__ import annotations

import copy
import json
import unittest

from controller.w1 import aws_ssm_iid_capture_guard as g
from worker.native_linux import aws_iid_courier as courier

INSTANCE_ID = "i-0123456789abcdef0"
WORKER_ID = "glm-sandbox-worker-01"
W1_SHA = "a" * 40
ACCOUNT_ID = "123456789012"
REGION = "us-east-2"
DOC_SHA = "b" * 64
COMMAND_ID = "11111111-2222-3333-4444-555555555555"
SOURCE = b"#!/usr/bin/env python3\nprint('courier fixture')\n"


def boundary():
    return g.build_session_boundary(
        instance_id=INSTANCE_ID,
        worker_id=WORKER_ID,
        w1_sha=W1_SHA,
        account_id=ACCOUNT_ID,
        region=REGION,
        document_sha256=DOC_SHA,
    )


def plan():
    return g.build_command_plan(
        instance_id=INSTANCE_ID,
        document_sha256=DOC_SHA,
        courier_source=SOURCE,
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
    def test_boundary_is_exact_least_privilege_nonauthority(self):
        value = boundary()
        self.assertFalse(value["ssh_allowed"])
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
        self.assertNotIn("ssm:StartSession", actions)
        send_instance = next(x for x in value["session_policy"]["Statement"] if x["Sid"] == "SendOnlyExactTaggedW1Instance")
        self.assertEqual(send_instance["Resource"], value["instance_arn"])
        self.assertEqual(len(send_instance["Condition"]["StringEquals"]), 6)
        self.assertEqual(value["document_arn"], "arn:aws:ssm:us-east-2::document/AWS-RunShellScript")

    def test_boundary_rejects_unpinned_document_hash_shape(self):
        with self.assertRaisesRegex(g.SSMCaptureError, "document_sha256_invalid"):
            g.build_session_boundary(
                instance_id=INSTANCE_ID, worker_id=WORKER_ID, w1_sha=W1_SHA,
                account_id=ACCOUNT_ID, region=REGION, document_sha256="not-a-hash"
            )

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

    def test_document_must_be_amazon_active_version1_and_exact_hash(self):
        raw = {"Document": {
            "Name": g.DOCUMENT_NAME,
            "Owner": "Amazon",
            "DocumentType": "Command",
            "Status": "Active",
            "DefaultVersion": "1",
            "HashType": "Sha256",
            "Hash": DOC_SHA,
            "PlatformTypes": ["Linux"],
        }}
        self.assertEqual(g.validate_document_description(raw, expected_sha256=DOC_SHA)["owner"], "Amazon")
        for field, bad in (("Owner", ACCOUNT_ID), ("DefaultVersion", "2"), ("Hash", "c" * 64)):
            tampered = copy.deepcopy(raw)
            tampered["Document"][field] = bad
            with self.assertRaises(g.SSMCaptureError):
                g.validate_document_description(tampered, expected_sha256=DOC_SHA)

    def test_plan_embeds_exact_courier_bytes_and_no_secret_output_channel(self):
        value = plan()
        self.assertEqual(value["courier_source_sha256"], g._sha_bytes(SOURCE))
        self.assertFalse(value["contains_secrets"])
        self.assertFalse(value["s3_output"])
        self.assertFalse(value["cloudwatch_output"])
        command = value["parameters"]["commands"][0]
        encoded = command.split("printf '%s' '", 1)[1].split("' | base64", 1)[0]
        import base64
        self.assertEqual(base64.b64decode(encoded), SOURCE)
        self.assertIn("sha256sum -c - >/dev/null", command)
        self.assertIn("cat \"$TMPDIR_W1/envelope.json\"", command)

    def test_send_response_must_echo_exact_plan_identity_and_parameters(self):
        p = plan()
        raw = {"Command": {
            "CommandId": COMMAND_ID,
            "DocumentName": g.DOCUMENT_NAME,
            "DocumentVersion": g.DOCUMENT_VERSION,
            "InstanceIds": [INSTANCE_ID],
            "Parameters": p["parameters"],
        }}
        self.assertEqual(g.validate_send_command_response(raw, plan=p), COMMAND_ID)
        tampered = copy.deepcopy(raw)
        tampered["Command"]["InstanceIds"] = ["i-0badbadbad"]
        with self.assertRaisesRegex(g.SSMCaptureError, "send_command_instance_mismatch"):
            g.validate_send_command_response(tampered, plan=p)
        tampered = copy.deepcopy(raw)
        tampered["Command"]["Parameters"]["commands"] = ["id"]
        with self.assertRaisesRegex(g.SSMCaptureError, "send_command_parameters_mismatch"):
            g.validate_send_command_response(tampered, plan=p)

    def test_invocation_success_yields_only_untrusted_transport_receipt(self):
        p = plan()
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
            document_sha256=DOC_SHA, courier_source_sha256=p["courier_source_sha256"]
        )
        self.assertEqual(result["classification"], "W1_AWS_SSM_IID_CAPTURE_UNTRUSTED_TRANSPORT_RECEIPT")
        self.assertFalse(result["provider_identity_verified"])
        self.assertFalse(result["persistent_worker_proof"])
        self.assertEqual(result["required_next"], "OFFHOST_PINNED_AWS_IID_CRYPTOGRAPHIC_VERIFICATION")

        bad = copy.deepcopy(raw)
        bad["StandardErrorContent"] = "warning"
        with self.assertRaisesRegex(g.SSMCaptureError, "stderr_not_empty"):
            g.validate_invocation(bad, command_id=COMMAND_ID, instance_id=INSTANCE_ID, document_sha256=DOC_SHA, courier_source_sha256=p["courier_source_sha256"])

        bad = copy.deepcopy(raw)
        hostile = envelope()
        hostile["provider_identity_verified"] = True
        bad["StandardOutputContent"] = json.dumps(hostile)
        with self.assertRaisesRegex(g.SSMCaptureError, "courier_rejected"):
            g.validate_invocation(bad, command_id=COMMAND_ID, instance_id=INSTANCE_ID, document_sha256=DOC_SHA, courier_source_sha256=p["courier_source_sha256"])


if __name__ == "__main__":
    unittest.main()
