from __future__ import annotations

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20260826061500_w1_github_codespaces_provenance_receipt_v1.sql"


class CodespacesProvenanceDbContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.sql = MIGRATION.read_text(encoding="utf-8")
        cls.low = cls.sql.lower()

    def test_dependencies_are_explicit(self):
        for token in (
            "w1_provenance_requires_lifecycle_v2",
            "w1_provenance_requires_pre_persistence_manifest",
            "w1_provenance_requires_storage_receipt",
            "w1_provenance_requires_evidence_canonicalizer",
        ):
            self.assertIn(token, self.low)

    def test_exact_github_api_contract_is_pinned(self):
        for token in (
            "api_version text not null check (api_version='2026-03-10')",
            "https://api.github.com",
            "application/vnd.github+json",
            "https_default_ca_hostname_validation",
            "v_base_url||'/stop'",
            "v_base_url||'/start'",
        ):
            self.assertIn(token, self.low)

    def test_five_successful_observations_are_required(self):
        for token in (
            "observations,pre_get",
            "observations,stop_post",
            "observations,stopped_get",
            "observations,start_post",
            "observations,post_get",
            "w1_provenance_observation_http_invalid",
            "w1_provenance_observation_endpoint_invalid",
            "w1_provenance_get_snapshot_hash_mismatch",
        ):
            self.assertIn(token, self.low)
        self.assertIn("(v_obs->>'http_status')::int<>200", self.low)

    def test_raw_snapshot_hashes_cross_bind_to_lifecycle_and_storage(self):
        for token in (
            "pre_provider_snapshot_sha256",
            "stopped_provider_snapshot_sha256",
            "post_provider_snapshot_sha256",
            "v_storage.stopped_snapshot_sha256",
            "w1_provenance_snapshot_bridge_mismatch",
        ):
            self.assertIn(token, self.low)

    def test_provider_oracle_is_recomputed_and_cross_bound(self):
        for token in (
            "compute_fabric_canonical_evidence_json_h205f22(v_oracle_evidence)",
            "w1_provenance_provider_oracle_hash_mismatch",
            "v_storage.receipt#>>'{evidence,provider_oracle_sha256}'",
            "recomputed_provider_oracle_sha256",
        ):
            self.assertIn(token, self.low)

    def test_receipt_hash_is_server_recomputed(self):
        self.assertIn("compute_fabric_canonical_evidence_json_h205f22(v_evidence)", self.low)
        self.assertIn("w1_provenance_receipt_hash_mismatch", self.low)
        self.assertIn("recomputed_receipt_sha256", self.low)
        self.assertIn("persisted_readback_match", self.low)

    def test_fresh_authority_is_repeated_at_persistence_boundary(self):
        for token in (
            "compute_fabric_roadmap_status_h205f22()",
            "definition_integrity",
            "effective_status'='in_progress'",
            "state='active'",
            "expires_at>clock_timestamp()",
            "status='active'",
            "directive_kind in ('open','continue','reassign')",
            "w1_provenance_fresh_claim_required",
            "w1_provenance_fresh_directive_required",
            "w1_provenance_semantic_head_mismatch",
        ):
            self.assertIn(token, self.low)

    def test_table_is_append_only_and_nonauthority(self):
        for token in (
            "before update or delete",
            "w1_codespaces_provenance_receipt_is_append_only",
            "provider_identity_verified boolean not null default false check (provider_identity_verified=false)",
            "provider_action_verified boolean not null default false check (provider_action_verified=false)",
            "authenticated_provider_provenance_verified boolean not null default false check (authenticated_provider_provenance_verified=false)",
            "persisted_readback_verified boolean not null default false check (persisted_readback_verified=false)",
            "persistent_worker_proof boolean not null default false check (persistent_worker_proof=false)",
            "worker_admitted boolean not null default false check (worker_admitted=false)",
            "w1_verified boolean not null default false check (w1_verified=false)",
            "canonical boolean not null default false check (canonical=false)",
            "authority_effect boolean not null default false check (authority_effect=false)",
        ):
            self.assertIn(token, self.low)

    def test_token_material_must_be_declared_unpersisted(self):
        self.assertIn("token_material_persisted", self.low)
        self.assertIn("coalesce((v_evidence->>'token_material_persisted')::boolean,true)", self.low)

    def test_ingest_readback_are_service_role_only(self):
        for sig in (
            "public.h205f22_w1_codespaces_provenance_ingest_v1(uuid,jsonb)",
            "public.h205f22_w1_codespaces_provenance_readback_v1(uuid)",
        ):
            self.assertIn(f"revoke all on function {sig} from public, anon, authenticated", self.low)
            self.assertIn(f"grant execute on function {sig} to service_role", self.low)
            self.assertNotIn(f"grant execute on function {sig} to authenticated", self.low)
            self.assertNotIn(f"grant execute on function {sig} to anon", self.low)

    def test_no_authority_shortcuts(self):
        for token in (
            "provider_identity_verified=true",
            "provider_action_verified=true",
            "authenticated_provider_provenance_verified=true",
            "persisted_readback_verified=true",
            "provider_storage_contract_verified=true",
            "persistent_worker_proof=true",
            "worker_admitted=true",
            "w1_verified=true",
            "canonical=true",
            "authority_effect=true",
        ):
            self.assertNotIn(token, self.low, token)


if __name__ == "__main__":
    unittest.main()
