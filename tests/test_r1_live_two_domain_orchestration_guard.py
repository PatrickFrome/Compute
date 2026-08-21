import copy
import hashlib
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from controller.r1.live_two_domain_orchestration_guard import (
    AWS_ENVIRONMENT,
    B2_ENVIRONMENT,
    B2_REQUIRED_PREFIX,
    CIPHERTEXT_ARTIFACT_NAME,
    ENVELOPE_ARTIFACT_NAME,
    EXPECTED_REPOSITORY,
    EXPECTED_REPOSITORY_ID,
    EXPECTED_SOURCE_WORKFLOW_PATH,
    OrchestrationError,
    _canonical_bytes,
    _sha256_json,
    evaluate_results,
    validate_b2_authorization,
    validate_preflight,
    validate_provider_result,
)
from controller.r1.materialized_readback_verifier import verify_materialized_readback


NOW = datetime(2026, 8, 21, 18, 0, 0, tzinfo=timezone.utc)
HEAD = "a" * 40
CIPHER = b"encrypted recovery artifact\n"
CIPHER_SHA = hashlib.sha256(CIPHER).hexdigest()


def environment(name: str):
    return {
        "name": name,
        "protection_rules": [
            {
                "id": 1,
                "type": "required_reviewers",
                "prevent_self_review": True,
                "reviewers": [{"type": "User", "reviewer": {"login": "reviewer"}}],
            },
            {"id": 2, "type": "branch_policy"},
        ],
        "deployment_branch_policy": {"protected_branches": True, "custom_branch_policies": False},
    }


def source_run(run_id=100):
    return {
        "id": run_id,
        "path": EXPECTED_SOURCE_WORKFLOW_PATH,
        "head_branch": "main",
        "head_sha": HEAD,
        "event": "workflow_dispatch",
        "status": "completed",
        "conclusion": "success",
        "repository": {"id": EXPECTED_REPOSITORY_ID, "full_name": EXPECTED_REPOSITORY},
        "head_repository": {"id": EXPECTED_REPOSITORY_ID, "full_name": EXPECTED_REPOSITORY},
    }


def artifact(artifact_id: int, name: str, run_id=100, size=128):
    return {
        "id": artifact_id,
        "name": name,
        "size_in_bytes": size,
        "expired": False,
        "digest": "sha256:" + ("b" if artifact_id == 11 else "c") * 64,
        "workflow_run": {
            "id": run_id,
            "repository_id": EXPECTED_REPOSITORY_ID,
            "head_repository_id": EXPECTED_REPOSITORY_ID,
            "head_branch": "main",
            "head_sha": HEAD,
        },
    }


def preflight():
    return validate_preflight(
        source_run=source_run(),
        artifacts={"artifacts": [artifact(11, CIPHERTEXT_ARTIFACT_NAME), artifact(12, ENVELOPE_ARTIFACT_NAME)]},
        aws_environment=environment(AWS_ENVIRONMENT),
        b2_environment=environment(B2_ENVIRONMENT),
        source_run_id=100,
        ciphertext_artifact_id=11,
        envelope_artifact_id=12,
    )


def b2_auth(expiry_hours=2, capabilities=None, prefix=B2_REQUIRED_PREFIX):
    caps = capabilities or ["readFiles", "writeFiles", "readFileRetentions", "writeFileRetentions"]
    return {
        "accountId": "b2-account-123",
        "applicationKeyExpirationTimestamp": int((NOW + timedelta(hours=expiry_hours)).timestamp() * 1000),
        "apiInfo": {
            "storageApi": {
                "s3ApiUrl": "https://s3.us-west-004.backblazeb2.com",
                "allowed": {
                    "buckets": [{"id": "bucket-id", "name": "recovery-bucket"}],
                    "capabilities": caps,
                    "namePrefix": prefix,
                },
            }
        },
        "authorizationToken": "must-not-be-copied",
    }


