from __future__ import annotations

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20260826061000_w1_codespaces_persistent_storage_receipt_v1.sql"
EXPECTED_PATH = "/workspaces/.metaengine-w1/persistent-sentinel.bin"


class CodespacesStorageDbContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.sql = MIGRATION.read_text(encoding="utf-8")
        cls.low = cls.sql.lower()

    def test_dependencies_are_fail_closed(self):
        for token in (
            "w1_storage_receipt_requires_lifecycle_v2",
            "w1_storage_receipt_requires_pre_persistence_manifest",
            "w1_storage_receipt_requires_evidence_canonicalizer",
            "w1_storage_receipt_requires_raw_stopped_snapshot",
        ):
            self.assertIn(token, self.low)

    def test_fixed_provider_persistent_path(self):
        self.assertIn(EXPECTED_PATH, self.sql)
        self.assertIn("persistent_root text not null check (persistent_root='/workspaces')", self.low)
        self.assertIn(f"sentinel_path text not null check (sentinel_path='{EXPECTED_PATH}')", self.low)
        self.assertIn("v_path_sha := encode(extensions.digest(convert_to(v_expected_path,'utf8'),'sha256'),'hex')", self.low)

    def test_storage_row_is_append_only_and_non_authority(self):
        for token in (
            "before update or delete",
            "w1_codespaces_storage_receipt_is_append_only",
            "provider_storage_contract_verified boolean not null default false check (provider_storage_contract_verified=false)",
            "authenticated_github_provenance_verified boolean not null default false check (authenticated_github_provenance_verified=false)",
            "persisted_readback_verified boolean not null default false check (persisted_readback_verified=false)",
            "persistent_worker_proof boolean not null default false check (persistent_worker_proof=false)",
            "worker_admitted boolean not null default false check (worker_admitted=false)",
            "w1_verified boolean not null default false check (w1_verified=false)",
            "canonical boolean not null default false check (canonical=false)",
            "authority_effect boolean not null default false check (authority_effect=false)",
        ):
            self.assertIn(token, self.low, token)

    def test_repeats_fresh_current_head_authority_gate(self):
        for token in (
            "compute_fabric_roadmap_status_h205f22()",
            "definition_integrity",
            "effective_status'='in_progress'",
            "state='active'",
            "expires_at>clock_timestamp()",
            "status='active'",
            "directive_kind in ('open','continue','reassign')",
            "w1_storage_receipt_fresh_claim_required",
            "w1_storage_receipt_fresh_directive_required",
            "w1_storage_receipt_semantic_head_mismatch",
        ):
            self.assertIn(token, self.low, token)

    def test_manifest_and_lifecycle_are_cross_bound(self):
        for token in (
            "lifecycle_receipt_id=v_manifest.lifecycle_receipt_id",
            "worker_id=v_manifest.worker_id",
            "provider_kind<>'github_codespaces'",
            "v_evidence->>'provider_object_id' is distinct from v_lifecycle.provider_object_id",
            "v_evidence#>>'{source,git_sha}' is distinct from v_manifest.source_git_sha",
            "v_evidence#>>'{source,tree_sha}' is distinct from v_manifest.source_tree_sha",
        ):
            self.assertIn(token, self.low, token)

    def test_boot_sentinel_and_provider_hashes_are_cross_bound(self):
        for token in (
            "{evidence,lifecycle,evidence,pre_boot_id}",
            "{evidence,lifecycle,evidence,post_boot_id}",
            "{evidence,lifecycle,evidence,sentinel_sha256}",
            "{evidence,provider,oracle_sha256}",
            "stopped_provider_snapshot_sha256",
            "{evidence,provider,evidence,stopped_snapshot_sha256}",
            "w1_storage_receipt_cross_binding_mismatch",
            "w1_storage_receipt_boot_id_unchanged",
        ):
            self.assertIn(token, self.low, token)

    def test_receipt_hash_is_recomputed_server_side(self):
        self.assertIn("compute_fabric_canonical_evidence_json_h205f22(v_evidence)", self.low)
        self.assertIn("w1_storage_receipt_hash_mismatch", self.low)
        self.assertIn("compute_fabric_canonical_evidence_json_h205f22(v.receipt->'evidence')", self.low)
        self.assertIn("recomputed_receipt_sha256", self.low)
        self.assertIn("recomputed_sentinel_path_sha256", self.low)
        self.assertIn("persisted_readback_match", self.low)

    def test_checks_must_exist_and_all_be_true(self):
        for token in (
            "persistent_root_is_workspaces",
            "sentinel_path_stable",
            "sentinel_path_hash_stable",
            "sentinel_content_stable",
            "source_identity_stable",
            "kernel_boot_id_changed",
            "provider_sequence_eligible",
        ):
            self.assertIn(token, self.low)
        self.assertIn("exists (select 1 from jsonb_each(v_checks) where value<>'true'::jsonb)", self.low)

    def test_ingest_and_readback_are_service_role_only(self):
        ingest = "public.h205f22_w1_codespaces_storage_receipt_ingest_v1(uuid,jsonb)"
        readback = "public.h205f22_w1_codespaces_storage_receipt_readback_v1(uuid)"
        for sig in (ingest, readback):
            self.assertIn(f"revoke all on function {sig} from public, anon, authenticated", self.low)
            self.assertIn(f"grant execute on function {sig} to service_role", self.low)
            self.assertNotIn(f"grant execute on function {sig} to authenticated", self.low)
            self.assertNotIn(f"grant execute on function {sig} to anon", self.low)

    def test_no_authority_shortcuts(self):
        for token in (
            "provider_storage_contract_verified=true",
            "authenticated_github_provenance_verified=true",
            "persisted_readback_verified=true",
            "persistent_worker_proof=true",
            "worker_admitted=true",
            "w1_verified=true",
            "canonical=true",
            "authority_effect=true",
            "grant all on table destruktion_meta.compute_fabric_w1_codespaces_storage_receipt_h205f22",
        ):
            self.assertNotIn(token, self.low, token)


if __name__ == "__main__":
    unittest.main()
