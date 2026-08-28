from __future__ import annotations

import copy
import json
from pathlib import Path
import re
import unittest

from controller.w1 import w1_callback_ingress_readiness_guard as readiness
from controller.w1 import w1_callback_provider_readback_guard as guard

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/w1-callback-protected-readback.yml"
SQL = ROOT / "controller/w1/w1_callback_db_readback.sql"


def db_ready() -> dict:
    tables = {}
    for name in (readiness.KEY_TABLE, readiness.RECEIPT_TABLE):
        tables[name] = {
            "present": True,
            "schema": "public",
            "rls_enabled": True,
            "privileges": {
                "public": [], "anon": [], "authenticated": [],
                "service_role": ["INSERT", "SELECT"],
            },
            "service_role_column_updates": ["revoked_at"] if name == readiness.KEY_TABLE else [],
        }
    functions = {}
    for label, identity in readiness.FUNCTIONS.items():
        functions[label] = {
            "present": True,
            "schema": "public",
            "identity": identity,
            "security_definer": False,
            "execute": {"public": False, "anon": False, "authenticated": False, "service_role": True},
        }
    return {
        "provenance_class": readiness.PROTECTED_DB,
        "observed_at": "2026-08-28T04:40:00.000000Z",
        "tables": tables,
        "functions": functions,
    }


def edge_metadata() -> dict:
    return {
        "id": "f" * 36,
        "slug": readiness.EDGE_SLUG,
        "name": readiness.EDGE_SLUG,
        "status": "ACTIVE",
        "version": 1,
        "verify_jwt": False,
        "ezbr_sha256": "a" * 64,
    }


def aws_doc(label: str, account: str = "123456789012") -> dict:
    name, _ = readiness.DOCUMENTS[label]
    content = (guard.DOCUMENT_SOURCE[label]).read_text()
    description = {
        "Name": name,
        "Owner": account,
        "DocumentType": "Command",
        "DocumentVersion": "1",
        "LatestVersion": "1",
        "DefaultVersion": "1",
        "Status": "Active",
        "HashType": "Sha256",
        "Hash": "b" * 64,
    }
    return {
        "describe": {"Document": description},
        "get": {
            "Name": name,
            "DocumentVersion": "1",
            "DocumentType": "Command",
            "Status": "Active",
            "Content": json.dumps(json.loads(content), separators=(",", ":")),
        },
        "permission": {"AccountIds": [], "AccountSharingInfoList": []},
    }


def aws_ready() -> dict:
    return {
        "account_id": "123456789012",
        "documents": {label: aws_doc(label) for label in readiness.DOCUMENTS},
    }


