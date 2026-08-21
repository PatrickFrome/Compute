import copy
import hashlib
import json
import tarfile
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from controller.r1.final_r2_evidence_package import FinalEvidenceError, build_package
from controller.r1.idempotent_exact_ciphertext_replication import replicate_or_reuse
from controller.r1.live_two_domain_orchestration_guard import evaluate_results
from controller.r1.provider_configuration_readiness import (
    AWS_READINESS_SCHEMA,
    B2_READINESS_SCHEMA,
    CLASSIFICATION as PROVIDER_READINESS_CLASSIFICATION,
)
from controller.r1.recovery_encryption_envelope import (
    AGE_REQUIRED_VERSION,
    ENVELOPE_CLASSIFICATION,
    ENVELOPE_SCHEMA,
    PROFILE_PRODUCTION_PQ,
)
from controller.r1.source_bound_quorum_candidate import bind_candidate
from controller.r1.source_environment_approval_evidence import build_approval_evidence
from controller.r1.source_environment_evidence_binding import (
    BOUND_PREDICATE_CLASSIFICATION,
    PREDICATE_SCHEMA,
    READINESS_SCHEMA,
    SOURCE_ENVIRONMENT,
    VERIFICATION_CLASSIFICATION,
    VERIFICATION_SCHEMA,
    bind_predicate,
)

NOW = datetime(2026, 8, 21, 20, 0, tzinfo=timezone.utc)


