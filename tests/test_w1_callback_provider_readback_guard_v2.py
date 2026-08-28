from __future__ import annotations

import json
from pathlib import Path
import unittest

from controller.w1 import w1_callback_ingress_readiness_guard as readiness
from controller.w1 import w1_callback_provider_readback_guard as v1
from controller.w1 import w1_callback_provider_readback_guard_v2 as guard

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/w1-callback-protected-readback-v2.yml"


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
        "observed_at": "2026-08-28T06:30:00Z",
        "tables": tables,
        "functions": functions,
    }


def edge_metadata() -> dict:
    return {
        "id": "11111111-1111-1111-1111-111111111111",
        "slug": readiness.EDGE_SLUG,
        "name": readiness.EDGE_SLUG,
        "status": "ACTIVE",
        "version": 1,
        "verify_jwt": False,
        "ezbr_sha256": "a" * 64,
    }


def edge_inventory_present() -> list[dict]:
    meta = edge_metadata()
    return [{key: meta[key] for key in ("id", "slug", "name", "status", "version", "verify_jwt")}]


def edge_body(extra: bool = False) -> dict:
    files = [{"name": "index.ts", "content": v1.EDGE_SOURCE.read_text()}]
    if extra:
        files.append({"name": "hidden.ts", "content": "export {};"})
    return {"files": files}


def aws_present_raw(label: str, account: str = "123456789012") -> dict:
    name, _ = readiness.DOCUMENTS[label]
    local = json.loads(v1.DOCUMENT_SOURCE[label].read_text())
    inventory = {
        "DocumentIdentifiers": [{
            "Name": name,
            "Owner": account,
            "DocumentVersion": "1",
            "DocumentType": "Command",
            "DocumentFormat": "JSON",
            "PlatformTypes": ["Linux"],
        }]
    }
    describe = {"Document": {
        "Name": name,
        "Owner": account,
        "DocumentType": "Command",
        "DocumentVersion": "1",
        "LatestVersion": "1",
        "DefaultVersion": "1",
        "Status": "Active",
        "HashType": "Sha256",
        "Hash": "b" * 64,
    }}
    get = {
        "Name": name,
        "DocumentVersion": "1",
        "DocumentType": "Command",
        "Status": "Active",
        "Content": json.dumps(local, separators=(",", ":")),
    }
    permission = {"AccountIds": [], "AccountSharingInfoList": []}
    return {"inventory": inventory, "describe": describe, "get": get, "permission": permission}


def aws_all_present() -> dict:
    return {
        "account_id": "123456789012",
        "documents": {label: aws_present_raw(label) for label in readiness.DOCUMENTS},
    }


