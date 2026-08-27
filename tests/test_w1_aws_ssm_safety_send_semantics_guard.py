from __future__ import annotations

import copy
import unittest

from controller.w1 import aws_ssm_safety_provision_guard as transport_guard
from controller.w1 import aws_ssm_safety_send_semantics_guard as strict
from tests import test_w1_aws_ssm_safety_provision_provenance as fx


def strict_send_response() -> dict:
    return {
        "Command": {
            "CommandId": fx.COMMAND_ID,
            "DocumentName": transport_guard.DOCUMENT_NAME,
            "DocumentVersion": "1",
            "InstanceIds": [fx.INSTANCE_ID],
            "Parameters": {},
            "TimeoutSeconds": strict.EXPECTED_TIMEOUT_SECONDS,
            "Targets": [],
            "OutputS3BucketName": "",
            "OutputS3KeyPrefix": "",
            "OutputS3Region": "",
            "ServiceRole": "",
            "Comment": "",
            "NotificationConfig": {},
            "CloudWatchOutputConfig": {"CloudWatchOutputEnabled": False, "CloudWatchLogGroupName": ""},
            "AlarmConfiguration": {},
            "TriggeredAlarms": [],
            "MaxErrors": "0",
            "MaxConcurrency": "50",
        }
    }


class StrictSendResponseTests(unittest.TestCase):
    def test_exact_reviewed_semantics_pass_non_authoritatively(self):
        plan = transport_guard.build_command_plan(instance_id=fx.INSTANCE_ID, aws_document_sha256="a" * 64)
        result = strict.validate_send_command_response_strict(strict_send_response(), plan=plan)
        self.assertEqual(fx.COMMAND_ID, result["evidence"]["command_id"])
        self.assertEqual(120, result["evidence"]["timeout_seconds"])
        self.assertFalse(result["package_provisioning_verified"])
        self.assertFalse(result["host_safety_verified"])
        self.assertFalse(result["persistent_worker_proof"])
        self.assertFalse(result["w1_verified"])
        self.assertFalse(result["canonical"])
        self.assertFalse(result["authority_effect"])

    def test_timeout_and_all_side_channels_fail_closed(self):
        mutations = {
            "timeout": ("TimeoutSeconds", 121),
            "targets": ("Targets", [{"Key": "tag:Name", "Values": ["other"]}]),
            "s3": ("OutputS3BucketName", "bucket"),
            "service_role": ("ServiceRole", "arn:aws:iam::123456789012:role/notify"),
            "comment": ("Comment", "different semantics"),
            "notification": ("NotificationConfig", {"NotificationArn": "arn:aws:sns:us-east-2:123456789012:x"}),
            "cloudwatch": ("CloudWatchOutputConfig", {"CloudWatchOutputEnabled": True}),
            "alarm": ("AlarmConfiguration", {"Alarms": [{"Name": "x"}]}),
            "max_errors": ("MaxErrors", "1"),
            "max_concurrency": ("MaxConcurrency", "1"),
        }
        plan = transport_guard.build_command_plan(instance_id=fx.INSTANCE_ID, aws_document_sha256="a" * 64)
        for name, (key, value) in mutations.items():
            with self.subTest(name=name):
                candidate = strict_send_response()
                candidate["Command"][key] = value
                with self.assertRaises(strict.StrictSemanticsError):
                    strict.validate_send_command_response_strict(candidate, plan=plan)


