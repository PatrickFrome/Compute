from __future__ import annotations

import copy
import json
from pathlib import Path
import unittest

from controller.w1 import w1_supabase_management_credential_provenance_guard as guard

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/w1-supabase-management-credential-provenance-contract.yml"
SOURCE = ROOT / "controller/w1/w1_supabase_management_credential_provenance_guard.py"


class SupabaseManagementCredentialProvenanceTests(unittest.TestCase):
    def test_pat_is_explicitly_unverified_user_authority_and_nonauthority(self):
        result = guard.evaluate(organization_plan="free", mechanism="PAT_TRANSITIONAL")
        self.assertEqual("UNVERIFIED_USER_ACCOUNT_AUTHORITY", result["credential_scope_status"])
        self.assertFalse(result["provider_credential_scope_verified"])
        self.assertTrue(result["long_lived_secret_required_by_mechanism"])
        self.assertEqual("OAUTH_REFRESH_SCOPED", result["recommended_target_mechanism"])
        self.assertEqual("PAT_INHERITS_USER_PRIVILEGES", result["migration_blocker"])
        for field in guard.AUTHORITY_FIELDS:
            self.assertIs(result[field], False, field)

    def test_pat_must_not_claim_a_scope_or_token_exchange(self):
        with self.assertRaisesRegex(guard.CredentialProvenanceError, "pat_scope_claim_forbidden"):
            guard.evaluate(
                organization_plan="free", mechanism="PAT_TRANSITIONAL",
                requested_scope=guard.EDGE_READ_SCOPE,
            )
        with self.assertRaisesRegex(guard.CredentialProvenanceError, "pat_token_response_forbidden"):
            guard.evaluate(
                organization_plan="free", mechanism="PAT_TRANSITIONAL",
                token_response={"access_token":"secret","token_type":"Bearer","expires_in":300},
            )

    def test_free_plan_blocks_idjag_without_attempting_exchange(self):
        result = guard.evaluate(
            organization_plan="free",
            mechanism="IDJAG_WORKLOAD_SCOPED",
            requested_scope=guard.EDGE_READ_SCOPE,
        )
        self.assertFalse(result["mechanism_available_on_plan"])
        self.assertFalse(result["workload_identity_exchange_capable_on_plan"])
        self.assertEqual("BLOCKED_PLAN_TIER", result["credential_scope_status"])
        self.assertEqual("IDJAG_REQUIRES_TEAM_OR_ENTERPRISE", result["migration_blocker"])
        self.assertFalse(result["exchange_observed"])
        with self.assertRaisesRegex(guard.CredentialProvenanceError, "idjag_exchange_observation_forbidden"):
            guard.evaluate(
                organization_plan="free",
                mechanism="IDJAG_WORKLOAD_SCOPED",
                requested_scope=guard.EDGE_READ_SCOPE,
                token_response={"access_token":"secret","token_type":"Bearer","expires_in":300},
            )

    def test_team_idjag_is_available_but_scope_is_not_claimed_verified(self):
        result = guard.evaluate(
            organization_plan="team",
            mechanism="IDJAG_WORKLOAD_SCOPED",
            requested_scope=guard.EDGE_READ_SCOPE,
            token_response={"access_token":"a-sensitive-token","token_type":"Bearer","expires_in":600},
        )
        self.assertTrue(result["mechanism_available_on_plan"])
        self.assertTrue(result["workload_identity_exchange_capable_on_plan"])
        self.assertTrue(result["exchange_observed"])
        self.assertFalse(result["provider_credential_scope_verified"])
        self.assertEqual("REQUESTED_SCOPE_NOT_PROVIDER_INTROSPECTED", result["credential_scope_status"])
        self.assertEqual("IDJAG_WORKLOAD_SCOPED", result["recommended_target_mechanism"])

    def test_scoped_oauth_refresh_observes_short_lived_token_without_persisting_secrets(self):
        access = "access-secret-value"
        refresh = "refresh-secret-value"
        result = guard.evaluate(
            organization_plan="free",
            mechanism="OAUTH_REFRESH_SCOPED",
            requested_scope=guard.EDGE_READ_SCOPE,
            token_response={
                "access_token": access,
                "refresh_token": refresh,
                "token_type": "Bearer",
                "expires_in": 900,
            },
        )
        self.assertTrue(result["exchange_observed"])
        self.assertTrue(result["access_token_observed"])
        self.assertTrue(result["refresh_token_observed"])
        self.assertTrue(result["short_lived_access_token_within_local_cap"])
        self.assertFalse(result["raw_access_token_persisted"])
        self.assertFalse(result["raw_refresh_token_persisted"])
        self.assertFalse(result["provider_credential_scope_verified"])
        rendered = json.dumps(result, sort_keys=True)
        self.assertNotIn(access, rendered)
        self.assertNotIn(refresh, rendered)

    def test_only_exact_edge_read_scope_is_accepted(self):
        for scope, reason in (
            ("edge_functions:write", "write_scope_forbidden"),
            ("edge_functions:read edge_functions:write", "write_scope_forbidden"),
            ("projects:read", "requested_scope_must_be_exact_edge_read"),
            ("edge_functions:read projects:read", "requested_scope_must_be_exact_edge_read"),
        ):
            with self.assertRaisesRegex(guard.CredentialProvenanceError, reason):
                guard.evaluate(
                    organization_plan="free",
                    mechanism="OAUTH_REFRESH_SCOPED",
                    requested_scope=scope,
                )

    def test_token_response_is_fail_closed_and_locally_ttl_bounded(self):
        base = {"access_token":"secret","token_type":"Bearer","expires_in":900}
        cases = (
            ({**base, "token_type":"bearer"}, "token_type_must_be_bearer"),
            ({**base, "expires_in":0}, "expires_in_invalid"),
            ({**base, "expires_in":guard.LOCAL_ACCESS_TOKEN_TTL_CAP_SECONDS + 1}, "access_token_ttl_exceeds_local_cap"),
            ({"token_type":"Bearer","expires_in":900}, "access_token_missing"),
        )
        for token, reason in cases:
            with self.assertRaisesRegex(guard.CredentialProvenanceError, reason):
                guard.evaluate(
                    organization_plan="free",
                    mechanism="OAUTH_REFRESH_SCOPED",
                    requested_scope=guard.EDGE_READ_SCOPE,
                    token_response=token,
                )

    def test_receipt_hash_and_authority_tamper_fail_closed(self):
        receipt = guard.evaluate(organization_plan="free", mechanism="PAT_TRANSITIONAL")
        guard.validate_receipt(receipt)
        tampered = copy.deepcopy(receipt)
        tampered["provider_credential_scope_verified"] = True
        with self.assertRaisesRegex(guard.CredentialProvenanceError, "receipt_sha256_mismatch"):
            guard.validate_receipt(tampered)
        tampered = copy.deepcopy(receipt)
        tampered["authority_effect"] = True
        core = dict(tampered); core.pop("receipt_sha256")
        tampered["receipt_sha256"] = guard._sha(core)
        with self.assertRaisesRegex(guard.CredentialProvenanceError, "authority_effect_must_be_false"):
            guard.validate_receipt(tampered)

    def test_guard_has_no_network_or_provider_client_surface(self):
        source = SOURCE.read_text()
        for forbidden in (
            "requests", "urllib", "httpx", "aiohttp", "socket", "subprocess",
            "api.supabase.com", "curl ", "supabase functions deploy", "edge_functions:write",
        ):
            if forbidden == "edge_functions:write":
                self.assertIn(forbidden, source)  # documented forbidden scope constant is intentional
            else:
                self.assertNotIn(forbidden, source)

    def test_contract_workflow_is_source_only_and_credential_free(self):
        source = WORKFLOW.read_text()
        self.assertIn("work/main-roadmap-accelerators-v13", source)
        self.assertIn("tests.test_w1_supabase_management_credential_provenance_guard", source)
        self.assertNotIn("workflow_dispatch:", source)
        self.assertNotIn("id-token: write", source)
        self.assertNotIn("secrets.", source)
        self.assertNotIn("vars.", source)
        self.assertNotIn("curl ", source)
        self.assertNotIn("api.supabase.com", source)
        self.assertNotIn("oauth/token", source)


if __name__ == "__main__":
    unittest.main()
