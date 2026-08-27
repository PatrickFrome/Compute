from __future__ import annotations

import base64
import copy
import hashlib
import json
from pathlib import Path
import unittest

from controller.w1 import aws_ssm_safety_capture_guard as guard
from controller.w1 import host_safety_envelope_validator as safety_validator
from tests.test_w1_host_safety_envelope_v2 import eligible_observation, rehash


ROOT = Path(__file__).resolve().parents[1]
DOCUMENT = ROOT / "infra/w1/ssm/Metaengine-W1-Safety-Capture-H205F22.json"
MANIFEST = ROOT / "infra/w1/package/W1_SAFETY_ENVELOPE_73AB09C7_MANIFEST.json"


def canonical_hash(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()


def make_bundle(*, eligible: bool = True) -> dict:
    obs = eligible_observation()
    obs["source"] = {"git_sha": guard.PACKAGE_SOURCE_COMMIT, "tree_sha": guard.PACKAGE_SOURCE_TREE}
    if not eligible:
        obs["network"]["default_ipv4_route"] = True
    rehash(obs)
    decision = safety_validator.evaluate(obs)
    neutral = {
        "probe_path": "worker/native_linux/host_safety_envelope_probe.py",
        "probe_sha256": "d" * 64,
        "execution_context": {
            "execution_user": guard.EXECUTION_USER,
            "effective_uid": 1001,
            "workspace_root": guard.WORKSPACE_ROOT,
            "workspace_owner_uid": 1001,
            "workspace_mode": 448,
            "workspace_real_directory": True,
            "workspace_owned_by_execution_user": True,
            "workspace_group_world_writable": False,
        },
        "observation": obs,
        "decision": decision,
        "safety_eligible": decision["safety_eligible"],
        "persistence_status": "NOT_EVALUATED",
        "provider_identity_status": "NOT_EVALUATED",
        "reboot_status": "NOT_EVALUATED",
        "admission_status": "NOT_AUTHORIZED",
        "authority": {
            "canonical": False,
            "authority_effect": False,
            "database_mutation": False,
            "provider_mutation": False,
            "reboot_authorized": False,
            "worker_admitted": False,
            "w1_verified": False,
        },
    }
    return {"schema": guard.BUNDLE_SCHEMA, **neutral, "bundle_sha256": canonical_hash(neutral)}


def rehash_bundle(value: dict) -> None:
    neutral = {key: item for key, item in value.items() if key not in {"schema", "bundle_sha256"}}
    value["bundle_sha256"] = canonical_hash(neutral)


def make_courier(*, eligible: bool = True) -> dict:
    bundle = make_bundle(eligible=eligible)
    raw = (json.dumps(bundle, sort_keys=True, indent=2) + "\n").encode("utf-8")
    return {
        "schema": guard.COURIER_SCHEMA,
        "source": "HOST_UNTRUSTED_TRANSPORT",
        "transport": "AWS_SSM_RUN_COMMAND_FIXED_DOCUMENT",
        "package_source_commit_sha": guard.PACKAGE_SOURCE_COMMIT,
        "package_source_tree_sha": guard.PACKAGE_SOURCE_TREE,
        "package_manifest_sha256": guard.PACKAGE_MANIFEST_SHA256,
        "bundle_base64": base64.b64encode(raw).decode("ascii"),
        "bundle_transport_sha256": hashlib.sha256(raw).hexdigest(),
        "bundle_safety_eligible": bool(bundle["safety_eligible"]),
        "host_safety_verified": False,
        "provider_identity_verified": False,
        "reboot_completion_proven": False,
        "persistent_worker_proof": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }


class SSMSafetyDocumentTests(unittest.TestCase):
    def test_repository_document_is_parameterless_and_pinned(self):
        raw = DOCUMENT.read_bytes()
        parsed = guard.parse_local_document(raw)
        self.assertEqual({}, parsed["parameters"])
        command = parsed["mainSteps"][0]["inputs"]["runCommand"][0]
        self.assertIn(guard.PACKAGE_SOURCE_COMMIT, command)
        self.assertIn(guard.PACKAGE_MANIFEST_SHA256, command)
        self.assertIn("runuser -u", command)
        self.assertNotIn("{{", command)
        self.assertNotIn("https://", command)
        self.assertNotIn("AWS-RunDocument", command)

    def test_manifest_digest_and_runtime_identity_are_pinned(self):
        raw = MANIFEST.read_bytes()
        self.assertEqual(guard.PACKAGE_MANIFEST_SHA256, hashlib.sha256(raw).hexdigest())
        value = json.loads(raw)
        self.assertEqual(guard.PACKAGE_SOURCE_COMMIT, value["source_commit_sha"])
        self.assertEqual(guard.PACKAGE_SOURCE_TREE, value["source_tree_sha"])
        self.assertEqual(guard.PACKAGE_ROOT, value["package_root"])
        self.assertEqual(guard.EXECUTION_USER, value["execution_user"])
        self.assertEqual(guard.WORKSPACE_ROOT, value["workspace_root"])
        self.assertFalse(value["transport"]["network_fetch_allowed"])
        self.assertFalse(value["transport"]["runtime_parameters_allowed"])
        self.assertFalse(value["transport"]["nested_document_allowed"])

    def test_parameter_injection_is_rejected(self):
        value = json.loads(DOCUMENT.read_text(encoding="utf-8"))
        value["parameters"] = {"commands": {"type": "String"}}
        with self.assertRaises(guard.SSMSafetyCaptureError):
            guard.validate_local_document(value)

    def test_remote_or_nested_execution_surface_is_rejected(self):
        for marker in ("https://example.invalid/payload", "AWS-RunDocument", "aws:runDocument"):
            with self.subTest(marker=marker):
                value = json.loads(DOCUMENT.read_text(encoding="utf-8"))
                value["mainSteps"][0]["inputs"]["runCommand"][0] += "\n" + marker
                with self.assertRaises(guard.SSMSafetyCaptureError):
                    guard.validate_local_document(value)


class SSMSafetyBoundaryTests(unittest.TestCase):
    def test_session_boundary_is_exact_document_and_tagged_instance_only(self):
        boundary = guard.build_session_boundary(instance_id="i-0123456789abcdef0", worker_id="w1-worker-01", account_id="123456789012", region="us-east-2", local_document_source=DOCUMENT.read_bytes())
        policy = json.dumps(boundary["session_policy"], sort_keys=True)
        self.assertIn(guard.DOCUMENT_NAME, policy)
        self.assertIn("ssm:resourceTag/metaengine:worker_id", policy)
        self.assertNotIn("AWS-RunDocument", policy)
        for forbidden in ("ssm:StartSession", "ssm:CreateDocument", "ssm:UpdateDocument", "ssm:DeleteDocument", "ec2:RebootInstances", "s3:", "kms:Decrypt", "secretsmanager:"):
            self.assertNotIn(forbidden, policy)
        self.assertFalse(boundary["provider_mutation_allowed"])
        self.assertFalse(boundary["reboot_allowed"])
        self.assertFalse(boundary["host_safety_verified"])
        self.assertFalse(boundary["w1_verified"])

    def test_command_plan_pins_version_hash_and_empty_parameters(self):
        plan = guard.build_command_plan(instance_id="i-0123456789abcdef0", aws_document_sha256="a" * 64, repository_document_source_sha256="b" * 64)
        self.assertEqual("1", plan["document_version"])
        self.assertEqual("Sha256", plan["document_hash_type"])
        self.assertEqual({}, plan["parameters"])
        self.assertFalse(plan["nested_document_execution_allowed"])
        self.assertFalse(plan["s3_output"])
        self.assertFalse(plan["cloudwatch_output"])

    def test_managed_node_must_be_online_linux_ec2(self):
        result = guard.validate_managed_node({"InstanceInformationList": [{"InstanceId": "i-0123456789abcdef0", "PingStatus": "Online", "PlatformType": "Linux", "ResourceType": "EC2Instance", "AgentVersion": "3.3.3000.0"}]}, expected_instance_id="i-0123456789abcdef0")
        self.assertEqual("Linux", result["platform_type"])

    def test_remote_document_must_match_repository_exactly(self):
        raw = DOCUMENT.read_bytes()
        local = json.loads(raw)
        description = {"Document": {"Name": guard.DOCUMENT_NAME, "Owner": "123456789012", "DocumentType": "Command", "Status": "Active", "DocumentVersion": "1", "HashType": "Sha256", "Hash": "a" * 64, "PlatformTypes": ["Linux"]}}
        good = {"Name": guard.DOCUMENT_NAME, "DocumentVersion": "1", "DocumentType": "Command", "Status": "Active", "Content": json.dumps(local)}
        result = guard.validate_remote_document(description=description, get_document=good, account_id="123456789012", local_document_source=raw)
        self.assertTrue(result["remote_content_matches_repository"])
        bad = copy.deepcopy(good)
        tampered = copy.deepcopy(local)
        tampered["description"] += " tampered"
        bad["Content"] = json.dumps(tampered)
        with self.assertRaises(guard.SSMSafetyCaptureError):
            guard.validate_remote_document(description=description, get_document=bad, account_id="123456789012", local_document_source=raw)


class SSMSafetyCourierTests(unittest.TestCase):
    def test_offhost_recomputes_eligible_decision_but_grants_no_authority(self):
        validated = guard.validate_courier(make_courier(eligible=True))
        self.assertTrue(validated["decision"]["safety_eligible"])
        self.assertEqual("SAFETY_ENVELOPE_ELIGIBLE_NON_PERSISTENT", validated["decision"]["outcome"])

    def test_rejected_safety_bundle_is_valid_transport_not_false_success(self):
        validated = guard.validate_courier(make_courier(eligible=False))
        self.assertFalse(validated["decision"]["safety_eligible"])
        self.assertEqual("REJECTED_SAFETY_ENVELOPE", validated["decision"]["outcome"])

    def test_courier_authority_injection_is_rejected(self):
        value = make_courier()
        value["host_safety_verified"] = True
        with self.assertRaises(guard.SSMSafetyCaptureError):
            guard.validate_courier(value)

    def test_bundle_decision_tamper_is_rejected_even_if_self_hash_is_recomputed(self):
        value = make_courier()
        bundle = json.loads(base64.b64decode(value["bundle_base64"]))
        bundle["decision"]["safety_eligible"] = False
        rehash_bundle(bundle)
        new_raw = (json.dumps(bundle, sort_keys=True, indent=2) + "\n").encode()
        value["bundle_base64"] = base64.b64encode(new_raw).decode()
        value["bundle_transport_sha256"] = hashlib.sha256(new_raw).hexdigest()
        with self.assertRaises(guard.SSMSafetyCaptureError):
            guard.validate_courier(value)

    def test_bundle_source_tamper_is_rejected(self):
        value = make_courier()
        bundle = json.loads(base64.b64decode(value["bundle_base64"]))
        bundle["observation"]["source"]["git_sha"] = "f" * 40
        rehash(bundle["observation"])
        bundle["decision"] = safety_validator.evaluate(bundle["observation"])
        bundle["safety_eligible"] = bundle["decision"]["safety_eligible"]
        rehash_bundle(bundle)
        raw = (json.dumps(bundle, sort_keys=True, indent=2) + "\n").encode()
        value["bundle_base64"] = base64.b64encode(raw).decode()
        value["bundle_transport_sha256"] = hashlib.sha256(raw).hexdigest()
        value["bundle_safety_eligible"] = bundle["safety_eligible"]
        with self.assertRaises(guard.SSMSafetyCaptureError):
            guard.validate_courier(value)

    def test_command_invocation_remains_non_authoritative(self):
        command_id = "12345678-1234-1234-1234-123456789abc"
        courier = make_courier()
        receipt = guard.validate_command_invocation({"CommandId": command_id, "InstanceId": "i-0123456789abcdef0", "DocumentName": guard.DOCUMENT_NAME, "Status": "Success", "StandardOutputContent": json.dumps(courier, sort_keys=True, separators=(",", ":")), "StandardErrorContent": ""}, expected_command_id=command_id, expected_instance_id="i-0123456789abcdef0")
        self.assertTrue(receipt["capture_transport_validated"])
        self.assertTrue(receipt["host_safety_eligible_observed"])
        self.assertFalse(receipt["host_safety_verified"])
        self.assertFalse(receipt["persistent_worker_proof"])
        self.assertFalse(receipt["w1_verified"])
        self.assertFalse(receipt["authority_effect"])


if __name__ == "__main__":
    unittest.main()
