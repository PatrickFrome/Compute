from __future__ import annotations

import copy
import json
import unittest

from controller.w1 import aws_ssm_safety_send_semantics_guard as strict
from controller.w1 import build_host_safety_package as package_builder
from controller.w1 import w1_execution_marker_guard as guard


class ExecutionMarkerGuardTests(unittest.TestCase):
    worker_id = "w1-worker-01"
    instance_id = "i-0123456789abcdef0"
    package_sha = "a" * 64
    lock_sha = "b" * 64
    execution_payload_sha = "c" * 64
    provisioning_command_id = "11111111-1111-4111-8111-111111111111"
    execution_command_id = "22222222-2222-4222-8222-222222222222"
    marker_id = "33333333-3333-4333-8333-333333333333"
    callback_id = "44444444-4444-4444-8444-444444444444"

    def provisioning(self):
        return {
            "schema": strict.SCHEMA,
            "package_provisioning_verified": True,
            "strict_send_command_semantics_verified": True,
            "capture_executed": False,
            "host_safety_verified": False,
            "reboot_completion_proven": False,
            "persistent_worker_proof": False,
            "worker_admitted": False,
            "w1_verified": False,
            "database_mutation": False,
            "canonical": False,
            "authority_effect": False,
            "evidence": {
                "worker_id": self.worker_id,
                "instance_id": self.instance_id,
                "command_id": self.provisioning_command_id,
                "account_id": "123456789012",
                "region": "us-east-2",
                "package_sha256": self.package_sha,
                "payload_lock_sha256": self.lock_sha,
                "command_execution_started_at": "2026-08-28T00:00:00+00:00",
                "command_execution_ended_at": "2026-08-28T00:00:01+00:00",
            },
        }

    def marker(self):
        return {
            "schema": guard.MARKER_SCHEMA,
            "marker_id": self.marker_id,
            "worker_id": self.worker_id,
            "provider_kind": "AWS_EC2",
            "provider_instance_id": self.instance_id,
            "package_source_commit": package_builder.SOURCE_COMMIT,
            "package_sha256": self.package_sha,
            "payload_lock_sha256": self.lock_sha,
            "execution_payload_sha256": self.execution_payload_sha,
            "observed_at": "2026-08-28T00:00:03+00:00",
            "host_safety_verified": False,
            "persistent_worker_proof": False,
            "worker_admitted": False,
            "w1_verified": False,
            "canonical": False,
            "authority_effect": False,
        }

    def invocation(self, marker=None):
        marker = marker or self.marker()
        return {
            "CommandId": self.execution_command_id,
            "InstanceId": self.instance_id,
            "DocumentName": guard.EXECUTION_DOCUMENT_NAME,
            "DocumentVersion": guard.EXECUTION_DOCUMENT_VERSION,
            "PluginName": guard.EXECUTION_PLUGIN_NAME,
            "Status": "Success",
            "StatusDetails": "Success",
            "ResponseCode": 0,
            "ExecutionStartDateTime": "2026-08-28T00:00:02+00:00",
            "ExecutionEndDateTime": "2026-08-28T00:00:04+00:00",
            "StandardOutputContent": guard.MARKER_PREFIX + json.dumps(marker, sort_keys=True, separators=(",", ":")) + "\n",
            "StandardOutputUrl": "",
            "StandardErrorContent": "",
            "StandardErrorUrl": "",
            "CloudWatchOutputConfig": {"CloudWatchOutputEnabled": False, "CloudWatchLogGroupName": ""},
        }

    def callback(self, marker=None):
        marker = marker or self.marker()
        return {
            "schema": guard.CALLBACK_SCHEMA,
            "callback_receipt_id": self.callback_id,
            "accepted": True,
            "auth_kind": "WORKER_ENROLLMENT_SIGNATURE_V1",
            "auth_verified": True,
            "marker_id": marker["marker_id"],
            "worker_id": marker["worker_id"],
            "provider_kind": "AWS_EC2",
            "provider_instance_id": marker["provider_instance_id"],
            "execution_payload_sha256": marker["execution_payload_sha256"],
            "package_sha256": marker["package_sha256"],
            "payload_lock_sha256": marker["payload_lock_sha256"],
            "marker_body_sha256": guard._sha(marker),
            "received_at": "2026-08-28T00:00:04.500000+00:00",
            "database_persistence_verified": False,
            "persistent_worker_proof": False,
            "worker_admitted": False,
            "w1_verified": False,
            "canonical": False,
            "authority_effect": False,
        }

    def compose(self, provisioning=None, invocation=None, callback=None):
        return guard.compose_execution_correlation(
            provisioning_provenance=provisioning or self.provisioning(),
            execution_invocation=invocation or self.invocation(),
            callback_attestation=callback or self.callback(),
            worker_id=self.worker_id,
            instance_id=self.instance_id,
            expected_execution_payload_sha256=self.execution_payload_sha,
        )

    def test_exact_three_way_correlation_yields_uningested_candidate_only(self):
        result = self.compose()
        self.assertTrue(result["ssm_execution_observed"])
        self.assertTrue(result["execution_marker_correlated"])
        self.assertTrue(result["callback_attestation_verified"])
        self.assertTrue(result["live_execution_evidence_candidate"])
        for key in ("database_persistence_verified", "host_safety_verified", "reboot_completion_proven",
                    "persistent_worker_proof", "worker_admitted", "w1_verified", "canonical", "authority_effect"):
            self.assertIs(result[key], False, key)
        self.assertEqual(self.execution_command_id, result["evidence"]["execution_command_id"])
        self.assertEqual(self.provisioning_command_id, result["evidence"]["provisioning_command_id"])

    def test_provider_invocation_identity_is_exact_tuple_hash_not_invented_invocation_id(self):
        invocation = self.invocation()
        invocation["InvocationId"] = "not-an-aws-get-command-invocation-field"
        result = self.compose(invocation=invocation)
        expected = guard._sha({"command_id": self.execution_command_id,
                               "instance_id": self.instance_id,
                               "plugin_name": guard.EXECUTION_PLUGIN_NAME})
        self.assertEqual(expected, result["evidence"]["invocation_key_sha256"])
        self.assertNotIn("invocation_id", result["evidence"])

    def test_callback_must_attest_exact_marker_body_and_verified_auth(self):
        callback = self.callback()
        callback["marker_body_sha256"] = "d" * 64
        with self.assertRaisesRegex(guard.ExecutionMarkerError, "callback_marker_body_hash_mismatch"):
            self.compose(callback=callback)
        callback = self.callback()
        callback["auth_verified"] = False
        with self.assertRaisesRegex(guard.ExecutionMarkerError, "callback_auth_not_verified"):
            self.compose(callback=callback)

    def test_marker_authority_escalation_is_rejected(self):
        marker = self.marker()
        marker["w1_verified"] = True
        with self.assertRaisesRegex(guard.ExecutionMarkerError, "marker_nonclaim_invalid:w1_verified"):
            self.compose(invocation=self.invocation(marker), callback=self.callback(marker))

    def test_extra_stdout_or_output_side_channels_are_rejected(self):
        invocation = self.invocation()
        invocation["StandardOutputContent"] += "unexpected\n"
        with self.assertRaisesRegex(guard.ExecutionMarkerError, "single_line"):
            self.compose(invocation=invocation)
        invocation = self.invocation()
        invocation["StandardOutputUrl"] = "https://example.invalid/output"
        with self.assertRaisesRegex(guard.ExecutionMarkerError, "output_url_forbidden"):
            self.compose(invocation=invocation)

    def test_execution_payload_and_installed_package_must_cross_bind(self):
        marker = self.marker()
        marker["execution_payload_sha256"] = "e" * 64
        with self.assertRaisesRegex(guard.ExecutionMarkerError, "execution_payload_sha256_mismatch"):
            self.compose(invocation=self.invocation(marker), callback=self.callback(marker))
        marker = self.marker()
        marker["package_sha256"] = "f" * 64
        with self.assertRaisesRegex(guard.ExecutionMarkerError, "marker_package_provisioning_mismatch"):
            self.compose(invocation=self.invocation(marker), callback=self.callback(marker))

    def test_execution_must_follow_provisioning_and_callback_must_be_near_execution(self):
        provisioning = self.provisioning()
        provisioning["evidence"]["command_execution_ended_at"] = "2026-08-28T00:10:00+00:00"
        with self.assertRaisesRegex(guard.ExecutionMarkerError, "execution_precedes_package"):
            self.compose(provisioning=provisioning)
        callback = self.callback()
        callback["received_at"] = "2026-08-28T00:10:00+00:00"
        with self.assertRaisesRegex(guard.ExecutionMarkerError, "callback_too_late"):
            self.compose(callback=callback)

    def test_provisioning_cannot_claim_downstream_authority(self):
        provisioning = self.provisioning()
        provisioning["persistent_worker_proof"] = True
        with self.assertRaisesRegex(guard.ExecutionMarkerError, "provisioning_nonclaim_invalid:persistent_worker_proof"):
            self.compose(provisioning=provisioning)

    def test_result_is_deterministic(self):
        self.assertEqual(self.compose(), self.compose())


if __name__ == "__main__":
    unittest.main()
