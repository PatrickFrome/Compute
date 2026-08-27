from __future__ import annotations

from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
SQL = ROOT / "supabase/prep/w1_effective_execution_preflight_v1.sql"


class W1EffectiveExecutionPreflightSqlContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.text = SQL.read_text(encoding="utf-8")
        cls.lower = cls.text.lower()

    def test_is_prepared_not_live_migration(self):
        self.assertIn("PREPARED / NOT APPLIED LIVE", self.text)
        self.assertIn("supabase/prep", SQL.as_posix())

    def test_uses_physical_clock_not_transaction_start_clock(self):
        self.assertIn("clock_timestamp()", self.lower)
        self.assertNotRegex(self.lower, r"\bnow\s*\(")
        self.assertNotIn("current_timestamp", self.lower)

    def test_claim_and_directive_expiry_are_physical_gates(self):
        for token in (
            "'claim_not_expired',v_claim.expires_at>v_now",
            "'directive_not_expired',v_directive.expires_at>v_now",
            "'claim_state_active',v_claim.state='ACTIVE'",
            "'directive_status_active',v_directive.status='ACTIVE'",
            "'directive_not_superseded',v_directive.superseded_at is null",
        ):
            self.assertIn(token, self.text)

    def test_directive_kind_is_explicit_execution_gate(self):
        self.assertIn(
            "'directive_kind_allows_execution',v_directive.directive_kind in ('OPEN','CONTINUE','REASSIGN')",
            self.text,
        )
        self.assertIn("'directive_kind',v_directive.directive_kind", self.text)

    def test_null_valued_checks_become_false_without_json_null_cast_exception(self):
        self.assertIn(
            "bool_and(coalesce((value #>> '{}')::boolean,false))",
            self.text,
        )
        self.assertNotIn("bool_and(value::boolean)", self.text)
        self.assertIn("jsonb_build_object represents SQL NULL as JSON null", self.text)

    def test_exact_identity_and_semantic_head_alignment_are_required(self):
        for token in (
            "v_claim.roadmap_id='compute-fabric-roadmap-v1'",
            "v_claim.milestone_key='W1_PERSISTENT_LINUX_WORKER_SAFETY'",
            "v_claim.holder_id='aop1:W1_IMPLEMENTER'",
            "v_directive.roadmap_id='compute-fabric-roadmap-v1'",
            "v_directive.milestone_key='W1_PERSISTENT_LINUX_WORKER_SAFETY'",
            "v_directive.target_holder_id='aop1:W1_IMPLEMENTER'",
            "v_claim.base_checkpoint_id=v_head_checkpoint",
            "v_claim.base_payload_root_sha256=v_head_root",
            "v_directive.base_checkpoint_id=v_head_checkpoint",
            "v_claim.holder_id=v_directive.target_holder_id",
        ):
            self.assertIn(token, self.text)

    def test_roadmap_and_canonical_integrity_are_required(self):
        for token in (
            "compute_fabric_roadmap_status_h205f22()",
            "compute_fabric_roadmap_alignment_status_h205f22()",
            "'definition_integrity'",
            "'canonical_integrity'",
            "'canonical_drift_absent'",
            "'level2_definition_integrity'",
            "'roadmap_state_allows_w1_execution'",
        ):
            self.assertIn(token, self.text)

    def test_pass_remains_nonauthority(self):
        self.assertIn("'PASS_EFFECTIVE_EXECUTION_PREFLIGHT_NONAUTHORITY'", self.text)
        self.assertIn("'BLOCK_EFFECTIVE_EXECUTION_NONAUTHORITY'", self.text)
        for token in (
            "'provider_mutation_authorized',false",
            "'persistent_worker_proof',false",
            "'worker_admitted',false",
            "'w1_verified',false",
            "'canonical',false",
            "'authority_effect',false",
        ):
            self.assertGreaterEqual(self.text.count(token), 1, token)

    def test_security_invoker_and_service_role_only(self):
        self.assertIn("security invoker", self.lower)
        self.assertNotIn("security definer", self.lower)
        self.assertIn(
            "revoke all on function public.h205f22_w1_effective_execution_preflight_v1(bigint,bigint) from public, anon, authenticated;",
            self.lower,
        )
        self.assertIn(
            "grant execute on function public.h205f22_w1_effective_execution_preflight_v1(bigint,bigint) to service_role;",
            self.lower,
        )

    def test_body_is_read_only(self):
        body = self.lower.split("as $$", 1)[1].split("$$;", 1)[0]
        forbidden = (
            "insert into ",
            "update destruktion_meta.",
            "delete from ",
            "truncate ",
            "alter table ",
            "drop table ",
            "create table ",
            "perform ",
        )
        for token in forbidden:
            self.assertNotIn(token, body, token)

    def test_explicit_ids_prevent_implicit_latest_row_selection(self):
        self.assertIn("where claim_id=p_claim_id", self.lower)
        self.assertIn("where directive_id=p_directive_id", self.lower)
        self.assertNotRegex(self.lower, r"order\s+by\s+claim_id\s+desc")
        self.assertNotRegex(self.lower, r"order\s+by\s+directive_id\s+desc")


if __name__ == "__main__":
    unittest.main()