def materialized_receipt(provider: str, domain: str, operator: str, failure_domain: str, account_hash: str):
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "readback.age"
        path.write_bytes(CIPHER)
        descriptor = {
            "schema": "metaengine.compute.r1-readback-descriptor.h205f22.v1",
            "domain_key": domain,
            "provider_kind": provider,
            "operator_class": operator,
            "failure_domain": failure_domain,
            "independence_basis": f"independent operator {operator}",
            "account_scope_sha256": account_hash,
            "object": {
                "subject_kind": "BACKUP_SET",
                "subject_id": f"r1-age-ciphertext:{CIPHER_SHA}",
                "expected_sha256": CIPHER_SHA,
                "expected_bytes": len(CIPHER),
                "payload_root_sha256": "d" * 64,
                "manifest_checkpoint_id": None,
            },
            "provider_object": {
                "endpoint_host": "s3.us-east-2.amazonaws.com" if provider == "AWS_S3" else "s3.us-west-004.backblazeb2.com",
                "bucket": "recovery-bucket",
                "key": f"h205f22/r1/sha256/{CIPHER_SHA}.age",
                "version_id": "v-1" if provider == "AWS_S3" else "4_z-version",
                "etag": "etag-only",
                "content_length": len(CIPHER),
                "last_modified": (NOW - timedelta(minutes=1)).isoformat(),
                "retention": {
                    "mode": "COMPLIANCE",
                    "retain_until": (NOW + timedelta(days=30)).isoformat(),
                    "source": "S3_GET_OBJECT_RETENTION_VERSION_PINNED",
                },
            },
            "controller": {
                "kind": "R1_EXACT_CIPHERTEXT_S3_REPLICATION_CONTROLLER_V1",
                "observed_at": NOW.isoformat(),
                "evidence_sha256": "e" * 64,
            },
        }
        return verify_materialized_readback(path, descriptor)


def provider_result(provider: str):
    if provider == "AWS_S3":
        domain, operator, failure, account = "r1-aws-domain", "AMAZON_AWS", "aws-us-east-2", "1" * 64
    else:
        domain, operator, failure, account = "r1-b2-domain", "BACKBLAZE", "b2-us-west-004", "2" * 64
    receipt = materialized_receipt(provider, domain, operator, failure, account)
    core = {
        "schema": "metaengine.compute.r1-provider-replication-result.h205f22.v1",
        "classification": "PROVIDER_REPLICATION_READBACK_CANDIDATE_NONAUTHORITATIVE",
        "target": {
            "domain_key": domain,
            "provider_kind": provider,
            "operator_class": operator,
            "failure_domain": failure,
            "account_scope_sha256": account,
        },
        "ciphertext": {
            "sha256": CIPHER_SHA,
            "bytes": len(CIPHER),
            "key": f"h205f22/r1/sha256/{CIPHER_SHA}.age",
            "version_id": "provider-version",
        },
        "provider_controller_evidence_sha256": "f" * 64,
        "readback_receipt": receipt,
        "provenance": {
            "source_attestation_verified": False,
            "source_attestation_required_before_authority": True,
        },
        "canonical": False,
        "authority_effect": False,
        "r2_proven": False,
        "r3_proven": False,
        "persisted_seal_allowed": False,
        "required_next": "REPEAT_FOR_INDEPENDENT_SECOND_DOMAIN_THEN_EVALUATE_NONAUTHORITATIVE_QUORUM_AND_VERIFY_SOURCE_ATTESTATION_BEFORE_DB_AUTHORITY",
    }
    result = dict(core)
    result["result_sha256"] = _sha256_json(core)
    return result


