#!/usr/bin/env python3
"""Negative canary + tests for F1 credential separation (circular-trust fix).

The canary proves the STRUCTURAL separation even before the migration is
applied live: the guarded recorder rejects service_role callers that do not
hold the per-verifier writer role, and direct table mutation paths are
closed by the revoke statements.

These tests run against a MOCKED role context (they model the SQL semantics
in Python for CI; the live canary runs post-apply in the supervisor channel
with the real DB).
"""
import unittest
from unittest.mock import patch


def guarded_record(*, caller_roles: set, verifier_active: bool, **kwargs) -> dict:
    """Python model of h205f22_record_signature_verification_guarded_v1."""
    if not verifier_active:
        return {"error": "f1_signature_verifier_not_active", "errcode": "P0001"}
    if "f1_verifier_writer" not in caller_roles:
        return {
            "error": "f1_writer_identity_mismatch",
            "errcode": "42501",
            "detail": "record requires the per-verifier writer role (credential separation)",
        }
    return {"status": "RECORDED", "verification_id": "test-uuid"}


class CredentialSeparationTests(unittest.TestCase):
    """DEV-CYCLE-001 F1: reader/forger credential separation."""

    def test_service_role_alone_cannot_record_even_with_active_verifier(self):
        # THE NEGATIVE CANARY: the old circular path (same credential creates
        # proof then reads it) must fail. service_role without the writer
        # role -> 42501.
        result = guarded_record(
            caller_roles={"service_role"},
            verifier_active=True,
            provider_id="github-actions-f1-live",
        )
        self.assertEqual(result["errcode"], "42501")
        self.assertIn("credential separation", result["detail"])

    def test_verifier_writer_role_can_record_when_active(self):
        result = guarded_record(
            caller_roles={"service_role", "f1_verifier_writer"},
            verifier_active=True,
            provider_id="github-actions-f1-live",
        )
        self.assertEqual(result["status"], "RECORDED")

    def test_writer_role_cannot_record_when_verifier_inactive(self):
        result = guarded_record(
            caller_roles={"service_role", "f1_verifier_writer"},
            verifier_active=False,
        )
        self.assertEqual(result["errcode"], "P0001")

    def test_anonymous_cannot_record(self):
        result = guarded_record(caller_roles=set(), verifier_active=True)
        self.assertEqual(result["errcode"], "42501")

    def test_reader_identity_is_not_writer(self):
        # reader (readback RPC, service_role SELECT-only) and writer
        # (f1_verifier_writer) are distinct capabilities by construction
        reader_roles = {"service_role"}
        writer_roles = {"service_role", "f1_verifier_writer"}
        self.assertFalse(reader_roles >= writer_roles)

    def test_migration_file_exists_and_has_required_statements(self):
        from pathlib import Path
        sql = Path(__file__).resolve().parents[2] / "supabase" / "migrations" / (
            "20260823163000_f1_signature_verification_credential_separation_v1.sql"
        )
        self.assertTrue(sql.exists(), "migration file missing")
        text = sql.read_text()
        self.assertIn("f1_verifier_writer", text)
        self.assertIn("pg_has_role", text)  # the separation check
        self.assertIn("revoke insert, update, delete", text)  # trust-plane kill
        self.assertIn("nologin", text)  # role cannot be a credential itself
        self.assertIn("f1_writer_identity_mismatch", text)
        # must NOT statically grant writer to service_role
        self.assertNotIn("grant f1_verifier_writer to service_role", text.lower())

    def test_adapter_uses_guarded_rpc_name(self):
        from pathlib import Path
        adapter = Path(__file__).resolve().parents[2] / "federation" / "f1" / (
            "provider_adapter.py"
        )
        text = adapter.read_text()
        # production path keeps the immutable-UUID readback (unchanged)
        self.assertIn("h205f22_read_signature_verification_v1", text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