class StrictCloudTrailTests(unittest.TestCase):
    def select(self, lookup: dict) -> dict:
        return strict.select_strict_send_command_event(
            lookup,
            instance_id=fx.INSTANCE_ID,
            account_id=fx.ACCOUNT_ID,
            region=fx.REGION,
            provisioner_role_arn=fx.PROVISIONER_ROLE_ARN,
            role_session=fx.ROLE_SESSION,
            requested_at=fx.REQUESTED_AT,
            api_returned_at=fx.RETURNED_AT,
            aws_document_sha256="a" * 64,
        )

    def test_exact_management_event_passes(self):
        result = self.select(fx.cloudtrail_lookup())
        self.assertEqual(fx.COMMAND_ID, result["summary"]["command_id"])
        self.assertEqual(120, result["summary"]["timeout_seconds"])
        self.assertFalse(result["summary"]["s3_output"])
        self.assertFalse(result["summary"]["cloudwatch_output"])

    def test_no_event_is_explicitly_retryable(self):
        with self.assertRaises(strict.CloudTrailEventNotYetVisible):
            self.select({"Events": []})

    def test_duplicate_exact_events_are_fatal(self):
        event = fx.cloudtrail_lookup()["Events"][0]
        with self.assertRaisesRegex(strict.StrictSemanticsError, "duplicate_matching_send_command_events"):
            self.select({"Events": [copy.deepcopy(event), copy.deepcopy(event)]})

    def test_timeout_and_output_side_channels_do_not_match(self):
        mutations = []
        raw = fx.cloudtrail_raw()
        bad = copy.deepcopy(raw)
        bad["requestParameters"]["timeoutSeconds"] = 121
        mutations.append(bad)
        bad = copy.deepcopy(raw)
        bad["requestParameters"]["targets"] = [{"Key": "tag:Name", "Values": ["x"]}]
        mutations.append(bad)
        bad = copy.deepcopy(raw)
        bad["requestParameters"]["outputS3BucketName"] = "bucket"
        mutations.append(bad)
        bad = copy.deepcopy(raw)
        bad["requestParameters"]["cloudWatchOutputConfig"] = {"cloudWatchOutputEnabled": True}
        mutations.append(bad)
        bad = copy.deepcopy(raw)
        bad["requestParameters"]["notificationConfig"] = {"notificationArn": "arn:aws:sns:us-east-2:123456789012:x"}
        mutations.append(bad)
        for candidate in mutations:
            with self.subTest(request=candidate["requestParameters"]):
                with self.assertRaises(strict.CloudTrailEventNotYetVisible):
                    self.select(fx.cloudtrail_lookup(candidate))

    def test_non_management_readonly_or_failed_events_do_not_match(self):
        for field, value in (("eventCategory", "Data"), ("eventType", "AwsServiceEvent"), ("readOnly", True), ("errorCode", "AccessDenied")):
            raw = fx.cloudtrail_raw()
            raw[field] = value
            with self.subTest(field=field):
                with self.assertRaises(strict.CloudTrailEventNotYetVisible):
                    self.select(fx.cloudtrail_lookup(raw))


class StrictCompositionTests(unittest.TestCase):
    def test_full_composition_elevates_only_provisioning(self):
        description, get_document = fx.document_responses()
        result = strict.compose_strict_provisioning_provenance(
            cloudtrail_lookup=fx.cloudtrail_lookup(),
            instance_id=fx.INSTANCE_ID,
            worker_id=fx.WORKER_ID,
            account_id=fx.ACCOUNT_ID,
            region=fx.REGION,
            provisioner_role_arn=fx.PROVISIONER_ROLE_ARN,
            role_session=fx.ROLE_SESSION,
            requested_at=fx.REQUESTED_AT,
            api_returned_at=fx.RETURNED_AT,
            verifier_caller_identity=fx.verifier_caller(),
            preflight_bundle=fx.preflight_bundle(),
            managed_node_response=fx.managed_node_response(),
            document_description=description,
            get_document_response=get_document,
            command_invocation=fx.command_invocation(),
            verified_iid=fx.verified_iid(),
        )
        self.assertEqual(strict.SCHEMA, result["schema"])
        self.assertTrue(result["strict_send_command_semantics_verified"])
        self.assertTrue(result["package_provisioning_verified"])
        self.assertTrue(result["provider_api_mutation_observed"])
        self.assertFalse(result["capture_executed"])
        self.assertFalse(result["host_safety_verified"])
        self.assertFalse(result["reboot_completion_proven"])
        self.assertFalse(result["persistent_worker_proof"])
        self.assertFalse(result["worker_admitted"])
        self.assertFalse(result["w1_verified"])
        self.assertFalse(result["database_mutation"])
        self.assertFalse(result["canonical"])
        self.assertFalse(result["authority_effect"])
        self.assertEqual(result["evidence_sha256"], strict._sha(result["evidence"]))


if __name__ == "__main__":
    unittest.main()
