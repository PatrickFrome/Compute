import copy
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path

from controller.r1.live_r2_execution_guard import (
    AWS_ENVIRONMENT,
    DB_ENVIRONMENT,
    PROVIDER_ARTIFACTS,
    PROVIDER_WORKFLOW_PATH,
    SOURCE_ARTIFACTS,
    SOURCE_WORKFLOW_PATH,
    LiveR2ExecutionError,
    build_aws_materialization_plan,
    build_preflight,
    validate_aws_materialized,
)
from tests.test_r1_idempotent_exact_ciphertext_replication import (
    IdempotentExactCiphertextReplicationTests,
    NOW,
    _rehash_evidence_and_result,
)


class LiveR2ExecutionGuardTests(unittest.TestCase):
    def _run(self, run_id, workflow_path, sha):
        repo = {"id": 1341371143, "full_name": "PatrickFrome/Compute"}
        return {
            "id": run_id,
            "repository": repo,
            "head_repository": dict(repo),
            "path": workflow_path,
            "head_branch": "main",
            "head_sha": sha,
            "event": "workflow_dispatch",
            "status": "completed",
            "conclusion": "success",
        }

    def _artifacts(self, run, names, start=1000):
        values = []
        for offset, name in enumerate(names):
            values.append({
                "id": start + offset,
                "name": name,
                "expired": False,
                "size_in_bytes": 100 + offset,
                "digest": "sha256:" + format(start + offset, "064x")[-64:],
                "workflow_run": {
                    "id": run["id"],
                    "repository_id": 1341371143,
                    "head_repository_id": 1341371143,
                    "head_branch": "main",
                    "head_sha": run["head_sha"],
                },
            })
        return {"artifacts": values}

    def _environment(self, name):
        return {
            "name": name,
            "protection_rules": [
                {
                    "type": "required_reviewers",
                    "prevent_self_review": True,
                    "reviewers": [{"type": "User", "reviewer": {"id": 7}}],
                },
                {"type": "branch_policy"},
            ],
            "deployment_branch_policy": {
                "protected_branches": True,
                "custom_branch_policies": False,
            },
        }

    def _preflight_args(self):
        source = self._run(101, SOURCE_WORKFLOW_PATH, "1" * 40)
        provider = self._run(202, PROVIDER_WORKFLOW_PATH, "2" * 40)
        return {
            "source_run": source,
            "source_artifacts": self._artifacts(source, SOURCE_ARTIFACTS, 1000),
            "provider_run": provider,
            "provider_artifacts": self._artifacts(provider, PROVIDER_ARTIFACTS, 2000),
            "aws_environment": self._environment(AWS_ENVIRONMENT),
            "db_environment": self._environment(DB_ENVIRONMENT),
            "source_run_id": 101,
            "provider_run_id": 202,
        }

    def test_preflight_binds_exact_successful_runs_artifacts_and_protected_environments(self):
        value = build_preflight(**self._preflight_args())
        self.assertEqual(value["source"]["run_id"], 101)
        self.assertEqual(value["provider"]["run_id"], 202)
        self.assertEqual(set(value["artifacts"]["source"]), set(SOURCE_ARTIFACTS))
        self.assertEqual(set(value["artifacts"]["provider"]), set(PROVIDER_ARTIFACTS))
        self.assertTrue(value["fresh_provider_materialization_required"])
        self.assertTrue(value["fresh_trusted_root_required"])
        self.assertFalse(value["database_write_authorized"])
        self.assertFalse(value["r2_proven"])
        self.assertFalse(value["persisted_seal_allowed"])

    def test_preflight_rejects_wrong_provider_workflow_and_duplicate_artifact(self):
        args = self._preflight_args()
        args["provider_run"] = copy.deepcopy(args["provider_run"])
        args["provider_run"]["path"] = ".github/workflows/not-r1.yml"
        with self.assertRaisesRegex(LiveR2ExecutionError, "provider_workflow_path_mismatch"):
            build_preflight(**args)

        args = self._preflight_args()
        args["source_artifacts"] = copy.deepcopy(args["source_artifacts"])
        args["source_artifacts"]["artifacts"].append(copy.deepcopy(args["source_artifacts"]["artifacts"][0]))
        with self.assertRaisesRegex(LiveR2ExecutionError, "source_artifact_not_unique"):
            build_preflight(**args)

    def test_preflight_rejects_unprotected_database_environment(self):
        args = self._preflight_args()
        args["db_environment"] = copy.deepcopy(args["db_environment"])
        args["db_environment"]["protection_rules"][0]["prevent_self_review"] = False
        with self.assertRaisesRegex(LiveR2ExecutionError, "environment_prevent_self_review_required"):
            build_preflight(**args)

    def setUp(self):
        self.provider_fixture = IdempotentExactCiphertextReplicationTests(methodName="test_missing_current_object_uses_original_conditional_create_path_and_persists_evidence")
        self.provider_fixture.setUp()
        self.provider_result = self.provider_fixture.create_result()
        target = self.provider_fixture.target("AWS_S3")
        self.plan = build_aws_materialization_plan(
            provider_result=self.provider_result,
            expected_bucket=target["bucket"],
            expected_domain_key=target["domain_key"],
            expected_account_scope_sha256=target["account_scope_sha256"],
            expected_account_id="123456789012",
            expected_region=target["region"],
        )

    def tearDown(self):
        self.provider_fixture.tearDown()

    def _get_response(self):
        return {
            "VersionId": self.plan["version_id"],
            "ContentLength": self.plan["ciphertext_bytes"],
            "Metadata": self.provider_fixture.expected_metadata(),
        }

    def _retention_response(self, when=None):
        when = when or (NOW + timedelta(days=30))
        return {"Retention": {"Mode": "COMPLIANCE", "RetainUntilDate": when.isoformat()}}

    def test_aws_plan_is_version_pinned_read_only_and_denies_mutation(self):
        statements = self.plan["session_policy"]["Statement"]
        allow = next(s for s in statements if s["Effect"] == "Allow")
        deny = next(s for s in statements if s["Effect"] == "Deny")
        self.assertEqual(set(allow["Action"]), {"s3:GetObjectVersion", "s3:GetObjectRetention"})
        self.assertIn("s3:PutObject", deny["Action"])
        self.assertIn("s3:DeleteObjectVersion", deny["Action"])
        self.assertFalse(self.plan["provider_write_allowed"])
        self.assertFalse(self.plan["r2_proven"])

    def test_aws_materialization_recomputes_bytes_and_keeps_authority_false(self):
        receipt = validate_aws_materialized(
            provider_result=self.provider_result,
            plan=self.plan,
            get_response=self._get_response(),
            retention_response=self._retention_response(),
            materialized_path=self.provider_fixture.ciphertext,
            now=NOW + timedelta(minutes=5),
        )
        self.assertEqual(receipt["version_id"], self.plan["version_id"])
        self.assertEqual(receipt["ciphertext_sha256"], self.plan["ciphertext_sha256"])
        self.assertTrue(receipt["version_pinned_provider_read_performed"])
        self.assertTrue(receipt["local_sha256_recomputed"])
        self.assertFalse(receipt["source_attestation_reverified"])
        self.assertFalse(receipt["r2_proven"])

    def test_materialization_rejects_wrong_version_corrupt_bytes_and_shortened_retention(self):
        bad_get = self._get_response()
        bad_get["VersionId"] = "wrong-version"
        with self.assertRaisesRegex(LiveR2ExecutionError, "version_mismatch"):
            validate_aws_materialized(
                provider_result=self.provider_result,
                plan=self.plan,
                get_response=bad_get,
                retention_response=self._retention_response(),
                materialized_path=self.provider_fixture.ciphertext,
                now=NOW + timedelta(minutes=5),
            )

        with tempfile.TemporaryDirectory() as temp:
            bad = Path(temp) / "bad.age"
            bad.write_bytes(self.provider_fixture.ciphertext.read_bytes() + b"tamper")
            with self.assertRaisesRegex(LiveR2ExecutionError, "ciphertext_identity_mismatch"):
                validate_aws_materialized(
                    provider_result=self.provider_result,
                    plan=self.plan,
                    get_response=self._get_response(),
                    retention_response=self._retention_response(),
                    materialized_path=bad,
                    now=NOW + timedelta(minutes=5),
                )

        with self.assertRaisesRegex(LiveR2ExecutionError, "retention_shortened"):
            validate_aws_materialized(
                provider_result=self.provider_result,
                plan=self.plan,
                get_response=self._get_response(),
                retention_response=self._retention_response(NOW + timedelta(days=29)),
                materialized_path=self.provider_fixture.ciphertext,
                now=NOW + timedelta(minutes=5),
            )

    def test_plan_rejects_environment_identity_mismatch(self):
        target = self.provider_fixture.target("AWS_S3")
        with self.assertRaisesRegex(LiveR2ExecutionError, "aws_domain_key_mismatch"):
            build_aws_materialization_plan(
                provider_result=self.provider_result,
                expected_bucket=target["bucket"],
                expected_domain_key="wrong-domain",
                expected_account_scope_sha256=target["account_scope_sha256"],
                expected_account_id="123456789012",
                expected_region=target["region"],
            )

    def test_plan_rejects_non_content_addressed_key_even_when_provider_evidence_is_rehashed(self):
        bad = copy.deepcopy(self.provider_result)
        bad["ciphertext"]["key"] = "h205f22/r1/sha256/not-the-ciphertext.age"
        bad["provider_controller_evidence"]["key"] = bad["ciphertext"]["key"]
        _rehash_evidence_and_result(bad)
        target = self.provider_fixture.target("AWS_S3")
        with self.assertRaisesRegex(LiveR2ExecutionError, "aws_object_key_not_content_addressed"):
            build_aws_materialization_plan(
                provider_result=bad,
                expected_bucket=target["bucket"],
                expected_domain_key=target["domain_key"],
                expected_account_scope_sha256=target["account_scope_sha256"],
                expected_account_id="123456789012",
                expected_region=target["region"],
            )

    def test_plan_rejects_control_character_in_version_id_before_shell_transport(self):
        bad = copy.deepcopy(self.provider_result)
        version = "created-v1\nsecond-line"
        bad["ciphertext"]["version_id"] = version
        evidence = bad["provider_controller_evidence"]
        evidence["version_id"] = version
        evidence["put_response"]["VersionId"] = version
        evidence["head_response"]["VersionId"] = version
        evidence["get_response"]["VersionId"] = version
        _rehash_evidence_and_result(bad)
        target = self.provider_fixture.target("AWS_S3")
        with self.assertRaisesRegex(LiveR2ExecutionError, "aws_version_id_control_character"):
            build_aws_materialization_plan(
                provider_result=bad,
                expected_bucket=target["bucket"],
                expected_domain_key=target["domain_key"],
                expected_account_scope_sha256=target["account_scope_sha256"],
                expected_account_id="123456789012",
                expected_region=target["region"],
            )


if __name__ == "__main__":
    unittest.main()
