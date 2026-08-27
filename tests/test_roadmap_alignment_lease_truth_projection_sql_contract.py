from __future__ import annotations

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase" / "migrations" / "20260827202500_roadmap_alignment_lease_truth_projection_v2.sql"


class RoadmapAlignmentLeaseTruthProjectionSqlContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = MIGRATION.read_text(encoding="utf-8")
        cls.lower = cls.source.lower()

    def test_preserves_legacy_function_for_forensic_readback(self):
        self.assertIn("rename to compute_fabric_roadmap_alignment_status_h205f22_legacy_v1", self.lower)
        self.assertIn("compute_fabric_roadmap_alignment_status_h205f22_legacy_v1()", self.lower)

    def test_wrapper_uses_statement_time_once(self):
        self.assertIn("v_observed_at timestamptz := statement_timestamp()", self.lower)
        self.assertNotIn("clock_timestamp()", self.lower)

    def test_fresh_claim_projection_is_ttl_aware(self):
        self.assertIn("c.state = 'active'", self.lower)
        self.assertIn("c.expires_at > v_observed_at", self.lower)
        self.assertIn("c.heartbeat_at <= v_observed_at", self.lower)
        self.assertIn("c.heartbeat_at < c.expires_at", self.lower)

    def test_stale_claims_are_observable_but_non_authoritative(self):
        self.assertIn("stale_persisted_active_claims", self.lower)
        self.assertIn("'stale_rows_authority_effect', false", self.lower)
        self.assertIn("'cleanup_required'", self.lower)

    def test_raw_in_progress_without_fresh_claim_projects_to_planned(self):
        self.assertIn("when m.status = 'in_progress' and not exists", self.lower)
        self.assertIn("then 'planned'", self.lower)

    def test_claim_id_is_exposed_as_monotonic_fence(self):
        self.assertIn("'lease_fence', c.claim_id", self.lower)
        self.assertIn("claim_id_monotonic_sequencer", self.lower)

    def test_existing_acl_is_not_widened(self):
        self.assertIn("revoke all on function destruktion_meta.compute_fabric_roadmap_alignment_status_h205f22() from public", self.lower)
        self.assertIn("grant execute on function destruktion_meta.compute_fabric_roadmap_alignment_status_h205f22() to service_role", self.lower)
        self.assertNotIn(" to anon", self.lower)
        self.assertNotIn(" to authenticated", self.lower)

    def test_no_persisted_lease_state_is_mutated(self):
        for forbidden in (
            "update destruktion_meta.compute_fabric_roadmap_work_claim_h205f22",
            "delete from destruktion_meta.compute_fabric_roadmap_work_claim_h205f22",
            "insert into destruktion_meta.compute_fabric_roadmap_work_claim_h205f22",
            "update destruktion_meta.compute_fabric_supervisor_directive_h205f22",
        ):
            self.assertNotIn(forbidden, self.lower)


if __name__ == "__main__":
    unittest.main()
