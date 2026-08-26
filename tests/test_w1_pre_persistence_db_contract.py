from __future__ import annotations

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
V2 = ROOT / "supabase/migrations/20260825023000_w1_provider_neutral_lifecycle_receipt_v2.sql"
STOPPED = ROOT / "supabase/migrations/20260825023500_w1_lifecycle_stopped_snapshot_guard_v1.sql"
V3 = ROOT / "supabase/migrations/20260826060000_w1_pre_persistence_evidence_manifest_v1.sql"
SOURCE_GUARD = ROOT / "supabase/migrations/20260826060500_w1_pre_persistence_source_binding_guard_v1.sql"
STOPPED_BRIDGE = ROOT / "supabase/migrations/20260826060600_w1_pre_persistence_stopped_snapshot_bridge_guard_v1.sql"
EXPECTED_S2 = "8c5570faaabb3b44056fc2954224036ae0d342c57d79053fceffb8ebefe1ecca"


def text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


class W1PrePersistenceDbContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.v2 = text(V2)
        cls.stopped = text(STOPPED)
        cls.v3 = text(V3)
        cls.guard = text(SOURCE_GUARD)
        cls.stopped_bridge = text(STOPPED_BRIDGE)
        cls.v2l = cls.v2.lower()
        cls.stoppedl = cls.stopped.lower()
        cls.v3l = cls.v3.lower()
        cls.guardl = cls.guard.lower()
        cls.stopped_bridgel = cls.stopped_bridge.lower()

    def test_dependency_chain_is_explicit(self):
        self.assertIn("compute_fabric_worker_lifecycle_receipt_v2_h205f22", self.v3)
        self.assertIn("compute_fabric_canonical_evidence_json_h205f22", self.v3)
        self.assertIn("w1_pre_persistence_requires_lifecycle_receipt_v2", self.v3)
        self.assertIn("w1_pre_persistence_requires_evidence_canonicalizer", self.v3)
        self.assertIn("w1_stopped_snapshot_requires_lifecycle_receipt_v2", self.stopped)
        self.assertIn("w1_source_binding_requires_pre_persistence_manifest_v1", self.guard)
        self.assertIn("w1_stopped_bridge_requires_pre_persistence_manifest_v1", self.stopped_bridge)
        self.assertIn("w1_stopped_bridge_requires_persisted_stopped_snapshot", self.stopped_bridge)

    def test_evidence_canonicalizer_allows_only_integral_numbers(self):
        self.assertIn("compute_fabric_canonical_evidence_json_h205f22", self.v2)
        self.assertIn("if v_type = 'number' then", self.v2l)
        self.assertIn("^-?(0|[1-9][0-9]*)$", self.v2)
        self.assertIn("non-integral numbers are forbidden", self.v2l)
        self.assertNotIn("create or replace function destruktion_meta.compute_fabric_canonical_json_h205f22", self.v2l)

    def test_raw_shutdown_snapshot_is_persisted_and_hashed(self):
        for token in (
            "stopped_provider_snapshot jsonb",
            "stopped_provider_snapshot_sha256 text",
            "evidence->'stopped_provider_snapshot'",
            "state' <> 'shutdown'",
            "w1_codespaces_raw_stopped_snapshot_required",
            "w1_codespaces_raw_stopped_snapshot_id_mismatch",
            "w1_codespaces_raw_stopped_snapshot_time_not_between",
            "compute_fabric_canonical_evidence_json_h205f22(v_stopped)",
            "v_pre_at < v_stop_at and v_stop_at < v_post_at",
        ):
            self.assertIn(token, self.stoppedl, token)

    def test_lifecycle_v2_becomes_append_only(self):
        self.assertIn("before update or delete", self.stoppedl)
        self.assertIn("w1_lifecycle_receipt_v2_is_append_only", self.stoppedl)

    def test_manifest_is_append_only_and_non_authority(self):
        required = (
            "before update or delete",
            "w1_pre_persistence_manifest_is_append_only",
            "verification_status text not null default 'pending_persisted_readback'",
            "authenticated_provenance_verified boolean not null default false check (authenticated_provenance_verified=false)",
            "persisted_readback_verified boolean not null default false check (persisted_readback_verified=false)",
            "persistent_worker_proof boolean not null default false check (persistent_worker_proof=false)",
            "worker_admitted boolean not null default false check (worker_admitted=false)",
            "w1_verified boolean not null default false check (w1_verified=false)",
            "canonical boolean not null default false check (canonical=false)",
            "authority_effect boolean not null default false check (authority_effect=false)",
        )
        for token in required:
            self.assertIn(token, self.v3l, token)

    def test_ingest_requires_fresh_current_head_authority(self):
        required = (
            "compute_fabric_roadmap_status_h205f22()",
            "definition_integrity",
            "effective_status'='in_progress'",
            "state='active'",
            "expires_at>clock_timestamp()",
            "base_checkpoint_id=v_head",
            "status='active'",
            "directive_kind in ('open','continue','reassign')",
            "w1_pre_persistence_fresh_claim_required",
            "w1_pre_persistence_fresh_directive_required",
            "w1_pre_persistence_claim_predates_directive",
        )
        for token in required:
            self.assertIn(token, self.v3l, token)

    def test_ingest_is_service_role_only(self):
        sig = "public.h205f22_w1_pre_persistence_manifest_ingest_v1(text,uuid,bigint,bigint,jsonb,jsonb,jsonb)"
        self.assertIn(f"revoke all on function {sig} from public, anon, authenticated", self.v3l)
        self.assertIn(f"grant execute on function {sig} to service_role", self.v3l)
        self.assertNotIn(f"grant execute on function {sig} to authenticated", self.v3l)
        self.assertNotIn(f"grant execute on function {sig} to anon", self.v3l)

    def test_exact_s2_pass_and_server_hash_recomputation_are_required(self):
        self.assertIn(EXPECTED_S2, self.v3)
        for token in (
            "pass_nonauthority",
            "w1_pre_persistence_s2_receipt_hash_mismatch",
            "w1_pre_persistence_lifecycle_evidence_hash_mismatch",
            "w1_pre_persistence_outer_cgroup_path_hash_mismatch",
            "w1_pre_persistence_manifest_hash_mismatch",
            "compute_fabric_canonical_evidence_json_h205f22(v_s2_receipt->'evidence')",
            "compute_fabric_canonical_evidence_json_h205f22(p_outer_cgroup_witness)",
            "compute_fabric_canonical_evidence_json_h205f22(v_bindings)",
        ):
            self.assertIn(token, self.v3l, token)

    def test_provider_pre_post_persisted_bridge_is_required(self):
        for token in (
            "w1_pre_persistence_provider_persisted_bridge_mismatch",
            "pre_provider_snapshot_sha256",
            "post_provider_snapshot_sha256",
            "provider_object_id",
            "github_codespaces",
            "stop_resume",
        ):
            self.assertIn(token, self.v3l, token)

    def test_provider_shutdown_persisted_bridge_is_required(self):
        for token in (
            "stopped_provider_snapshot_sha256",
            "{evidence,provider,evidence,stopped_snapshot_sha256}",
            "w1_stopped_bridge_hash_mismatch",
            "w1_stopped_bridge_persisted_snapshot_missing",
        ):
            self.assertIn(token, self.stopped_bridgel, token)

    def test_outer_cgroup_witness_is_exact_and_prebound(self):
        for token in (
            "prebound_exact_cgroup_kill_write_only",
            "prebound_before_sudo",
            "sudo_before_exact_binding",
            "exact_target_valid",
            "tree_kill_proven",
            "post_unpopulated",
            "pre_processes_gone",
            "docker_running_after",
            "pre_process_count",
        ):
            self.assertIn(token, self.v3l, token)

    def test_source_identity_is_bound_to_lifecycle_evidence(self):
        self.assertIn("compute_fabric_w1_pre_persistence_source_binding_h205f22", self.guard)
        self.assertIn("source_git_sha = lifecycle_bundle#>>'{evidence,source,git_sha}'", self.guardl)
        self.assertIn("source_tree_sha = lifecycle_bundle#>>'{evidence,source,tree_sha}'", self.guardl)

    def test_readback_recomputes_persisted_hashes_but_stays_non_authority(self):
        for token in (
            "h205f22_w1_pre_persistence_manifest_readback_v1",
            "recomputed_lifecycle_bundle_sha256",
            "recomputed_outer_cgroup_witness_sha256",
            "recomputed_manifest_sha256",
            "persisted_readback_match",
            "'persisted_readback_verified',false",
            "'w1_verified',false",
            "'canonical',false",
            "'authority_effect',false",
        ):
            self.assertIn(token, self.v3l, token)

    def test_no_authority_shortcuts_or_broad_grants(self):
        forbidden = (
            "w1_verified=true",
            "worker_admitted=true",
            "authority_effect=true",
            "canonical=true",
            "accepted=true",
            "grant all on table destruktion_meta.compute_fabric_w1_pre_persistence_manifest_h205f22",
            "grant execute on function public.h205f22_w1_pre_persistence_manifest_ingest_v1(text,uuid,bigint,bigint,jsonb,jsonb,jsonb) to authenticated",
            "grant execute on function public.h205f22_w1_pre_persistence_manifest_ingest_v1(text,uuid,bigint,bigint,jsonb,jsonb,jsonb) to anon",
        )
        combined = "\n".join((self.v3l, self.guardl, self.stoppedl, self.stopped_bridgel))
        for token in forbidden:
            self.assertNotIn(token, combined, token)


if __name__ == "__main__":
    unittest.main()