def canon(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def seal(value, field):
    core = dict(value)
    core.pop(field, None)
    value[field] = hashlib.sha256(canon(core)).hexdigest()
    return value


class FinalR2EvidencePackageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.ciphertext = self.root / "recovery.age"
        self.ciphertext.write_bytes(b"step08 exact ciphertext bytes\n")
        self.cipher_sha = hashlib.sha256(self.ciphertext.read_bytes()).hexdigest()
        self.cipher_bytes = self.ciphertext.stat().st_size
        self.run_id = 88008
        self.head_sha = "1" * 40
        self.readiness_id = 5001
        self.approval_id = 5002
        self._write_inputs()

    def tearDown(self):
        self.tmp.cleanup()

    def _write_json(self, name, value):
        path = self.root / name
        path.write_bytes(canon(value) + b"\n")
        return path

    def _target(self, provider):
        is_aws = provider == "AWS_S3"
        return {
            "schema": "metaengine.compute.r1-s3-replication-target.h205f22.v1",
            "domain_key": "aws-us-east-2" if is_aws else "b2-us-west-004",
            "provider_kind": provider,
            "operator_class": "AMAZON_AWS" if is_aws else "BACKBLAZE",
            "failure_domain": "aws:us-east-2" if is_aws else "b2:us-west-004",
            "independence_basis": "independently operated provider and account boundary",
            "account_scope_sha256": ("a" if is_aws else "b") * 64,
            "bucket": "metaengine-r1-proof-a" if is_aws else "metaengine-r1-proof-b",
            "region": "us-east-2" if is_aws else "us-west-004",
            "endpoint_url": None if is_aws else "https://s3.us-west-004.backblazeb2.com",
            "retain_until": (NOW + timedelta(days=30)).isoformat(),
        }

    def _runner(self, version):
        retain_until = (NOW + timedelta(days=30)).isoformat()
        payload = self.ciphertext.read_bytes()

        def run(cmd):
            op = cmd[2]
            if op == "put-object":
                return {"VersionId": version, "ETag": '"etag"'}
            if op == "get-object-retention":
                return {"Retention": {"Mode": "COMPLIANCE", "RetainUntilDate": retain_until}}
            if op == "head-object":
                return {
                    "ContentLength": len(payload),
                    "LastModified": NOW.isoformat(),
                    "ETag": '"etag"',
                    "VersionId": version,
                }
            if op == "get-object":
                out = Path(cmd[-1])
                out.write_bytes(payload)
                return {"VersionId": version, "ContentLength": len(payload)}
            raise AssertionError(cmd)

        return run

    def _provider_readiness(self, provider):
        value = {
            "schema": AWS_READINESS_SCHEMA if provider == "AWS_S3" else B2_READINESS_SCHEMA,
            "classification": PROVIDER_READINESS_CLASSIFICATION,
            "provider_kind": provider,
            "ready_for_step05a_candidate_generation": True,
            "canonical": False,
            "authority_effect": False,
            "r2_proven": False,
            "r3_proven": False,
            "persisted_seal_allowed": False,
        }
        return seal(value, "receipt_sha256")

    def _write_inputs(self):
        envelope_core = {
            "schema": ENVELOPE_SCHEMA,
            "classification": ENVELOPE_CLASSIFICATION,
            "source_bundle": {
                "bundle_sha256": "c" * 64,
                "bundle_bytes": 1234,
                "manifest_sha256": "d" * 64,
                "bundle_receipt_sha256": "e" * 64,
                "storage_api_objects_included": False,
            },
            "ciphertext": {
                "format": "age-encryption.org/v1",
                "sha256": self.cipher_sha,
                "bytes": self.cipher_bytes,
            },
            "encryption": {
                "tool": "age",
                "required_version": AGE_REQUIRED_VERSION,
                "observed_version": AGE_REQUIRED_VERSION,
                "profile": PROFILE_PRODUCTION_PQ,
                "recipient_count": 2,
                "recipients": [
                    {"kind": "MLKEM768_X25519_HYBRID", "recipient_sha256": "2" * 64},
                    {"kind": "MLKEM768_X25519_HYBRID", "recipient_sha256": "3" * 64},
                ],
                "post_quantum_required": True,
                "encrypt_once_required": True,
                "replication_contract": "COPY_EXACT_CIPHERTEXT_BYTES_DO_NOT_REENCRYPT_PER_PROVIDER",
            },
            "security": {
                "plaintext_upload_allowed": False,
                "plaintext_bundle_must_remain_local": True,
                "external_storage_ready": True,
                "identity_material_embedded": False,
            },
            "provenance": {
                "sender_authenticity_proven": False,
                "source_attestation_verified": False,
                "source_attestation_required_before_authority": True,
                "self_hash_is_not_sender_authentication": True,
            },
            "authority": {
                "canonical": False,
                "authority_effect": False,
                "source_attestation_verified": False,
                "r2_proven": False,
                "r3_proven": False,
                "persisted_seal_allowed": False,
            },
            "required_next": "UPLOAD_IDENTICAL_CIPHERTEXT_TO_TWO_INDEPENDENT_DOMAINS_THEN_MATERIALIZE_AND_HASH_READBACK",
        }
        envelope = seal(envelope_core, "receipt_sha256")
        self.envelope = self._write_json("envelope.json", envelope)

        aws_result = replicate_or_reuse(
            ciphertext=self.ciphertext,
            envelope_receipt_path=self.envelope,
            target_raw=self._target("AWS_S3"),
            now=NOW,
            probe_runner=lambda _cmd: None,
            runner=self._runner("aws-v1"),
        )
        b2_result = replicate_or_reuse(
            ciphertext=self.ciphertext,
            envelope_receipt_path=self.envelope,
            target_raw=self._target("BACKBLAZE_B2"),
            now=NOW + timedelta(minutes=2),
            probe_runner=lambda _cmd: None,
            runner=self._runner("b2-v1"),
        )
        self.aws_result = self._write_json("aws-result.json", aws_result)
        self.b2_result = self._write_json("b2-result.json", b2_result)

        preflight_core = {
            "schema": "metaengine.compute.r1-live-two-domain-preflight.h205f22.v1",
            "classification": "LIVE_ORCHESTRATION_PREFLIGHT_NONAUTHORITATIVE",
            "source": {
                "run_id": self.run_id,
                "workflow_path": ".github/workflows/r1-live-recovery-source.yml",
                "branch": "main",
                "head_sha": self.head_sha,
                "repository_id": 1341371143,
                "repository": "PatrickFrome/Compute",
                "ciphertext_artifact": {"id": 1001, "name": "r1-recovery-ciphertext.age", "size_in_bytes": self.cipher_bytes, "digest_sha256": self.cipher_sha},
                "envelope_artifact": {"id": 1002, "name": "r1-recovery-envelope-receipt.json", "size_in_bytes": self.envelope.stat().st_size, "digest_sha256": hashlib.sha256(self.envelope.read_bytes()).hexdigest()},
            },
            "environments": {},
            "provider_execution_authorized": False,
            "source_attestation_verified": False,
            "source_attestation_required_before_authority": True,
            "canonical": False,
            "authority_effect": False,
            "r2_proven": False,
            "r3_proven": False,
            "persisted_seal_allowed": False,
        }
        preflight = seal(preflight_core, "preflight_sha256")
        self.preflight = self._write_json("preflight.json", preflight)
        orchestration = evaluate_results(aws_result, b2_result, preflight)
        self.orchestration = self._write_json("orchestration.json", orchestration)

        readiness = {
            "schema": READINESS_SCHEMA,
            "environment": SOURCE_ENVIRONMENT,
            "required_reviewer_count": 1,
            "prevent_self_review": True,
            "branch_policy": {"protected_branches": True, "custom_branch_policies": False},
            "ready_for_source_generation": True,
            "authority_effect": False,
            "r2_proven": False,
            "persisted_seal_allowed": False,
        }
        self.readiness = self._write_json("readiness.json", readiness)
        approval = build_approval_evidence([
            {"state": "approved", "comment": "approve", "environments": [{"id": 991, "name": SOURCE_ENVIRONMENT}], "user": {"id": 22, "login": "reviewer"}}
        ], 11)
        self.approval = self._write_json("approval.json", approval)

        predicate_base = {
            "schema": PREDICATE_SCHEMA,
            "classification": BOUND_PREDICATE_CLASSIFICATION,
            "source": {"run_id": self.run_id, "head_sha": self.head_sha, "environment": SOURCE_ENVIRONMENT},
            "ciphertext": {"sha256": self.cipher_sha, "bytes": self.cipher_bytes},
            "authority": {
                "source_attestation_candidate": True,
                "source_attestation_verified_by_consumer": False,
                "authority_effect": False,
                "r2_proven": False,
                "r3_proven": False,
                "persisted_seal_allowed": False,
            },
        }
        predicate_base = seal(predicate_base, "predicate_sha256")
        predicate = bind_predicate(predicate_base, readiness, approval, self.readiness_id, self.approval_id)
        self.predicate = self._write_json("predicate.json", predicate)

        source_verification_core = {
            "schema": VERIFICATION_SCHEMA,
            "classification": VERIFICATION_CLASSIFICATION,
            "source": {"repository_id": 1341371143, "repository": "PatrickFrome/Compute", "workflow_path": ".github/workflows/r1-live-recovery-source.yml", "head_sha": self.head_sha, "run_id": self.run_id},
            "predicate_sha256": predicate["predicate_sha256"],
            "ciphertext_sha256": self.cipher_sha,
            "ciphertext_bytes": self.cipher_bytes,
            "envelope_receipt_sha256": envelope["receipt_sha256"],
            "semantic_head_at_source": "metaengine-h205f22-recovery-dev-20260821-cp072",
            "canonical_digest_at_source": "4" * 64,
            "migration_ledger_sha256": "5" * 64,
            "verified_timestamp_count": 1,
            "source_attestation_verified": True,
            "source_environment_evidence": {
                "environment": SOURCE_ENVIRONMENT,
                "configuration": {"artifact_id": self.readiness_id, "artifact_name": "r1-source-environment-readiness.json", "readiness_sha256": hashlib.sha256(canon(readiness)).hexdigest()},
                "approval": {"artifact_id": self.approval_id, "artifact_name": "r1-source-environment-approval.json", "approval_receipt_sha256": approval["approval_receipt_sha256"], "approved_review_count": 1},
                "source_environment_binding_verified": True,
            },
            "authority_effect": False,
            "r2_proven": False,
            "r3_proven": False,
            "persisted_seal_allowed": False,
            "final_r2_evidence_binding_required": True,
        }
        source_verification = seal(source_verification_core, "verification_receipt_sha256")
        self.source_verification = self._write_json("source-verification.json", source_verification)

        handoff_core = {
            "schema": "metaengine.compute.r1-verified-source-handoff.h205f22.v1",
            "classification": "VERIFIED_SOURCE_HANDOFF_PROVIDER_ELIGIBILITY_NONAUTHORITATIVE",
            "source": {
                "run_id": self.run_id,
                "head_sha": self.head_sha,
                "workflow_path": ".github/workflows/r1-live-recovery-source.yml",
                "preflight_sha256": preflight["preflight_sha256"],
                "ciphertext_sha256": self.cipher_sha,
                "ciphertext_bytes": self.cipher_bytes,
                "envelope_receipt_sha256": envelope["receipt_sha256"],
                "source_verification_artifact": {"id": 3003, "name": "r1-recovery-source-verification.json", "size_in_bytes": self.source_verification.stat().st_size, "digest_sha256": hashlib.sha256(self.source_verification.read_bytes()).hexdigest()},
                "source_verification_receipt_sha256": source_verification["verification_receipt_sha256"],
                "predicate_sha256": predicate["predicate_sha256"],
                "semantic_head_at_source": source_verification["semantic_head_at_source"],
                "canonical_digest_at_source": source_verification["canonical_digest_at_source"],
                "migration_ledger_sha256": source_verification["migration_ledger_sha256"],
                "source_environment_readiness_artifact_id": self.readiness_id,
                "source_environment_readiness_sha256": hashlib.sha256(canon(readiness)).hexdigest(),
                "source_environment_approval_artifact_id": self.approval_id,
                "source_environment_approval_sha256": approval["approval_receipt_sha256"],
                "source_environment_approved_review_count": 1,
            },
            "source_attestation_verified": True,
            "source_environment_binding_verified": True,
            "source_environment_approval_verified": True,
            "provider_credentials_eligible_after_environment_and_readiness_gates": True,
            "provider_execution_authorized": False,
            "final_r2_evidence_binding_required": True,
            "canonical": False,
            "authority_effect": False,
            "r2_proven": False,
            "r3_proven": False,
            "persisted_seal_allowed": False,
        }
        handoff = seal(handoff_core, "handoff_sha256")
        self.handoff = self._write_json("handoff.json", handoff)
        source_bound = bind_candidate(orchestration, handoff)
        self.source_bound = self._write_json("source-bound.json", source_bound)

        self.aws_readiness = self._write_json("aws-readiness.json", self._provider_readiness("AWS_S3"))
        self.b2_readiness = self._write_json("b2-readiness.json", self._provider_readiness("BACKBLAZE_B2"))
        self.attestation_bundle = self.root / "attestation.jsonl"
        self.attestation_bundle.write_text(json.dumps({"mediaType": "application/vnd.dev.sigstore.bundle.v0.3+json", "test": True}) + "\n")
        self.trusted_root = self.root / "trusted-root.jsonl"
        self.trusted_root.write_text(json.dumps({"mediaType": "application/vnd.dev.sigstore.trustedroot+json", "test": True}) + "\n")

    def _kwargs(self):
        return dict(
            readiness_path=self.readiness,
            approval_path=self.approval,
            predicate_path=self.predicate,
            attestation_bundle_path=self.attestation_bundle,
            trusted_root_path=self.trusted_root,
            source_verification_path=self.source_verification,
            handoff_path=self.handoff,
            preflight_path=self.preflight,
            aws_readiness_path=self.aws_readiness,
            b2_readiness_path=self.b2_readiness,
            aws_result_path=self.aws_result,
            b2_result_path=self.b2_result,
            orchestration_path=self.orchestration,
            source_bound_path=self.source_bound,
            envelope_path=self.envelope,
        )

    def test_valid_package_is_deterministic_nonauthoritative_and_omits_ciphertext(self):
        package1, receipt1, projection1 = build_package(**self._kwargs())
        package2, receipt2, projection2 = build_package(**self._kwargs())
        self.assertEqual(package1, package2)
        self.assertEqual(receipt1, receipt2)
        self.assertEqual(projection1, projection2)
        self.assertFalse(receipt1["ciphertext_included"])
        self.assertTrue(receipt1["offline_reverification_required"])
        self.assertFalse(receipt1["r2_proven"])
        self.assertFalse(receipt1["persisted_seal_allowed"])
        archive = self.root / "package.tar"
        archive.write_bytes(package1)
        with tarfile.open(archive, "r") as tf:
            names = tf.getnames()
        self.assertIn("manifest.json", names)
        self.assertIn("source/trusted_root.jsonl", names)
        self.assertIn("provider/r1-aws-provider-result.json", names)
        self.assertFalse(any(name.endswith(".age") for name in names))
        self.assertEqual(len(projection1["observation_inserts"]), 2)
        self.assertTrue(projection1["r2_freshness_contract"]["package_does_not_refresh_readback_at"])
        self.assertFalse(projection1["r2_proven"])

    def test_provider_recomputed_hash_forgery_is_rejected(self):
        value = json.loads(self.aws_result.read_text())
        value["provider_controller_evidence"]["retention_response"]["Retention"]["Mode"] = "GOVERNANCE"
        value["provider_controller_evidence_sha256"] = hashlib.sha256(canon(value["provider_controller_evidence"])).hexdigest()
        seal(value, "result_sha256")
        forged = self._write_json("aws-forged.json", value)
        kwargs = self._kwargs()
        kwargs["aws_result_path"] = forged
        with self.assertRaises(Exception):
            build_package(**kwargs)

    def test_source_readiness_tamper_is_rejected_even_if_valid_json(self):
        value = json.loads(self.readiness.read_text())
        value["required_reviewer_count"] = 9
        forged = self._write_json("readiness-forged.json", value)
        kwargs = self._kwargs()
        kwargs["readiness_path"] = forged
        with self.assertRaisesRegex(FinalEvidenceError, "readiness_handoff_hash_mismatch"):
            build_package(**kwargs)

    def test_source_bound_recomputed_hash_cannot_escalate_r2(self):
        value = json.loads(self.source_bound.read_text())
        value["r2_proven"] = True
        seal(value, "candidate_sha256")
        forged = self._write_json("source-bound-forged.json", value)
        kwargs = self._kwargs()
        kwargs["source_bound_path"] = forged
        with self.assertRaisesRegex(FinalEvidenceError, "source_bound_authority_boundary_invalid"):
            build_package(**kwargs)

    def test_package_preserves_original_readback_times_and_seven_day_window(self):
        _, _, projection = build_package(**self._kwargs())
        source_times = sorted([
            json.loads(self.aws_result.read_text())["readback_receipt"]["readback"]["readback_at"],
            json.loads(self.b2_result.read_text())["readback_receipt"]["readback"]["readback_at"],
        ])
        projected_times = sorted(item["readback_at"] for item in projection["observation_inserts"])
        self.assertEqual(source_times, projected_times)
        earliest = min(datetime.fromisoformat(x) for x in source_times)
        self.assertEqual(
            datetime.fromisoformat(projection["r2_freshness_contract"]["latest_effective_at_for_both_current_readbacks"]),
            earliest + timedelta(days=7),
        )

    def test_invalid_trusted_root_jsonl_fails_closed(self):
        bad = self.root / "bad-root.jsonl"
        bad.write_text("not-json\n")
        kwargs = self._kwargs()
        kwargs["trusted_root_path"] = bad
        with self.assertRaisesRegex(FinalEvidenceError, "invalid_jsonl"):
            build_package(**kwargs)


if __name__ == "__main__":
    unittest.main()