class CallbackProviderReadbackGuardTests(unittest.TestCase):
    def test_reviewed_artifact_hashes_match_readiness_contract(self):
        self.assertEqual(readiness.SOURCE_BLOBS, guard.reviewed_artifacts())

    def test_full_protected_synthetic_readback_stays_non_authority(self):
        result = guard.compose(
            git_sha="1" * 40,
            tree_sha="2" * 40,
            db_value=db_ready(),
            edge_metadata=edge_metadata(),
            edge_source=guard.EDGE_SOURCE.read_bytes(),
            edge_observed_at="2026-08-28T04:40:01Z",
            aws_value=aws_ready(),
            aws_observed_at="2026-08-28T04:40:02Z",
        )
        self.assertEqual(guard.SCHEMA, result["schema"])
        self.assertEqual(readiness.STATUS_READY, result["readiness"]["status"])
        self.assertTrue(result["readiness"]["ready_candidate"])
        for field in (
            "database_mutation_authorized", "edge_deployment_authorized", "aws_mutation_authorized",
            "send_command_authorized", "worker_admitted", "w1_verified", "canonical", "authority_effect",
        ):
            self.assertIs(result[field], False, field)
        self.assertFalse(result["raw_provider_secrets_persisted"])

    def test_edge_source_byte_drift_fails_closed(self):
        with self.assertRaisesRegex(guard.ProviderReadbackError, "edge_source_bytes_mismatch"):
            guard.compose(
                git_sha="1" * 40, tree_sha="2" * 40, db_value=db_ready(),
                edge_metadata=edge_metadata(), edge_source=guard.EDGE_SOURCE.read_bytes() + b"\n// drift\n",
                edge_observed_at="2026-08-28T04:40:01Z", aws_value=aws_ready(),
                aws_observed_at="2026-08-28T04:40:02Z")

    def test_edge_verify_jwt_or_state_drift_fails_closed(self):
        for field, value, reason in (
            ("verify_jwt", True, "edge_verify_jwt_mismatch"),
            ("status", "INACTIVE", "edge_not_active"),
            ("slug", "other", "edge_slug_mismatch"),
        ):
            meta = edge_metadata(); meta[field] = value
            with self.assertRaisesRegex(guard.ProviderReadbackError, reason):
                guard.normalize_edge(meta, guard.EDGE_SOURCE.read_bytes(), "2026-08-28T04:40:01Z")

    def test_aws_document_sharing_is_forbidden(self):
        value = aws_ready()
        value["documents"]["key_enrollment"]["permission"]["AccountIds"] = ["all"]
        with self.assertRaisesRegex(guard.ProviderReadbackError, "aws_key_enrollment_document_shared"):
            guard.normalize_aws(value, "2026-08-28T04:40:02Z")
        value = aws_ready()
        value["documents"]["execution_marker"]["permission"]["AccountSharingInfoList"] = [
            {"AccountId": "999999999999", "SharedDocumentVersion": "1"}
        ]
        with self.assertRaisesRegex(guard.ProviderReadbackError, "aws_execution_marker_document_shared"):
            guard.normalize_aws(value, "2026-08-28T04:40:02Z")

    def test_aws_owner_version_hash_and_content_fail_closed(self):
        cases = [
            ("Owner", "999999999999", "owner_mismatch"),
            ("LatestVersion", "2", "LatestVersion_mismatch"),
            ("DefaultVersion", "2", "DefaultVersion_mismatch"),
            ("DocumentVersion", "2", "DocumentVersion_mismatch"),
            ("HashType", "Sha1", "hash_invalid"),
        ]
        for field, value, reason in cases:
            raw = aws_ready()
            raw["documents"]["key_enrollment"]["describe"]["Document"][field] = value
            with self.assertRaisesRegex(guard.ProviderReadbackError, reason):
                guard.normalize_aws(raw, "2026-08-28T04:40:02Z")
        raw = aws_ready()
        content = json.loads(raw["documents"]["key_enrollment"]["get"]["Content"])
        content["description"] += " tampered"
        raw["documents"]["key_enrollment"]["get"]["Content"] = json.dumps(content)
        with self.assertRaisesRegex(guard.ProviderReadbackError, "content_mismatch"):
            guard.normalize_aws(raw, "2026-08-28T04:40:02Z")

    def test_permission_pagination_fails_closed(self):
        raw = aws_ready()
        raw["documents"]["key_enrollment"]["permission"]["NextToken"] = "more"
        with self.assertRaisesRegex(guard.ProviderReadbackError, "permission_pagination_forbidden"):
            guard.normalize_aws(raw, "2026-08-28T04:40:02Z")

    def test_database_exposure_is_preserved_as_not_ready(self):
        db = db_ready()
        db["tables"][readiness.KEY_TABLE]["privileges"]["anon"] = ["SELECT"]
        result = guard.compose(
            git_sha="1" * 40, tree_sha="2" * 40, db_value=db,
            edge_metadata=edge_metadata(), edge_source=guard.EDGE_SOURCE.read_bytes(),
            edge_observed_at="2026-08-28T04:40:01Z", aws_value=aws_ready(),
            aws_observed_at="2026-08-28T04:40:02Z")
        self.assertEqual(readiness.STATUS_NOT_READY, result["readiness"]["status"])
        self.assertIn(f"DB_EXPOSED_TABLE_PRIVILEGE:{readiness.KEY_TABLE}:anon",
                      result["readiness"]["reasons"])

    def test_db_sql_is_single_read_only_catalog_readback(self):
        source = SQL.read_text()
        self.assertIn("BEGIN READ ONLY;", source)
        self.assertIn("statement_timestamp()", source)
        self.assertIn("has_table_privilege", source)
        self.assertIn("has_column_privilege", source)
        self.assertIn("has_function_privilege", source)
        self.assertIn("aclexplode", source)
        self.assertIn("COMMIT;", source)
        mutation = re.compile(r"(?im)^\s*(insert|update|delete|create|alter|drop|truncate|grant|revoke|call|do)\b")
        self.assertIsNone(mutation.search(source))

    def test_protected_workflow_is_manual_main_only_and_read_only(self):
        source = WORKFLOW.read_text()
        self.assertIn("READBACK_W1_CALLBACK_ONLY", source)
        self.assertIn("[[ \"$GITHUB_REF\" == 'refs/heads/main' ]]", source)
        self.assertIn("environment: w1-callback-readback", source)
        self.assertEqual(1, source.count("id-token: write"))
        self.assertIn("W1_AWS_READBACK_ROLE_ARN", source)
        self.assertIn("W1_SUPABASE_DB_READONLY_URL", source)
        self.assertIn("W1_SUPABASE_MGMT_READ_TOKEN", source)
        self.assertIn("allowed-account-ids: ${{ vars.W1_AWS_ACCOUNT_ID }}", source)
        self.assertIn("role-duration-seconds: 900", source)
        self.assertIn("output-env-credentials: false", source)
        self.assertIn("output-credentials: true", source)
        self.assertIn("inline-session-policy: ${{ steps.aws-policy.outputs.policy }}", source)
        for action in ("ssm:DescribeDocument", "ssm:GetDocument", "ssm:DescribeDocumentPermission"):
            self.assertIn(action, source)
        for forbidden in (
            "ssm:SendCommand", "ec2:RebootInstances", "ssm:StartSession",
            "supabase functions deploy", "supabase db push", "edge_functions:write",
            "contents: write", "actions: write",
        ):
            self.assertNotIn(forbidden, source)
        self.assertNotRegex(source, r"curl[^\n]+(?:--request|-X)\s+(?:POST|PUT|PATCH|DELETE)")

    def test_oidc_claims_are_validated_before_aws_sts(self):
        source = WORKFLOW.read_text()
        oidc = source.split("      - name: Validate actual GitHub OIDC claims before AWS STS", 1)[1]
        oidc = oidc.split("      - name: Capture Postgres callback privilege state", 1)[0]
        self.assertIn("ACTIONS_ID_TOKEN_REQUEST_URL", oidc)
        self.assertIn("ACTIONS_ID_TOKEN_REQUEST_TOKEN", oidc)
        self.assertIn("audience=sts.amazonaws.com", oidc)
        self.assertIn("'aud':'sts.amazonaws.com'", oidc)
        self.assertIn("'sub':os.environ['AWS_OIDC_SUB']", oidc)
        self.assertIn("'repository':'PatrickFrome/Compute'", oidc)
        self.assertIn("'repository_id':'1341371143'", oidc)
        self.assertIn("'repository_owner_id':'20597814'", oidc)
        self.assertIn("'environment':'w1-callback-readback'", oidc)
        self.assertIn("'ref':'refs/heads/main'", oidc)
        self.assertIn("rm -f evidence/github-oidc-token-response.json", oidc)
        self.assertNotIn("print(token)", oidc)
        self.assertLess(source.index("Validate actual GitHub OIDC claims before AWS STS"),
                        source.index("Configure 15-minute AWS OIDC read-only credentials"))

    def test_aws_credentials_are_scoped_to_capture_step_only(self):
        source = WORKFLOW.read_text()
        capture = source.split("      - name: Capture exact AWS SSM document readback", 1)[1]
        post = capture.split("      - name: Normalize readback after AWS credentials leave scope", 1)[1]
        self.assertIn("steps.aws-creds.outputs.aws-access-key-id", capture.split("      - name: Normalize", 1)[0])
        self.assertNotIn("steps.aws-creds.outputs", post)


if __name__ == "__main__":
    unittest.main()
