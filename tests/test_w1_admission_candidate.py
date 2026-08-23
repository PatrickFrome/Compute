from __future__ import annotations

import unittest
from pathlib import Path

from worker.native_linux import admission_candidate as c

ROOT = Path(__file__).parents[1]
MIGRATION = ROOT / "supabase" / "migrations" / "20260823141025_w1_persisted_admission_candidate_readback_v1.sql"
VOLATILITY_FIX = ROOT / "supabase" / "migrations" / "20260823141042_w1_admission_candidate_readback_volatility_fix.sql"


def forged_bundle() -> dict:
    """A fully caller-controlled bundle that used to mint a candidate."""
    common = {"source": c.READBACK_SOURCE, "canonical": False, "authority_effect": False}
    return {
        "schema": c.INPUT_SCHEMA,
        "evaluated_at": "2026-08-23T14:00:00+00:00",
        "safety_verification": {**common, "verification_id": "forged"},
        "backend_binding": {**common, "backend_instance_name": "forged"},
        "reboot_receipt": {**common, "reboot_receipt_id": "forged"},
        "pre_reboot_probe": {**common, "receipt_id": 1},
        "post_reboot_probe": {**common, "receipt_id": 2},
    }


class OfflineOracleTests(unittest.TestCase):
    def test_fully_self_asserted_readback_bundle_cannot_mint_candidate(self):
        result = c.compose(forged_bundle())
        self.assertEqual(result["outcome"], "ADMISSION_COMPOSITION_ORACLE_NON_AUTHORITY")
        self.assertFalse(result["input_provenance_verified"])
        self.assertFalse(result["admission_candidate"])
        self.assertFalse(result["worker_admitted"])
        self.assertFalse(result["persistent_worker_proof"])
        self.assertFalse(result["w1_verified"])
        self.assertFalse(result["canonical"])
        self.assertFalse(result["authority_effect"])
        self.assertEqual(
            result["production_candidate_source"],
            f"SUPABASE_DB_RPC:{c.PRODUCTION_READBACK_RPC}",
        )

    def test_source_label_never_authenticates_input(self):
        value = forged_bundle()
        for name in (
            "safety_verification", "backend_binding", "reboot_receipt",
            "pre_reboot_probe", "post_reboot_probe",
        ):
            value[name]["source"] = c.READBACK_SOURCE
        result = c.compose(value)
        self.assertFalse(result["input_provenance_verified"])
        self.assertFalse(result["admission_candidate"])

    def test_authority_escalation_in_oracle_input_rejected(self):
        value = forged_bundle()
        value["backend_binding"]["authority_effect"] = True
        with self.assertRaisesRegex(ValueError, "non-authority"):
            c.compose(value)

    def test_unknown_input_field_rejected(self):
        value = forged_bundle()
        value["persistence_proven"] = True
        with self.assertRaisesRegex(ValueError, "composition keys mismatch"):
            c.compose(value)


class DBNativeContractTests(unittest.TestCase):
    def test_production_function_accepts_only_immutable_receipt_ids(self):
        sql = MIGRATION.read_text(encoding="utf-8")
        signature = "public.h205f22_w1_admission_candidate_readback_v1(\n  p_safety_verification_id uuid,\n  p_reboot_receipt_id uuid,\n  p_pre_probe_receipt_id bigint,\n  p_post_probe_receipt_id bigint\n)"
        self.assertIn(signature, sql)
        self.assertNotIn("p_safety_verification jsonb", sql)
        self.assertNotIn("p_backend_binding jsonb", sql)
        self.assertNotIn("p_reboot_receipt jsonb", sql)
        self.assertNotIn("p_pre_probe jsonb", sql)
        self.assertNotIn("p_post_probe jsonb", sql)

    def test_db_function_revalidates_all_persisted_planes(self):
        sql = MIGRATION.read_text(encoding="utf-8")
        for table in (
            "compute_fabric_linux_worker_safety_verification_h205f22",
            "compute_fabric_worker_enrollment_h205f22",
            "compute_fabric_linux_worker_backend_binding_h205f22",
            "compute_fabric_worker_reboot_receipt_h205f22",
            "compute_fabric_worker_probe_receipt_h205f22",
        ):
            self.assertIn(table, sql)
        self.assertIn("compute_fabric_validate_signed_reboot_identity_h205f22", sql)
        self.assertIn("clock_timestamp()", sql)
        self.assertIn("w1_safety_receipt_digest_mismatch", sql)
        self.assertIn("w1_reboot_receipt_digest_mismatch", sql)
        self.assertIn("w1_pre_probe_receipt_digest_mismatch", sql)
        self.assertIn("w1_post_probe_receipt_digest_mismatch", sql)
        self.assertIn("w1_boot_id_change_not_proven", sql)
        self.assertIn("w1_safety_not_bound_to_post_probe", sql)

    def test_direct_probe_insert_is_revoked_and_guarded_rpc_remains_boundary(self):
        sql = MIGRATION.read_text(encoding="utf-8").lower()
        self.assertIn(
            "revoke insert on table destruktion_meta.compute_fabric_worker_probe_receipt_h205f22 from service_role",
            sql,
        )
        self.assertIn("grant execute on function public.h205f22_w1_admission_candidate_readback_v1", sql)

    def test_production_output_remains_nonauthority(self):
        sql = MIGRATION.read_text(encoding="utf-8")
        self.assertIn("'source','SUPABASE_PERSISTED_READBACK'", sql)
        self.assertIn("'outcome','ADMISSION_CANDIDATE_NON_AUTHORITY'", sql)
        self.assertIn("'worker_admitted',false", sql)
        self.assertIn("'persistent_worker_proof',false", sql)
        self.assertIn("'w1_verified',false", sql)
        self.assertIn("'canonical',false", sql)
        self.assertIn("'authority_effect',false", sql)

    def test_db_time_function_is_finally_volatile(self):
        initial = MIGRATION.read_text(encoding="utf-8")
        fix = VOLATILITY_FIX.read_text(encoding="utf-8")
        self.assertIn("clock_timestamp()", initial)
        self.assertIn(
            "alter function public.h205f22_w1_admission_candidate_readback_v1(uuid,uuid,bigint,bigint) volatile",
            fix.lower(),
        )


if __name__ == "__main__":
    unittest.main()
