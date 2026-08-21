import importlib.util
import json
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).parents[1] / "controller" / "w1" / "aws_provider_reboot_controller.py"
spec = importlib.util.spec_from_file_location("w1_aws_provider_reboot_controller", MODULE_PATH)
mod = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(mod)


INSTANCE_ID = "i-0123456789abcdef0"
WORKER_ID = "w1-aws-001"
SHA = "a" * 40
SESSION = "w1-123456789-1"
REQUESTED = "2026-08-21T13:00:00+00:00"


def valid_bundle():
    return {
        "instance": {
            "InstanceId": INSTANCE_ID,
            "State": {"Name": "running"},
            "Placement": {"AvailabilityZone": "us-east-2a"},
            "InstanceType": "t3.small",
            "ImageId": "ami-0123abcd",
            "PrivateIpAddress": "10.0.1.20",
            "MetadataOptions": {
                "HttpTokens": "required",
                "HttpPutResponseHopLimit": 1,
                "HttpEndpoint": "enabled",
            },
            "SecurityGroups": [{"GroupId": "sg-0123abcd"}],
            "Tags": [
                {"Key": "metaengine:project", "Value": "H205F22"},
                {"Key": "metaengine:milestone", "Value": "W1_PERSISTENT_LINUX_WORKER_SAFETY"},
                {"Key": "metaengine:worker_id", "Value": WORKER_ID},
                {"Key": "metaengine:github_sha", "Value": SHA},
                {"Key": "metaengine:authority", "Value": "noncanonical-worker"},
                {"Key": "metaengine:execution_tier", "Value": "persistent-host"},
            ],
        },
        "security_groups": [{"GroupId": "sg-0123abcd", "IpPermissions": []}],
        "root_volume": {"VolumeId": "vol-0123abcd", "Encrypted": True, "VolumeType": "gp3"},
    }


def cloudtrail_lookup(instance_id=INSTANCE_ID, session=SESSION):
    raw = {
        "eventVersion": "1.11",
        "eventTime": "2026-08-21T13:00:02Z",
        "eventSource": "ec2.amazonaws.com",
        "eventName": "RebootInstances",
        "awsRegion": "us-east-2",
        "eventID": "11111111-2222-3333-4444-555555555555",
        "userIdentity": {
            "type": "AssumedRole",
            "arn": f"arn:aws:sts::123456789012:assumed-role/metaengine-w1-controller/{session}",
            "principalId": f"AROATEST:{session}",
        },
        "requestParameters": {"instancesSet": {"items": [{"instanceId": instance_id}]}},
    }
    return {
        "Events": [
            {
                "EventId": raw["eventID"],
                "EventName": "RebootInstances",
                "EventTime": raw["eventTime"],
                "CloudTrailEvent": json.dumps(raw),
            }
        ]
    }


class ControllerTests(unittest.TestCase):
    def test_valid_preflight(self):
        result = mod.validate_preflight_bundle(
            valid_bundle(), instance_id=INSTANCE_ID, worker_id=WORKER_ID, expected_worker_sha=SHA
        )
        self.assertEqual(result["instance_id"], INSTANCE_ID)
        self.assertTrue(result["root_volume_encrypted"])
        self.assertFalse(result["authority_effect"])

    def test_ingress_is_rejected(self):
        bundle = valid_bundle()
        bundle["security_groups"][0]["IpPermissions"] = [{"IpProtocol": "tcp"}]
        with self.assertRaisesRegex(mod.EvidenceError, "ingress_forbidden"):
            mod.validate_preflight_bundle(
                bundle, instance_id=INSTANCE_ID, worker_id=WORKER_ID, expected_worker_sha=SHA
            )

    def test_wrong_worker_sha_is_rejected(self):
        with self.assertRaisesRegex(mod.EvidenceError, "instance_tag_mismatch:metaengine:github_sha"):
            mod.validate_preflight_bundle(
                valid_bundle(), instance_id=INSTANCE_ID, worker_id=WORKER_ID, expected_worker_sha="b" * 40
            )

    def test_cloudtrail_event_is_bound_to_instance_and_session(self):
        selected = mod.select_reboot_event(
            cloudtrail_lookup(), instance_id=INSTANCE_ID, role_session=SESSION, requested_at=REQUESTED
        )
        self.assertEqual(selected["cloudtrail_event"]["eventID"], "11111111-2222-3333-4444-555555555555")

    def test_unrelated_instance_is_rejected(self):
        with self.assertRaisesRegex(mod.EvidenceError, "matching_reboot_event_not_found"):
            mod.select_reboot_event(
                cloudtrail_lookup(instance_id="i-0deadbeef"),
                instance_id=INSTANCE_ID,
                role_session=SESSION,
                requested_at=REQUESTED,
            )

    def test_unrelated_session_is_rejected(self):
        with self.assertRaisesRegex(mod.EvidenceError, "matching_reboot_event_not_found"):
            mod.select_reboot_event(
                cloudtrail_lookup(session="other-session"),
                instance_id=INSTANCE_ID,
                role_session=SESSION,
                requested_at=REQUESTED,
            )

    def test_receipt_is_non_authoritative(self):
        preflight = mod.validate_preflight_bundle(
            valid_bundle(), instance_id=INSTANCE_ID, worker_id=WORKER_ID, expected_worker_sha=SHA
        )
        selected = mod.select_reboot_event(
            cloudtrail_lookup(), instance_id=INSTANCE_ID, role_session=SESSION, requested_at=REQUESTED
        )
        receipt = mod.build_reboot_receipt(
            preflight=preflight,
            selected_event=selected,
            caller_identity={"Account": "123456789012", "Arn": f"arn:aws:sts::123456789012:assumed-role/x/{SESSION}"},
            requested_at=REQUESTED,
            api_returned_at="2026-08-21T13:00:01+00:00",
            github_run_id="123456789",
            github_run_attempt="1",
            role_session=SESSION,
        )
        self.assertEqual(receipt["classification"], "LIVE_PROVIDER_CONTROLLER_RECEIPT_UNINGESTED")
        self.assertEqual(receipt["provider_instance_id"], INSTANCE_ID)
        self.assertFalse(receipt["persistent_worker_proof"])
        self.assertFalse(receipt["w1_verified"])
        self.assertRegex(receipt["evidence_artifact_sha256"], r"^[0-9a-f]{64}$")


if __name__ == "__main__":
    unittest.main()
