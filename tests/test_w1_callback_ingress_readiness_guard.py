from __future__ import annotations

import copy
from pathlib import Path
import unittest

from controller.w1 import w1_callback_ingress_readiness_guard as guard

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/w1-callback-ingress-readiness-contract.yml"


def table(name: str) -> dict:
    return {
        "present": True,
        "schema": "public",
        "rls_enabled": True,
        "privileges": {
            "public": [],
            "anon": [],
            "authenticated": [],
            "service_role": ["SELECT", "INSERT"],
        },
        "service_role_column_updates": ["revoked_at"] if name == guard.KEY_TABLE else [],
    }


def fn(label: str) -> dict:
    return {
        "present": True,
        "schema": "public",
        "identity": guard.FUNCTIONS[label],
        "security_definer": False,
        "execute": {"public": False, "anon": False, "authenticated": False, "service_role": True},
    }


def document(label: str) -> dict:
    name, blob = guard.DOCUMENTS[label]
    return {
        "present": True,
        "name": name,
        "owner_account_id": "123456789012",
        "document_version": "1",
        "latest_version": "1",
        "default_version": "1",
        "status": "Active",
        "hash_type": "Sha256",
        "hash": "a" * 64,
        "content_git_blob_sha": blob,
    }


def ready_input() -> dict:
    return {
        "schema": guard.INPUT_SCHEMA,
        "source": {
            "git_sha": "1" * 40,
            "tree_sha": "2" * 40,
            "artifacts": copy.deepcopy(guard.SOURCE_BLOBS),
        },
        "db": {
            "provenance_class": guard.PROTECTED_DB,
            "observed_at": "2026-08-28T04:30:00Z",
            "tables": {guard.KEY_TABLE: table(guard.KEY_TABLE), guard.RECEIPT_TABLE: table(guard.RECEIPT_TABLE)},
            "functions": {label: fn(label) for label in guard.FUNCTIONS},
        },
        "edge": {
            "provenance_class": guard.PROTECTED_EDGE,
            "observed_at": "2026-08-28T04:30:01Z",
            "present": True,
            "slug": guard.EDGE_SLUG,
            "status": "ACTIVE",
            "verify_jwt": False,
            "version": 1,
            "index_git_blob_sha": guard.SOURCE_BLOBS["edge_index"],
        },
        "aws": {
            "provenance_class": guard.PROTECTED_AWS,
            "observed_at": "2026-08-28T04:30:02Z",
            "account_id": "123456789012",
            "documents": {label: document(label) for label in guard.DOCUMENTS},
        },
    }


