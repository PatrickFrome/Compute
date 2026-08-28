from pathlib import Path
import unittest


SQL_PATH = Path("supabase/prep/w1_execution_marker_receipt_v1.sql")


class ExecutionMarkerSqlContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = SQL_PATH.read_text(encoding="utf-8")
        cls.lower = cls.sql.lower()

    def test_contract_is_explicitly_prep_only_and_has_no_security_definer(self):
        self.assertIn("prep only; not applied live", self.lower)
        self.assertNotIn("security definer", self.lower)
        self.assertGreaterEqual(self.lower.count("security invoker"), 3)

    def test_receipt_table_is_append_only_idempotent_and_non_authoritative(self):
        self.assertIn("unique (provider_kind, provider_instance_id, execution_command_id, marker_id)", self.lower)
        self.assertIn("execution_marker_receipt_idempotency_conflict", self.lower)
        self.assertIn("before update", self.lower)
        self.assertIn("before delete", self.lower)
        self.assertIn("w1_execution_marker_receipt_is_append_only", self.lower)
        self.assertIn("check (canonical=false)", self.lower)
        self.assertIn("check (authority_effect=false)", self.lower)

    def test_data_plane_is_service_role_only_with_rls(self):
        self.assertIn("enable row level security", self.lower)
        self.assertIn("revoke all on table", self.lower)
        self.assertIn("from public, anon, authenticated", self.lower)
        self.assertIn("grant select, insert on table", self.lower)
        self.assertIn("to service_role", self.lower)
        self.assertGreaterEqual(self.lower.count("revoke all on function"), 3)

    def test_record_function_requires_exact_correlation_and_callback_attestation(self):
        for token in (
            "metaengine.compute.w1-execution-correlation.h205f22.v1",
            "w1_execution_marker_correlated_candidate_uningested",
            "execution_marker_correlated",
            "callback_attestation_verified",
            "live_execution_evidence_candidate",
            "execution_candidate_cross_binding_mismatch",
            "callback_time_outside_execution_window",
            "worker_enrollment_required",
        ):
            self.assertIn(token, self.lower)

    def test_record_function_cannot_upgrade_w1_or_worker_admission(self):
        for forbidden in (
            "'w1_verified',true",
            "'persistent_worker_proof',true",
            "'worker_admitted',true",
            "'canonical',true",
            "'authority_effect',true",
            "update destruktion_meta.compute_fabric_worker_enrollment_h205f22",
            "update destruktion_meta.compute_fabric_roadmap",
            "insert into destruktion_meta.compute_fabric_roadmap",
        ):
            self.assertNotIn(forbidden, self.lower)

    def test_database_write_and_persisted_readback_are_separate_claims(self):
        self.assertIn("'database_write_observed',true", self.lower)
        self.assertIn("'database_persistence_readback_verified',false", self.lower)
        self.assertIn("compute_fabric_w1_execution_marker_readback_h205f22", self.lower)
        self.assertIn("'database_persistence_readback_verified',true", self.lower)

    def test_callback_auth_contract_never_accepts_anonymous_unverified_kind(self):
        self.assertIn("worker_enrollment_signature_v1", self.lower)
        self.assertIn("signed_provider_identity", self.lower)
        self.assertNotIn("auth_kind in ('none'", self.lower)
        self.assertNotIn("anonymous", self.lower)


if __name__ == "__main__":
    unittest.main()
