from __future__ import annotations

from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase" / "migrations" / "20260827201500_main_roadmap_lease_reconciliation_v1.sql"


class MainRoadmapLeaseReconciliationSqlContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = MIGRATION.read_text(encoding="utf-8")
        cls.lower = cls.source.lower()

    def test_requires_active_supervisor_token(self):
        self.assertIn("supervisor_token = p_supervisor_token", self.lower)
        self.assertIn("mode = 'active'", self.lower)
        self.assertIn("active supervisor token required", self.lower)

    def test_serializes_reconciliation_with_transaction_advisory_lock(self):
        self.assertIn("pg_try_advisory_xact_lock", self.lower)
        self.assertIn("metaengine:h205f22:roadmap-lease-reconcile", self.lower)
        self.assertIn("'status', 'skipped_locked'", self.lower)

    def test_uses_one_statement_observation_time(self):
        self.assertIn("v_observed_at timestamptz := statement_timestamp()", self.lower)
        self.assertNotIn("clock_timestamp()", self.lower)

    def test_only_expired_active_claims_are_expired(self):
        pattern = re.compile(
            r"update\s+destruktion_meta\.compute_fabric_roadmap_work_claim_h205f22.*?"
            r"state\s*=\s*'expired'.*?state\s*=\s*'active'.*?expires_at\s*<=\s*v_observed_at",
            re.IGNORECASE | re.DOTALL,
        )
        self.assertRegex(self.source, pattern)

    def test_only_expired_finite_active_directives_are_closed(self):
        pattern = re.compile(
            r"update\s+destruktion_meta\.compute_fabric_supervisor_directive_h205f22.*?"
            r"status\s*=\s*'superseded'.*?status\s*=\s*'active'.*?"
            r"expires_at\s+is\s+not\s+null.*?expires_at\s*<=\s*v_observed_at",
            re.IGNORECASE | re.DOTALL,
        )
        self.assertRegex(self.source, pattern)

    def test_milestone_reset_preserves_fresh_claims(self):
        self.assertIn("m.status = 'in_progress'", self.lower)
        self.assertIn("c.state = 'active'", self.lower)
        self.assertIn("c.expires_at > v_observed_at", self.lower)

    def test_returning_receipt_is_exactly_scoped(self):
        self.assertIn("returning c.claim_id", self.lower)
        self.assertIn("returning d.directive_id", self.lower)
        self.assertIn("'database_mutation', true", self.lower)
        self.assertIn("'authority_effect', true", self.lower)
        self.assertIn("'provider_mutation', false", self.lower)
        self.assertIn("'edge_deployment', false", self.lower)
        self.assertIn("'pr_merge', false", self.lower)
        self.assertIn("'checkpoint_promotion', false", self.lower)

    def test_public_execute_is_revoked_and_service_role_is_explicit(self):
        self.assertIn("revoke all on function", self.lower)
        self.assertIn("from public", self.lower)
        self.assertIn("grant execute on function", self.lower)
        self.assertIn("to service_role", self.lower)

    def test_no_external_runtime_mutation_surfaces_are_referenced(self):
        for forbidden in (
            "compute_federation_runtime_run_h205f22",
            "pgmq.",
            "supabase.functions",
            "provider_mutation_authorized",
            "edge_deployment_authorized",
        ):
            self.assertNotIn(forbidden, self.lower)


if __name__ == "__main__":
    unittest.main()