class CallbackIngressReadinessTests(unittest.TestCase):
    def test_full_synthetic_readback_is_only_non_authority_candidate(self):
        result = guard.evaluate(ready_input())
        self.assertEqual(guard.STATUS_READY, result["status"])
        self.assertTrue(result["ready_candidate"])
        self.assertEqual([], result["reasons"])
        for surface in result["evidence"]["surface_readiness"].values():
            self.assertTrue(surface["ready"])
        for field in (
            "live_provider_readback_cryptographically_verified_by_guard",
            "database_mutation_authorized", "edge_deployment_authorized", "aws_mutation_authorized",
            "send_command_authorized", "provider_identity_verified", "persistent_worker_proof",
            "worker_admitted", "w1_verified", "canonical", "authority_effect",
        ):
            self.assertIs(result[field], False, field)
        self.assertTrue(result["provenance_labels_are_self_asserted"])

    def test_source_blob_drift_fails_closed(self):
        payload = ready_input()
        payload["source"]["artifacts"]["edge_index"] = "f" * 40
        result = guard.evaluate(payload)
        self.assertEqual(guard.STATUS_NOT_READY, result["status"])
        self.assertIn("SOURCE_BLOB_MISMATCH:edge_index", result["reasons"])

    def test_absent_live_surfaces_report_not_ready(self):
        payload = ready_input()
        for name in payload["db"]["tables"]:
            payload["db"]["tables"][name]["present"] = False
        for label in payload["db"]["functions"]:
            payload["db"]["functions"][label]["present"] = False
        payload["edge"]["present"] = False
        for label in payload["aws"]["documents"]:
            payload["aws"]["documents"][label]["present"] = False
        result = guard.evaluate(payload)
        self.assertEqual(guard.STATUS_NOT_READY, result["status"])
        self.assertFalse(result["ready_candidate"])
        self.assertIn("EDGE_FUNCTION_ABSENT", result["reasons"])
        self.assertIn(f"DB_TABLE_ABSENT:{guard.KEY_TABLE}", result["reasons"])
        self.assertIn("AWS_DOCUMENT_ABSENT:key_enrollment", result["reasons"])

    def test_public_or_authenticated_database_privilege_fails(self):
        payload = ready_input()
        payload["db"]["tables"][guard.KEY_TABLE]["privileges"]["anon"] = ["SELECT"]
        payload["db"]["functions"]["record_callback"]["execute"]["authenticated"] = True
        result = guard.evaluate(payload)
        self.assertIn(f"DB_EXPOSED_TABLE_PRIVILEGE:{guard.KEY_TABLE}:anon", result["reasons"])
        self.assertIn("DB_EXPOSED_FUNCTION_EXECUTE:record_callback:authenticated", result["reasons"])

    def test_service_role_privilege_widening_fails(self):
        payload = ready_input()
        payload["db"]["tables"][guard.RECEIPT_TABLE]["privileges"]["service_role"].append("UPDATE")
        payload["db"]["tables"][guard.KEY_TABLE]["service_role_column_updates"].append("public_jwk")
        result = guard.evaluate(payload)
        self.assertIn(f"DB_SERVICE_TABLE_PRIVILEGES_MISMATCH:{guard.RECEIPT_TABLE}", result["reasons"])
        self.assertIn(f"DB_SERVICE_COLUMN_UPDATE_MISMATCH:{guard.KEY_TABLE}", result["reasons"])

    def test_security_definer_fails(self):
        payload = ready_input()
        payload["db"]["functions"]["get_key"]["security_definer"] = True
        result = guard.evaluate(payload)
        self.assertIn("DB_SECURITY_DEFINER_FORBIDDEN:get_key", result["reasons"])

    def test_edge_contract_is_exact(self):
        mutations = [
            ("slug", "other"),
            ("status", "INACTIVE"),
            ("verify_jwt", True),
            ("index_git_blob_sha", "e" * 40),
        ]
        expected = ["EDGE_SLUG_MISMATCH", "EDGE_NOT_ACTIVE", "EDGE_VERIFY_JWT_MUST_BE_FALSE_FOR_SIGNED_WEBHOOK", "EDGE_SOURCE_BLOB_MISMATCH"]
        for (field, value), reason in zip(mutations, expected):
            payload = ready_input()
            payload["edge"][field] = value
            self.assertIn(reason, guard.evaluate(payload)["reasons"], field)

    def test_aws_version_owner_hash_or_content_drift_fails(self):
        cases = [
            ("document_version", "2", "AWS_DOCUMENT_VERSION_MISMATCH:key_enrollment:document_version"),
            ("owner_account_id", "999999999999", "AWS_DOCUMENT_OWNER_MISMATCH:key_enrollment"),
            ("hash_type", "Sha1", "AWS_DOCUMENT_HASH_INVALID:key_enrollment"),
            ("content_git_blob_sha", "f" * 40, "AWS_DOCUMENT_CONTENT_MISMATCH:key_enrollment"),
        ]
        for field, value, reason in cases:
            payload = ready_input()
            payload["aws"]["documents"]["key_enrollment"][field] = value
            self.assertIn(reason, guard.evaluate(payload)["reasons"], field)

    def test_provenance_labels_are_required_but_never_authority(self):
        payload = ready_input()
        payload["db"]["provenance_class"] = "CALLER_SUPPLIED"
        payload["edge"]["provenance_class"] = "CALLER_SUPPLIED"
        payload["aws"]["provenance_class"] = "CALLER_SUPPLIED"
        result = guard.evaluate(payload)
        self.assertIn("DB_PROVENANCE_NOT_PROTECTED", result["reasons"])
        self.assertIn("EDGE_PROVENANCE_NOT_PROTECTED", result["reasons"])
        self.assertIn("AWS_PROVENANCE_NOT_PROTECTED", result["reasons"])
        self.assertFalse(result["authority_effect"])

    def test_input_shape_and_types_fail_closed(self):
        payload = ready_input()
        payload["extra"] = True
        with self.assertRaisesRegex(guard.ReadinessError, "input_shape_invalid"):
            guard.evaluate(payload)
        payload = ready_input()
        payload["edge"]["verify_jwt"] = "false"
        with self.assertRaisesRegex(guard.ReadinessError, "edge_verify_jwt_not_boolean"):
            guard.evaluate(payload)

    def test_workflow_is_least_privilege_and_no_live_mutation(self):
        source = WORKFLOW.read_text()
        self.assertIn("permissions:\n  contents: read", source)
        self.assertIn("persist-credentials: false", source)
        for forbidden in (
            "aws-actions/configure-aws-credentials",
            "id-token: write",
            "contents: write",
            "supabase db push",
            "supabase functions deploy",
            "ssm send-command",
            "start-session",
        ):
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
