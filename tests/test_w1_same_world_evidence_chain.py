from __future__ import annotations

import copy
import unittest

from controller.w1 import w1_same_world_evidence_chain as g
from controller.w1 import aws_ssm_safety_capture_guard as capture_guard
from controller.w1 import aws_ssm_safety_provision_provenance as provision_provenance
from controller.w1 import build_host_safety_package as package_builder


class SameWorldEvidenceChainTests(unittest.TestCase):
    def setUp(self) -> None:
        self.anchor = g.build_world_anchor(
            source_sha="a" * 40,
            source_tree="b" * 40,
            instance_id="i-0123456789abcdef0",
            worker_id="w1-worker-01",
            account_id="123456789012",
            region="us-east-2",
        )
        self.provision = self._provision()
        self.pre = self._capture(
            command_id="11111111-1111-1111-1111-111111111111",
            bundle_sha="1" * 64,
        )
        self.reboot = self._reboot()
        self.post = self._capture(
            command_id="22222222-2222-2222-2222-222222222222",
            bundle_sha="2" * 64,
        )
        self.links = self._links()

    @staticmethod
    def _sha(value):
        return g._sha(value)

    def _provision(self):
        evidence = {
            "provider_kind": "AWS_EC2",
            "instance_id": self.anchor["instance_id"],
            "worker_id": self.anchor["worker_id"],
            "account_id": self.anchor["account_id"],
            "region": self.anchor["region"],
            "verifier_caller": {
                "account_id": self.anchor["account_id"],
                "arn": "arn:aws:sts::123456789012:assumed-role/W1Verifier/session",
                "user_id": "AROATEST:session",
            },
            "provisioner_role_arn": "arn:aws:iam::123456789012:role/W1Provisioner",
            "provisioner_role_session": "w1-prov-100-1",
            "cloudtrail": {
                "event_id": "event-1",
                "event_time": "2026-08-28T16:00:00+00:00",
                "command_id": "33333333-3333-3333-3333-333333333333",
                "provisioner_role_arn": "arn:aws:iam::123456789012:role/W1Provisioner",
                "role_session": "w1-prov-100-1",
                "request_parameters_sha256": "3" * 64,
                "cloudtrail_event_sha256": "4" * 64,
            },
            "preflight_sha256": "5" * 64,
            "managed_node_sha256": "6" * 64,
            "signed_iid_receipt_sha256": "7" * 64,
            "signed_iid_document_sha256": "8" * 64,
            "aws_document_sha256": "9" * 64,
            "repository_generated_document_sha256": "a" * 64,
            "package_sha256": g.EXPECTED_PACKAGE_SHA256,
            "payload_lock_sha256": "b" * 64,
            "command_id": "33333333-3333-3333-3333-333333333333",
            "command_execution_started_at": "2026-08-28T16:00:01+00:00",
            "command_execution_ended_at": "2026-08-28T16:00:02+00:00",
            "transport_evidence_sha256": "c" * 64,
        }
        return {
            "schema": provision_provenance.PROVENANCE_SCHEMA,
            "classification": provision_provenance.CLASSIFICATION,
            "evidence": evidence,
            "evidence_sha256": self._sha(evidence),
            "independent_readonly_verifier_required": True,
            "cloudtrail_send_command_verified": True,
            "signed_provider_identity_verified": True,
            "provider_host_binding_verified": True,
            "managed_node_binding_verified": True,
            "remote_document_identity_verified": True,
            "command_invocation_verified": True,
            "package_install_observed": True,
            "package_provisioning_verified": True,
            "provider_api_mutation_observed": True,
            "host_filesystem_mutation_observed": True,
            "capture_executed": False,
            "host_safety_verified": False,
            "reboot_completion_proven": False,
            "persistent_worker_proof": False,
            "worker_admitted": False,
            "w1_verified": False,
            "database_mutation": False,
            "canonical": False,
            "authority_effect": False,
        }

    def _capture(self, *, command_id: str, bundle_sha: str):
        evidence = {
            "command_id": command_id,
            "instance_id": self.anchor["instance_id"],
            "document_name": capture_guard.DOCUMENT_NAME,
            "document_version": capture_guard.DOCUMENT_VERSION,
            "package_source_commit_sha": package_builder.SOURCE_COMMIT,
            "package_source_tree_sha": package_builder.SOURCE_TREE,
            "package_manifest_sha256": package_builder.STATIC_MANIFEST_SHA256,
            "bundle_transport_sha256": bundle_sha,
            "safety_outcome": "SAFETY_ENVELOPE_ELIGIBLE_NON_PERSISTENT",
            "safety_eligible": True,
            "offhost_decision_recomputed": True,
            "aws_api_response_provenance_verified": False,
        }
        return {
            "schema": capture_guard.CAPTURE_SCHEMA,
            "classification": "W1_AWS_SSM_SAFETY_CAPTURE_VALIDATED_NONAUTHORITY",
            "evidence": evidence,
            "evidence_sha256": self._sha(evidence),
            "capture_transport_validated": True,
            "host_safety_eligible_observed": True,
            "host_safety_verified": False,
            "provider_identity_verified": False,
            "reboot_completion_proven": False,
            "persistent_worker_proof": False,
            "w1_verified": False,
            "canonical": False,
            "authority_effect": False,
        }

    def _reboot(self):
        preflight = {
            "schema": "metaengine.compute.w1-aws-preflight.h205f22.v1",
            "instance_id": self.anchor["instance_id"],
            "worker_id": self.anchor["worker_id"],
            "worker_bundle_github_sha": package_builder.SOURCE_COMMIT,
            "state": "running",
            "availability_zone": "us-east-2a",
            "instance_type": "t3.small",
            "image_id": "ami-0123456789abcdef0",
            "private_ip": "10.0.0.10",
            "public_ip_present": False,
            "security_group_ids": ["sg-0123456789abcdef0"],
            "root_volume_id": "vol-0123456789abcdef0",
            "root_volume_encrypted": True,
            "root_volume_type": "gp3",
            "imdsv2_required": True,
            "imds_hop_limit": 1,
            "authority_effect": False,
            "canonical": False,
        }
        evidence = {
            "schema": "metaengine.compute.w1-aws-provider-evidence.h205f22.v1",
            "provider_action_semantics": "ASYNC_REBOOT_REQUEST_ACCEPTED",
            "schema_completed_at_semantics": "CLOUDTRAIL_PROVIDER_REQUEST_EVENT_TIME",
            "github": {
                "run_id": "200",
                "run_attempt": "1",
                "role_session": "w1-reboot-200-1",
            },
            "caller_identity": {
                "UserId": "AROATEST:w1-reboot-200-1",
                "Account": self.anchor["account_id"],
                "Arn": "arn:aws:sts::123456789012:assumed-role/W1Reboot/w1-reboot-200-1",
            },
            "preflight": preflight,
            "cloudtrail": {
                "lookup_event": {"EventId": "reboot-event-1"},
                "cloudtrail_event": {
                    "eventID": "reboot-event-1",
                    "eventTime": "2026-08-28T16:10:01Z",
                    "eventName": "RebootInstances",
                    "eventSource": "ec2.amazonaws.com",
                },
            },
            "api_returned_at": "2026-08-28T16:10:00Z",
        }
        return {
            "schema": "metaengine.compute.w1-provider-reboot-receipt-candidate.h205f22.v1",
            "classification": "LIVE_PROVIDER_CONTROLLER_RECEIPT_UNINGESTED",
            "worker_id": self.anchor["worker_id"],
            "provider_kind": "AWS_EC2",
            "provider_instance_id": self.anchor["instance_id"],
            "action_kind": "REBOOT",
            "action_id": "reboot-event-1",
            "requested_at": "2026-08-28T16:09:59Z",
            "completed_at": "2026-08-28T16:10:01Z",
            "completed_at_semantics": "PROVIDER_REQUEST_ACCEPTED_AT_NOT_REBOOT_COMPLETION",
            "identity_attestation_kind": "PROVIDER_METADATA",
            "identity_attestation_verified": False,
            "evidence": evidence,
            "evidence_artifact_sha256": self._sha(evidence),
            "canonical": False,
            "authority_effect": False,
            "persistent_worker_proof": False,
            "w1_verified": False,
        }

    def _links(self):
        provision = g.build_stage_link(
            world_anchor=self.anchor,
            stage="PROVISION",
            receipt=self.provision,
            workflow_path=g.ALLOWED_WORKFLOWS["PROVISION"],
            run_id="100",
            run_attempt="1",
        )
        pre = g.build_stage_link(
            world_anchor=self.anchor,
            stage="PRE_REBOOT_SAFETY_CAPTURE",
            receipt=self.pre,
            workflow_path=g.ALLOWED_WORKFLOWS["PRE_REBOOT_SAFETY_CAPTURE"],
            run_id="110",
            run_attempt="1",
            previous_link=provision,
            previous_receipt=self.provision,
        )
        reboot = g.build_stage_link(
            world_anchor=self.anchor,
            stage="REBOOT_REQUEST",
            receipt=self.reboot,
            workflow_path=g.ALLOWED_WORKFLOWS["REBOOT_REQUEST"],
            run_id="200",
            run_attempt="1",
            previous_link=pre,
            previous_receipt=self.pre,
        )
        post = g.build_stage_link(
            world_anchor=self.anchor,
            stage="POST_REBOOT_SAFETY_CAPTURE",
            receipt=self.post,
            workflow_path=g.ALLOWED_WORKFLOWS["POST_REBOOT_SAFETY_CAPTURE"],
            run_id="210",
            run_attempt="1",
            previous_link=reboot,
            previous_receipt=self.reboot,
        )
        return provision, pre, reboot, post

    def _compose(self):
        p, pre, r, post = self.links
        return g.compose_same_world_chain(
            world_anchor=self.anchor,
            provision_receipt=self.provision,
            provision_link=p,
            pre_capture_receipt=self.pre,
            pre_capture_link=pre,
            reboot_receipt=self.reboot,
            reboot_link=r,
            post_capture_receipt=self.post,
            post_capture_link=post,
        )

    def test_happy_path_is_linkage_only_nonauthority(self):
        result = self._compose()
        self.assertTrue(result["same_world_linkage_verified"])
        self.assertTrue(result["ordered_material_chain_verified"])
        self.assertTrue(result["pre_post_capture_distinct"])
        self.assertFalse(result["producer_attestations_authenticated"])
        self.assertFalse(result["reboot_completion_proven"])
        self.assertFalse(result["boot_id_transition_verified"])
        self.assertFalse(result["database_persisted_readback_verified"])
        self.assertFalse(result["persistent_worker_proof"])
        self.assertFalse(result["worker_admitted"])
        self.assertFalse(result["w1_verified"])
        self.assertFalse(result["canonical"])
        self.assertFalse(result["authority_effect"])
        self.assertEqual(result["evidence_sha256"], self._sha(result["evidence"]))

    def test_anchor_is_deterministic_and_self_hashed(self):
        again = g.build_world_anchor(
            source_sha="a" * 40,
            source_tree="b" * 40,
            instance_id="i-0123456789abcdef0",
            worker_id="w1-worker-01",
            account_id="123456789012",
            region="us-east-2",
        )
        self.assertEqual(self.anchor, again)
        self.assertEqual(g.validate_world_anchor(again)["world_id"], again["world_id"])

    def test_policy_drift_fails_closed(self):
        with self.assertRaisesRegex(g.SameWorldError, "safety_policy_pin_mismatch"):
            g.build_world_anchor(
                source_sha="a" * 40,
                source_tree="b" * 40,
                instance_id="i-0123456789abcdef0",
                worker_id="w1-worker-01",
                account_id="123456789012",
                region="us-east-2",
                safety_policy_sha256="f" * 64,
            )

    def test_cross_instance_capture_rejected(self):
        bad = copy.deepcopy(self.pre)
        bad["evidence"]["instance_id"] = "i-fedcba98765432100"
        bad["evidence_sha256"] = self._sha(bad["evidence"])
        with self.assertRaisesRegex(g.SameWorldError, "world_mismatch:instance_id"):
            g.build_stage_link(
                world_anchor=self.anchor,
                stage="PRE_REBOOT_SAFETY_CAPTURE",
                receipt=bad,
                workflow_path=g.ALLOWED_WORKFLOWS["PRE_REBOOT_SAFETY_CAPTURE"],
                run_id="110",
                run_attempt="1",
                previous_link=self.links[0],
                previous_receipt=self.provision,
            )

    def test_package_sha_tamper_rejected(self):
        bad = copy.deepcopy(self.provision)
        bad["evidence"]["package_sha256"] = "f" * 64
        bad["evidence_sha256"] = self._sha(bad["evidence"])
        with self.assertRaisesRegex(g.SameWorldError, "package_sha_mismatch"):
            g.validate_stage_receipt("PROVISION", bad, self.anchor)

    def test_capture_package_source_drift_rejected(self):
        bad = copy.deepcopy(self.post)
        bad["evidence"]["package_source_commit_sha"] = "f" * 40
        bad["evidence_sha256"] = self._sha(bad["evidence"])
        with self.assertRaisesRegex(g.SameWorldError, "package_source_commit_sha"):
            g.validate_stage_receipt("POST_REBOOT_SAFETY_CAPTURE", bad, self.anchor)

    def test_reboot_worker_drift_rejected(self):
        bad = copy.deepcopy(self.reboot)
        bad["worker_id"] = "other-worker"
        with self.assertRaisesRegex(g.SameWorldError, "reboot_receipt_world_mismatch:worker_id"):
            g.validate_stage_receipt("REBOOT_REQUEST", bad, self.anchor)

    def test_previous_link_tamper_rejected(self):
        bad = copy.deepcopy(self.links[2])
        bad["previous_link_sha256"] = "f" * 64
        core = {k: copy.deepcopy(v) for k, v in bad.items() if k != "link_sha256"}
        bad["link_sha256"] = self._sha(core)
        with self.assertRaisesRegex(g.SameWorldError, "REBOOT_REQUEST_previous_link_mismatch"):
            g.validate_stage_link(
                bad,
                anchor=self.anchor,
                stage="REBOOT_REQUEST",
                receipt=self.reboot,
                previous_link=self.links[1],
                previous_receipt=self.pre,
            )

    def test_link_world_drift_rejected(self):
        bad = copy.deepcopy(self.links[1])
        bad["source_sha"] = "d" * 40
        core = {k: copy.deepcopy(v) for k, v in bad.items() if k != "link_sha256"}
        bad["link_sha256"] = self._sha(core)
        with self.assertRaisesRegex(g.SameWorldError, "link_field_mismatch:source_sha"):
            g.validate_stage_link(
                bad,
                anchor=self.anchor,
                stage="PRE_REBOOT_SAFETY_CAPTURE",
                receipt=self.pre,
                previous_link=self.links[0],
                previous_receipt=self.provision,
            )

    def test_workflow_not_allowlisted_rejected(self):
        with self.assertRaisesRegex(g.SameWorldError, "workflow_path_not_allowed"):
            g.build_stage_link(
                world_anchor=self.anchor,
                stage="PROVISION",
                receipt=self.provision,
                workflow_path=".github/workflows/arbitrary.yml",
                run_id="100",
                run_attempt="1",
            )

    def test_authority_injection_rejected(self):
        bad = copy.deepcopy(self.links[0])
        bad["w1_verified"] = True
        core = {k: copy.deepcopy(v) for k, v in bad.items() if k != "link_sha256"}
        bad["link_sha256"] = self._sha(core)
        with self.assertRaisesRegex(g.SameWorldError, "authority_boundary_invalid:w1_verified"):
            g.validate_stage_link(
                bad,
                anchor=self.anchor,
                stage="PROVISION",
                receipt=self.provision,
                previous_link=None,
                previous_receipt=None,
            )

    def test_receipt_hash_tamper_rejected(self):
        bad = copy.deepcopy(self.pre)
        bad["evidence"]["safety_outcome"] = "TAMPERED"
        with self.assertRaisesRegex(g.SameWorldError, "hash_invalid"):
            g.validate_stage_receipt("PRE_REBOOT_SAFETY_CAPTURE", bad, self.anchor)

    def test_pre_post_command_reuse_rejected(self):
        self.post["evidence"]["command_id"] = self.pre["evidence"]["command_id"]
        self.post["evidence_sha256"] = self._sha(self.post["evidence"])
        p, pre, r, _ = self.links
        post_link = g.build_stage_link(
            world_anchor=self.anchor,
            stage="POST_REBOOT_SAFETY_CAPTURE",
            receipt=self.post,
            workflow_path=g.ALLOWED_WORKFLOWS["POST_REBOOT_SAFETY_CAPTURE"],
            run_id="210",
            run_attempt="1",
            previous_link=r,
            previous_receipt=self.reboot,
        )
        with self.assertRaisesRegex(g.SameWorldError, "pre_post_capture_command_id_reuse"):
            g.compose_same_world_chain(
                world_anchor=self.anchor,
                provision_receipt=self.provision,
                provision_link=p,
                pre_capture_receipt=self.pre,
                pre_capture_link=pre,
                reboot_receipt=self.reboot,
                reboot_link=r,
                post_capture_receipt=self.post,
                post_capture_link=post_link,
            )

    def test_pre_post_bundle_reuse_rejected(self):
        self.post["evidence"]["bundle_transport_sha256"] = self.pre["evidence"]["bundle_transport_sha256"]
        self.post["evidence_sha256"] = self._sha(self.post["evidence"])
        p, pre, r, _ = self.links
        post_link = g.build_stage_link(
            world_anchor=self.anchor,
            stage="POST_REBOOT_SAFETY_CAPTURE",
            receipt=self.post,
            workflow_path=g.ALLOWED_WORKFLOWS["POST_REBOOT_SAFETY_CAPTURE"],
            run_id="210",
            run_attempt="1",
            previous_link=r,
            previous_receipt=self.reboot,
        )
        with self.assertRaisesRegex(g.SameWorldError, "pre_post_capture_bundle_reuse"):
            g.compose_same_world_chain(
                world_anchor=self.anchor,
                provision_receipt=self.provision,
                provision_link=p,
                pre_capture_receipt=self.pre,
                pre_capture_link=pre,
                reboot_receipt=self.reboot,
                reboot_link=r,
                post_capture_receipt=self.post,
                post_capture_link=post_link,
            )


if __name__ == "__main__":
    unittest.main()