class LiveTwoDomainOrchestrationTests(unittest.TestCase):
    def test_valid_preflight_requires_bound_source_and_protected_environments(self):
        result = preflight()
        self.assertEqual(result["source"]["head_sha"], HEAD)
        self.assertFalse(result["provider_execution_authorized"])
        self.assertFalse(result["r2_proven"])
        self.assertTrue(result["source_attestation_required_before_authority"])

    def test_unprotected_or_self_approvable_environment_rejected(self):
        bad = environment(AWS_ENVIRONMENT)
        bad["protection_rules"][0]["prevent_self_review"] = False
        with self.assertRaisesRegex(OrchestrationError, "prevent_self_review"):
            validate_preflight(
                source_run=source_run(),
                artifacts={"artifacts": [artifact(11, CIPHERTEXT_ARTIFACT_NAME), artifact(12, ENVELOPE_ARTIFACT_NAME)]},
                aws_environment=bad,
                b2_environment=environment(B2_ENVIRONMENT),
                source_run_id=100,
                ciphertext_artifact_id=11,
                envelope_artifact_id=12,
            )

    def test_wrong_source_workflow_and_artifact_binding_rejected(self):
        run = source_run()
        run["path"] = ".github/workflows/untrusted.yml"
        with self.assertRaisesRegex(OrchestrationError, "source_workflow_path"):
            validate_preflight(
                source_run=run,
                artifacts={"artifacts": [artifact(11, CIPHERTEXT_ARTIFACT_NAME), artifact(12, ENVELOPE_ARTIFACT_NAME)]},
                aws_environment=environment(AWS_ENVIRONMENT),
                b2_environment=environment(B2_ENVIRONMENT),
                source_run_id=100,
                ciphertext_artifact_id=11,
                envelope_artifact_id=12,
            )
        items = {"artifacts": [artifact(11, CIPHERTEXT_ARTIFACT_NAME), artifact(12, ENVELOPE_ARTIFACT_NAME)]}
        items["artifacts"][0]["workflow_run"]["head_sha"] = "0" * 40
        with self.assertRaisesRegex(OrchestrationError, "artifact_workflow_binding"):
            validate_preflight(
                source_run=source_run(),
                artifacts=items,
                aws_environment=environment(AWS_ENVIRONMENT),
                b2_environment=environment(B2_ENVIRONMENT),
                source_run_id=100,
                ciphertext_artifact_id=11,
                envelope_artifact_id=12,
            )

    def test_b2_runtime_scope_is_provider_verified_and_short_lived(self):
        account_hash = hashlib.sha256(b"b2-account-123").hexdigest()
        summary = validate_b2_authorization(
            b2_auth(),
            expected_bucket="recovery-bucket",
            expected_endpoint_host="s3.us-west-004.backblazeb2.com",
            expected_account_scope_sha256=account_hash,
            now=NOW,
        )
        self.assertFalse(summary["authorization_token_recorded"])
        self.assertEqual(summary["name_prefix"], B2_REQUIRED_PREFIX)
        self.assertNotIn("authorizationToken", str(summary))

    def test_b2_master_broad_or_long_lived_keys_rejected(self):
        account_hash = hashlib.sha256(b"b2-account-123").hexdigest()
        broad = b2_auth(capabilities=["readFiles", "writeFiles", "readFileRetentions", "writeFileRetentions", "deleteFiles"])
        with self.assertRaisesRegex(OrchestrationError, "too_broad"):
            validate_b2_authorization(broad, expected_bucket="recovery-bucket", expected_endpoint_host="s3.us-west-004.backblazeb2.com", expected_account_scope_sha256=account_hash, now=NOW)
        with self.assertRaisesRegex(OrchestrationError, "exceeds_24h"):
            validate_b2_authorization(b2_auth(expiry_hours=48), expected_bucket="recovery-bucket", expected_endpoint_host="s3.us-west-004.backblazeb2.com", expected_account_scope_sha256=account_hash, now=NOW)
        with self.assertRaisesRegex(OrchestrationError, "prefix_scope"):
            validate_b2_authorization(b2_auth(prefix=""), expected_bucket="recovery-bucket", expected_endpoint_host="s3.us-west-004.backblazeb2.com", expected_account_scope_sha256=account_hash, now=NOW)

    def test_provider_result_self_hash_and_authority_tamper_rejected(self):
        value = provider_result("AWS_S3")
        validate_provider_result(value, "AWS_S3")
        tampered = copy.deepcopy(value)
        tampered["r2_proven"] = True
        tampered["result_sha256"] = _sha256_json({k: v for k, v in tampered.items() if k != "result_sha256"})
        with self.assertRaisesRegex(OrchestrationError, "authority_boundary"):
            validate_provider_result(tampered, "AWS_S3")

    def test_two_provider_results_form_candidate_but_never_r2_authority(self):
        result = evaluate_results(provider_result("AWS_S3"), provider_result("BACKBLAZE_B2"), preflight())
        self.assertEqual(result["quorum"]["distinct_operator_classes"], 2)
        self.assertEqual(result["quorum"]["strong_immutability_domains"], 2)
        self.assertTrue(result["quorum"]["candidate_ready"])
        self.assertFalse(result["source_attestation_verified"])
        self.assertFalse(result["r2_proven"])
        self.assertFalse(result["persisted_seal_allowed"])

    def test_provider_ciphertext_identity_mismatch_rejected(self):
        b2 = provider_result("BACKBLAZE_B2")
        b2["ciphertext"]["sha256"] = "9" * 64
        b2["result_sha256"] = _sha256_json({k: v for k, v in b2.items() if k != "result_sha256"})
        with self.assertRaisesRegex(OrchestrationError, "readback_ciphertext_mismatch|ciphertext_identity_mismatch"):
            evaluate_results(provider_result("AWS_S3"), b2, preflight())


if __name__ == "__main__":
    unittest.main()
