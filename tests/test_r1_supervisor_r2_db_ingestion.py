import copy
import json
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path

from controller.r1.final_r2_evidence_package import build_package
from controller.r1.supervisor_r2_db_ingestion import (
    DBIngestionError,
    DB_RESULT_CLASSIFICATION,
    DB_RESULT_SCHEMA,
    build_sql,
    invoke_ingestion,
)
from controller.r1.supervisor_r2_ingestion_authority_gate import (
    AUTHORITY_GATE_CLASSIFICATION,
    AUTHORITY_GATE_SCHEMA,
)
from controller.r1.supervisor_r2_ingestion_gate import _canonical, _sha_json
from tests.test_r1_final_r2_evidence_package import FinalR2EvidencePackageTests, NOW


class SupervisorR2DBIngestionTests(unittest.TestCase):
    def setUp(self):
        self.fixture = FinalR2EvidencePackageTests(methodName="test_valid_package_is_deterministic_nonauthoritative_and_omits_ciphertext")
        self.fixture.setUp()
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        package, receipt, projection = build_package(**self.fixture._kwargs())
        self.package = self.root / "package.tar"
        self.package.write_bytes(package)
        self.package_receipt = self.root / "package-receipt.json"
        self.package_receipt.write_bytes(_canonical(receipt) + b"\n")
        self.projection = projection
        self.package_meta = receipt
        self.authority = self._authority()
        self.authority_path = self.root / "authority.json"
        self._write_authority(self.authority)
        self.env = {
            "PGHOST": "db.internal.example",
            "PGPORT": "5432",
            "PGDATABASE": "postgres",
            "PGUSER": "postgres",
            "PGPASSWORD": "db-secret-only",
            "PGSSLMODE": "verify-full",
            "PATH": "/usr/bin:/bin",
            "HOME": "/must/not/reach/child",
        }

    def tearDown(self):
        self.tmp.cleanup()
        self.fixture.tearDown()

    def _authority(self):
        core = {
            "schema": AUTHORITY_GATE_SCHEMA,
            "classification": AUTHORITY_GATE_CLASSIFICATION,
            "package_sha256": self.package_meta["package_sha256"],
            "db_projection_sha256": self.projection["projection_sha256"],
            "core_gate_receipt_sha256": "c" * 64,
            "source_head_sha": "1" * 40,
            "trusted_root": {
                "sha256": "d" * 64,
                "context_sha256": "e" * 64,
                "acquired_at": (NOW - timedelta(minutes=1)).isoformat(),
                "online_fetch_required": True,
            },
            "gh_attestation_verification": {
                "executed_by_this_gate": True,
                "offline_bundle_used": True,
                "custom_fresh_trusted_root_used": True,
                "strict_policy_sha256": "f" * 64,
                "verification_json_sha256": "2" * 64,
                "result_count": 1,
            },
            "step09b_ingestion_eligible": True,
            "required_next": "STEP09B_APPEND_ONLY_DB_TRANSACTION_USING_THIS_GATE_AND_EXACT_STEP08_PROJECTION",
            "database_credential_present": False,
            "database_write_performed": False,
            "provider_credential_present": False,
            "provider_call_performed": False,
            "canonical": False,
            "authority_effect": False,
            "r2_proven": False,
            "r3_proven": False,
            "persisted_seal_allowed": False,
        }
        out = dict(core)
        out["authority_gate_receipt_sha256"] = _sha_json(core)
        return out

    def _write_authority(self, value):
        self.authority_path.write_bytes(_canonical(value) + b"\n")

    def _db_result(self, authority=None, *, wrote=True):
        gate = authority or self.authority
        return {
            "schema": DB_RESULT_SCHEMA,
            "classification": DB_RESULT_CLASSIFICATION,
            "projection_sha256": self.projection["projection_sha256"],
            "authority_gate_receipt_sha256": gate["authority_gate_receipt_sha256"],
            "object_id": "00000000-0000-0000-0000-000000000001",
            "domains_inserted": 2 if wrote else 0,
            "domains_reused": 0 if wrote else 2,
            "object_inserted": 1 if wrote else 0,
            "object_reused": 0 if wrote else 1,
            "observations_inserted": 2 if wrote else 0,
            "observations_reused": 0 if wrote else 2,
            "effective_at": NOW.isoformat(),
            "continuity_readiness": {"r2_proven": True, "status": "R2_PROVEN"},
            "continuity_audit": {"status": "PASS"},
            "database_transaction_validated": True,
            "database_write_performed": wrote,
            "continuity_readiness_r2_proven": True,
            "canonical_roadmap_r2_promoted": False,
            "r3_proven": False,
            "persisted_seal_created": False,
        }

    def _invoke(self, *, env=None, result=None):
        seen = {}

        def runner(command, child_env):
            seen["command"] = command
            seen["env"] = child_env
            return json.dumps(result or self._db_result()) + "\n"

        value = invoke_ingestion(
            package_path=self.package,
            package_receipt_path=self.package_receipt,
            authority_gate_path=self.authority_path,
            psql_bin="psql-test",
            env=env or self.env,
            runner=runner,
            now=NOW,
        )
        return value, seen

    def test_valid_runner_binds_inputs_and_keeps_canonical_promotion_separate(self):
        value, seen = self._invoke()
        self.assertTrue(value["database_transaction_validated"])
        self.assertTrue(value["database_write_performed"])
        self.assertTrue(value["continuity_readiness_r2_proven"])
        self.assertFalse(value["canonical_roadmap_r2_promoted"])
        self.assertFalse(value["persisted_seal_created"])
        self.assertEqual(seen["command"][0], "psql-test")
        self.assertIn("--no-psqlrc", seen["command"])
        self.assertEqual(seen["env"]["PGAPPNAME"], "metaengine-r1-step09b")
        self.assertNotIn("HOME", seen["env"])
        self.assertNotIn("GITHUB_TOKEN", seen["env"])

    def test_fully_reused_transaction_is_valid_without_false_write_claim(self):
        value, _seen = self._invoke(result=self._db_result(wrote=False))
        self.assertTrue(value["database_transaction_validated"])
        self.assertFalse(value["database_write_performed"])
        self.assertEqual(value["domains_reused"], 2)
        self.assertEqual(value["object_reused"], 1)
        self.assertEqual(value["observations_reused"], 2)
        self.assertTrue(value["continuity_readiness_r2_proven"])

    def test_authority_self_hash_tamper_rejected(self):
        bad = copy.deepcopy(self.authority)
        bad["source_head_sha"] = "9" * 40
        self._write_authority(bad)
        with self.assertRaisesRegex(DBIngestionError, "receipt_sha256_mismatch"):
            self._invoke()

    def test_authority_receipt_sha_must_be_hex(self):
        bad = copy.deepcopy(self.authority)
        bad["authority_gate_receipt_sha256"] = "z" * 64
        self._write_authority(bad)
        with self.assertRaisesRegex(DBIngestionError, "receipt_sha256_invalid"):
            self._invoke()

    def test_rehashed_projection_binding_mismatch_rejected(self):
        bad = copy.deepcopy(self.authority)
        bad["db_projection_sha256"] = "9" * 64
        core = dict(bad)
        core.pop("authority_gate_receipt_sha256", None)
        bad["authority_gate_receipt_sha256"] = _sha_json(core)
        self._write_authority(bad)
        with self.assertRaisesRegex(DBIngestionError, "package_or_projection_mismatch"):
            self._invoke()

    def test_forbidden_provider_or_github_credentials_rejected(self):
        bad_env = dict(self.env)
        bad_env["AWS_ACCESS_KEY_ID"] = "must-not-cross-zone"
        bad_env["GITHUB_TOKEN"] = "must-not-cross-zone"
        with self.assertRaisesRegex(DBIngestionError, "forbidden_non_database_credentials_present"):
            self._invoke(env=bad_env)

    def test_sql_transport_contains_base64_not_raw_json(self):
        sql = build_sql(self.projection, self.authority)
        self.assertIn("decode('", sql)
        self.assertIn("'base64'", sql)
        self.assertIn("convert_from", sql)
        self.assertNotIn(_canonical(self.projection).decode(), sql)
        self.assertNotIn(_canonical(self.authority).decode(), sql)
        self.assertNotIn("db-secret-only", sql)

    def test_stale_root_rejected_before_psql(self):
        bad = copy.deepcopy(self.authority)
        bad["trusted_root"]["acquired_at"] = (NOW - timedelta(minutes=16)).isoformat()
        core = dict(bad)
        core.pop("authority_gate_receipt_sha256", None)
        bad["authority_gate_receipt_sha256"] = _sha_json(core)
        self._write_authority(bad)
        with self.assertRaisesRegex(DBIngestionError, "trusted_root_stale"):
            self._invoke()

    def test_db_result_requires_transaction_validation(self):
        bad = self._db_result()
        bad["database_transaction_validated"] = False
        with self.assertRaisesRegex(DBIngestionError, "transaction_not_validated"):
            self._invoke(result=bad)

    def test_db_result_cannot_smuggle_roadmap_or_seal_authority(self):
        bad = self._db_result()
        bad["canonical_roadmap_r2_promoted"] = True
        with self.assertRaisesRegex(DBIngestionError, "authority_scope_invalid"):
            self._invoke(result=bad)
        bad = self._db_result()
        bad["persisted_seal_created"] = True
        with self.assertRaisesRegex(DBIngestionError, "authority_scope_invalid"):
            self._invoke(result=bad)

    def test_latest_migration_is_invoker_postgres_only_append_only_and_stable_domain_safe(self):
        migration = Path("supabase/migrations/20260821235859_r1_step09b_idempotency_truthfulness_v2.sql").read_text()
        lower = migration.lower()
        self.assertIn("security invoker", lower)
        self.assertNotIn("security definer", lower)
        self.assertIn("set search_path = ''", lower)
        self.assertIn("revoke all on function", lower)
        self.assertIn("public,anon,authenticated,service_role", lower)
        self.assertIn("grant execute on function", lower)
        self.assertIn("to postgres", lower)
        self.assertIn("current_setting('transaction_isolation') <> 'read committed'", lower)
        self.assertIn("pg_advisory_xact_lock", lower)
        self.assertIn("clock_timestamp()", lower)
        self.assertIn("on conflict (domain_key) do nothing", lower)
        self.assertIn("on conflict (subject_kind,subject_id,expected_sha256) do nothing", lower)
        self.assertNotIn("do update", lower)
        self.assertNotIn("insert into destruktion_meta.compute_continuity_persisted_seal", lower)
        self.assertIn("registration_contract','step09b_stable_domain_identity_v1'", lower)
        self.assertIn("v_provider_result_sha := v_domain#>>'{metadata,provider_result_sha256}'", lower)
        stable_assignment = lower.split("v_domain_metadata :=", 1)[1].split(";", 1)[0]
        self.assertNotIn("provider_result_sha256", stable_assignment)
        self.assertIn("(evidence-'step09b') is not distinct from v_base_evidence", lower)
        self.assertIn("database_transaction_validated',true", lower)
        self.assertIn("v_database_write_performed :=", lower)


if __name__ == "__main__":
    unittest.main()