class CallbackProviderInventoryReadbackV2Tests(unittest.TestCase):
    def test_edge_authenticated_inventory_absence_becomes_not_ready(self):
        result = guard.compose(
            git_sha="1" * 40,
            tree_sha="2" * 40,
            db_value=db_ready(),
            edge_inventory=[],
            edge_metadata=None,
            edge_body=None,
            edge_observed_at="2026-08-28T06:30:01Z",
            aws_value=aws_all_present(),
            aws_observed_at="2026-08-28T06:30:02Z",
        )
        self.assertEqual(readiness.STATUS_NOT_READY, result["readiness"]["status"])
        self.assertIn("EDGE_FUNCTION_ABSENT", result["readiness"]["reasons"])
        self.assertTrue(result["absence_requires_authenticated_inventory"])
        self.assertFalse(result["provider_error_treated_as_absence"])
        self.assertFalse(result["authority_effect"])

    def test_edge_present_requires_inventory_metadata_and_exact_body(self):
        normalized = guard.normalize_edge_inventory(
            edge_inventory_present(), edge_metadata(), edge_body(), "2026-08-28T06:30:01Z"
        )
        self.assertTrue(normalized["present"])
        self.assertEqual(readiness.SOURCE_BLOBS["edge_index"], normalized["index_git_blob_sha"])
        with self.assertRaisesRegex(guard.ProviderInventoryReadbackError, "exact_file_set_required"):
            guard.normalize_edge_inventory(
                edge_inventory_present(), edge_metadata(), edge_body(extra=True), "2026-08-28T06:30:01Z"
            )

    def test_edge_inventory_metadata_drift_fails_closed(self):
        meta = edge_metadata(); meta["version"] = 2
        with self.assertRaisesRegex(guard.ProviderInventoryReadbackError, "version_mismatch"):
            guard.normalize_edge_inventory(
                edge_inventory_present(), meta, edge_body(), "2026-08-28T06:30:01Z"
            )

    def test_edge_absence_cannot_carry_detail_payload(self):
        with self.assertRaisesRegex(guard.ProviderInventoryReadbackError, "absent_with_detail_payload"):
            guard.normalize_edge_inventory([], {}, None, "2026-08-28T06:30:01Z")

    def test_aws_authenticated_inventory_absence_becomes_not_ready(self):
        raw = aws_all_present()
        raw["documents"]["key_enrollment"] = {"inventory": {"DocumentIdentifiers": []}}
        result = guard.compose(
            git_sha="1" * 40,
            tree_sha="2" * 40,
            db_value=db_ready(),
            edge_inventory=edge_inventory_present(),
            edge_metadata=edge_metadata(),
            edge_body=edge_body(),
            edge_observed_at="2026-08-28T06:30:01Z",
            aws_value=raw,
            aws_observed_at="2026-08-28T06:30:02Z",
        )
        self.assertEqual(readiness.STATUS_NOT_READY, result["readiness"]["status"])
        self.assertIn("AWS_DOCUMENT_ABSENT:key_enrollment", result["readiness"]["reasons"])

    def test_aws_prefix_inventory_ignores_nonexact_names_but_requires_exact_owned_document(self):
        raw = aws_all_present()
        label = "key_enrollment"
        expected = readiness.DOCUMENTS[label][0]
        raw["documents"][label] = {
            "inventory": {"DocumentIdentifiers": [{
                "Name": expected + "-Other", "Owner": "123456789012",
                "DocumentVersion": "1", "DocumentType": "Command"
            }]}
        }
        normalized = guard.normalize_aws_inventory(raw, "2026-08-28T06:30:02Z")
        self.assertFalse(normalized["documents"][label]["present"])

    def test_aws_present_inventory_requires_exact_owner_type_version_and_detail(self):
        for field, value, reason in (
            ("Owner", "999999999999", "inventory_owner_mismatch"),
            ("DocumentType", "Automation", "inventory_type_mismatch"),
            ("DocumentVersion", "2", "inventory_version_mismatch"),
        ):
            raw = aws_all_present()
            raw["documents"]["key_enrollment"]["inventory"]["DocumentIdentifiers"][0][field] = value
            with self.assertRaisesRegex(guard.ProviderInventoryReadbackError, reason):
                guard.normalize_aws_inventory(raw, "2026-08-28T06:30:02Z")

    def test_aws_inventory_pagination_must_be_complete(self):
        raw = aws_all_present()
        raw["documents"]["execution_marker"]["inventory"]["NextToken"] = "more"
        with self.assertRaisesRegex(guard.ProviderInventoryReadbackError, "pagination_incomplete"):
            guard.normalize_aws_inventory(raw, "2026-08-28T06:30:02Z")

    def test_aws_absence_cannot_be_inferred_from_error_payload(self):
        raw = aws_all_present()
        raw["documents"]["key_enrollment"] = {
            "inventory": {"Error": {"Code": "InvalidDocument"}}
        }
        with self.assertRaisesRegex(guard.ProviderInventoryReadbackError, "inventory_identifiers_invalid"):
            guard.normalize_aws_inventory(raw, "2026-08-28T06:30:02Z")

    def test_v2_full_present_path_remains_non_authority(self):
        result = guard.compose(
            git_sha="1" * 40,
            tree_sha="2" * 40,
            db_value=db_ready(),
            edge_inventory=edge_inventory_present(),
            edge_metadata=edge_metadata(),
            edge_body=edge_body(),
            edge_observed_at="2026-08-28T06:30:01Z",
            aws_value=aws_all_present(),
            aws_observed_at="2026-08-28T06:30:02Z",
        )
        self.assertEqual(readiness.STATUS_READY, result["readiness"]["status"])
        for field in (
            "database_mutation_authorized", "edge_deployment_authorized", "aws_mutation_authorized",
            "send_command_authorized", "worker_admitted", "w1_verified", "canonical", "authority_effect",
        ):
            self.assertIs(result[field], False, field)

    def test_workflow_uses_authenticated_inventories_and_no_package_manager_download(self):
        source = WORKFLOW.read_text()
        self.assertIn("/v1/projects/${SUPABASE_PROJECT_REF}/functions", source)
        self.assertIn("/v1/projects/${SUPABASE_PROJECT_REF}/functions/${EDGE_SLUG}/body", source)
        self.assertIn("aws ssm list-documents", source)
        self.assertIn("Key=Owner,Values=Self", source)
        self.assertIn("Key=Name,Values=\"$name\"", source)
        self.assertIn("ssm:ListDocuments", source)
        self.assertNotIn("npx ", source)
        self.assertNotIn("functions download", source)
        self.assertNotIn("InvalidDocument", source)
        for forbidden in (
            "ssm:SendCommand", "ec2:RebootInstances", "ssm:StartSession",
            "supabase functions deploy", "supabase db push", "edge_functions:write",
            "contents: write", "actions: write",
        ):
            self.assertNotIn(forbidden, source)

    def test_workflow_provider_reads_fail_on_transport_or_auth_error(self):
        source = WORKFLOW.read_text()
        edge = source.split("      - name: Capture Edge authenticated inventory", 1)[1]
        edge = edge.split("      - name: Build exact AWS read-only inline session policy", 1)[0]
        self.assertGreaterEqual(edge.count("curl --fail-with-body"), 3)
        aws = source.split("      - name: Capture AWS authenticated document inventories", 1)[1]
        aws = aws.split("      - name: Normalize authenticated provider readback", 1)[0]
        self.assertIn("set -euo pipefail", aws)
        self.assertNotIn("|| true", aws)


if __name__ == "__main__":
    unittest.main()
