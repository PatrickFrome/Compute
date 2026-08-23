#!/usr/bin/env python3
"""Adversarial tests for the F1 provider-neutral adapter (F1.6 + GPT fixes).

F1-GPT-001 fix tests: unproven candidate providers are structurally
unregistrable in the verified registry without a persisted verifier-channel
proof digest.

F1-GPT-002 fix tests: provider-native execution coordinates — GitHub
{run_id, run_attempt} vs AppVeyor {build_id, build_number}; foreign
coordinates are rejected, never aliased.

Original F1.6 attack targets retained: trust-root substitution, crypto-channel
downgrade, cross-provider identity confusion, replay binding, lifetime abuse,
registration poisoning.
"""
import unittest

from federation.f1.provider_adapter import (
    APPVEYOR_F1_CANDIDATE,
    GITHUB_ACTIONS_F1,
    VerificationProof,
    register_from_readback,
    AdapterRegistrationError,
    ProviderAdapter,
    expected_context,
    register,
    get,
    registered,
)
import hashlib


def _real_proof(provider_id, channel, tg=1, run=999, status="VERIFIED", declared=None):
    neutral = {
        "receipt_schema": "metaengine.compute.f1-verification-proof.h205f22.v1",
        "provider_id": provider_id,
        "crypto_channel": channel,
        "trust_generation": tg,
        "verifier_run_id": run,
        "verifier_run_attempt": 1,
        "verification_status": status,
    }
    d = hashlib.sha256(json.dumps(neutral, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return VerificationProof(**neutral, receipt_sha256=declared or d)

import json


def _github_like(**over):
    base = dict(
        provider_id="x-provider",
        provider_kind="X_HOSTED",
        oidc_issuer="https://oidc.example.com",
        sigstore_instance="public-good",
        trust_generation=1,
        crypto_channel="gh-attestation+sigstore",
        max_lifetime_seconds=600,
        external_execution_format="x:{run_id}:{run_attempt}",
    )
    base.update(over)
    # proof по умолчанию честно биндится к финальному provider_id
    if "verification_proof" not in base and base.get("verification_proof_sha256") is None:
        base["verification_proof"] = _real_proof(
            base["provider_id"], base["crypto_channel"], tg=base["trust_generation"])
    base.pop("verification_proof_sha256", None) if base.get("verification_proof_sha256") == "not-hex" else None
    return ProviderAdapter(**base)


class RegistrationTests(unittest.TestCase):
    def test_duplicate_provider_id_rejected(self):
        register(_github_like(provider_id="dup-test"))
        with self.assertRaises(AdapterRegistrationError):
            register(_github_like(provider_id="dup-test"))

    def test_unknown_crypto_channel_rejected(self):
        with self.assertRaises(AdapterRegistrationError):
            _github_like(crypto_channel="sha256-only")

    def test_no_verification_channel_means_rejected(self):
        with self.assertRaises(AdapterRegistrationError):
            _github_like(crypto_channel="content-hash-only")

    def test_bogus_sigstore_instance_rejected(self):
        with self.assertRaises(AdapterRegistrationError):
            _github_like(sigstore_instance="evil-mirror.example")

    def test_http_issuer_rejected(self):
        with self.assertRaises(AdapterRegistrationError):
            _github_like(oidc_issuer="http://token.actions.githubusercontent.com")

    def test_zero_trust_generation_rejected(self):
        with self.assertRaises(AdapterRegistrationError):
            _github_like(trust_generation=0)

    def test_lifetime_bounds_enforced(self):
        with self.assertRaises(AdapterRegistrationError):
            _github_like(max_lifetime_seconds=30)
        with self.assertRaises(AdapterRegistrationError):
            _github_like(max_lifetime_seconds=25 * 3600)


class F1GPT001CandidateSeparationTests(unittest.TestCase):
    """Unproven crypto channels must not enter the verified registry."""

    def test_appveyor_candidate_registration_fails_without_proof(self):
        with self.assertRaises(AdapterRegistrationError) as ctx:
            register(APPVEYOR_F1_CANDIDATE)
        self.assertIn("DECLARED CANDIDATE", str(ctx.exception))
        self.assertNotIn(APPVEYOR_F1_CANDIDATE.provider_id, registered())

    def test_unproven_adapter_without_proof_rejected(self):
        with self.assertRaises(AdapterRegistrationError):
            register(_github_like(provider_id="unproven-a", verification_proof=None))

    def test_malformed_proof_digest_rejected(self):
        # VerificationProof сам пересчитывает digest: несогласованный объект невозможен;
        # регистрация с НЕ-VerificationProof объектом отклоняется
        with self.assertRaises(AdapterRegistrationError):
            register(_github_like(provider_id="unproven-b", verification_proof={"fake": "object"}))

    def test_tampered_proof_digest_rejected(self):
        # internally inconsistent proof: declared digest != recomputed
        with self.assertRaises(AdapterRegistrationError):
            _real_proof("x", "gh-attestation+sigstore", declared="a" * 64)

    def test_unverified_status_proof_rejected(self):
        with self.assertRaises(AdapterRegistrationError):
            _real_proof("x", "gh-attestation+sigstore", status="PENDING")

    def test_proof_provider_binding_mismatch_rejected(self):
        # proof for provider A cannot register provider B (F1-GPT-001 binding)
        a = _github_like(provider_id="prov-a")
        b = ProviderAdapter(
            provider_id="prov-b", provider_kind=a.provider_kind,
            oidc_issuer=a.oidc_issuer, sigstore_instance="public-good",
            trust_generation=1, crypto_channel=a.crypto_channel,
            max_lifetime_seconds=600,
            external_execution_format="b:{run_id}:{run_attempt}",
            verification_proof=_real_proof("prov-a", a.crypto_channel),  # чужой!
        )
        with self.assertRaises(AdapterRegistrationError):
            register(b)

    def test_proof_channel_binding_mismatch_rejected(self):
        with self.assertRaises(AdapterRegistrationError):
            register(_github_like(
                provider_id="chan-mismatch",
                verification_proof=_real_proof("chan-mismatch", "manual-cosign+sigstore"),
            ))

    def test_proven_adapter_registers(self):
        register(_github_like(provider_id="proven-ok"))
        self.assertIn("proven-ok", registered())

    def test_github_live_adapter_is_proven(self):
        # The GitHub adapter carries the persisted verifier-channel proof
        # digest (live F1 producer+verifier receipts) and must register.
        try:
            register(GITHUB_ACTIONS_F1)
        except AdapterRegistrationError as e:
            self.assertIn("duplicate", str(e))  # already registered = proven
        self.assertIn(GITHUB_ACTIONS_F1.provider_id, registered())


class F1GPT002NativeCoordinateTests(unittest.TestCase):
    """Cross-provider coordinate aliasing is rejected."""

    def setUp(self):
        try:
            register(GITHUB_ACTIONS_F1)
        except AdapterRegistrationError:
            pass

    def test_github_native_coordinates_accepted(self):
        ctx = expected_context(
            GITHUB_ACTIONS_F1.provider_id,
            repository="PatrickFrome/Compute",
            source_digest="a" * 64,
            source_ref="refs/heads/work/f1-live-federation",
            coords={"run_id": 123, "run_attempt": 1},
            signer_workflow="f1-live-provider.yml",
            now_epoch=1_800_000_000.0,
        )
        self.assertEqual(ctx["external_execution_id"], "github-actions:123:1")
        self.assertEqual(ctx["native_execution_coordinates"], {"run_id": 123, "run_attempt": 1})

    def test_github_rejects_appveyor_coordinates(self):
        with self.assertRaises(AdapterRegistrationError) as ctx:
            expected_context(
                GITHUB_ACTIONS_F1.provider_id,
                repository="r", source_digest="a" * 64, source_ref="ref",
                coords={"build_id": 5, "build_number": 3},  # foreign schema
                signer_workflow="w", now_epoch=1.0,
            )
        self.assertIn("native coordinates", str(ctx.exception))

    def test_github_rejects_mixed_coordinates(self):
        with self.assertRaises(AdapterRegistrationError):
            expected_context(
                GITHUB_ACTIONS_F1.provider_id,
                repository="r", source_digest="a" * 64, source_ref="ref",
                coords={"run_id": 5, "build_number": 3},  # mixed foreign
                signer_workflow="w", now_epoch=1.0,
            )

    def test_appveyor_candidate_rejects_github_coordinates_before_registration(self):
        # Even as a candidate, expected_context must refuse GitHub-shaped
        # input: the appveyor adapter is not registered, so get() fails first;
        # if it were registered with proof, _require_coords would still reject.
        with self.assertRaises(AdapterRegistrationError):
            expected_context(
                APPVEYOR_F1_CANDIDATE.provider_id,
                repository="r", source_digest="a" * 64, source_ref="ref",
                coords={"run_id": 123, "run_attempt": 1},
                signer_workflow="w", now_epoch=1.0,
            )

    def test_attempt_binding_prevents_replay_across_attempts(self):
        a = expected_context(
            GITHUB_ACTIONS_F1.provider_id,
            repository="r", source_digest="a" * 64, source_ref="ref",
            coords={"run_id": 5, "run_attempt": 1},
            signer_workflow="w", now_epoch=1.0,
        )
        b = expected_context(
            GITHUB_ACTIONS_F1.provider_id,
            repository="r", source_digest="a" * 64, source_ref="ref",
            coords={"run_id": 5, "run_attempt": 2},
            signer_workflow="w", now_epoch=1.0,
        )
        self.assertNotEqual(a["external_execution_id"], b["external_execution_id"])

    def test_bad_digest_shape_rejected(self):
        with self.assertRaises(AdapterRegistrationError):
            expected_context(
                GITHUB_ACTIONS_F1.provider_id,
                repository="r", source_digest="not-hex", source_ref="ref",
                coords={"run_id": 1, "run_attempt": 1},
                signer_workflow="w", now_epoch=1.0,
            )

    def test_context_is_non_authority(self):
        ctx = expected_context(
            GITHUB_ACTIONS_F1.provider_id,
            repository="r", source_digest="b" * 64, source_ref="ref",
            coords={"run_id": 1, "run_attempt": 1},
            signer_workflow="w", now_epoch=1.0,
        )
        self.assertIs(ctx["authority_effect"], False)


class ReadbackRegistrationTests(unittest.TestCase):
    """F1-GPT-003/004 final: authority = strict typed readback receipt ONLY."""

    def _row(self, **over):
        base = {
            "provider_id": "github-actions-f1-live",
            "provider_kind": "GITHUB_HOSTED_ACTIONS",
            "external_execution_id": "github-actions:32629013167:1",
            "verification_status": "CRYPTO_VERIFIED_EVIDENCE_READY",
            "verified_at": "2026-08-23T08:49:54Z",
            "expires_at": "2099-01-01T00:00:00Z",
            "verifier_id": "gh-attestation+sigstore:gh-2.97.0",
            "receipt_sha256": "60bbd9fbf5f99252cc907e244430ab7933235b28630e2b936f311b10577288c4",
        }
        base.update(over)
        return base

    def _receipt(self, row=None, **over):
        import hashlib, json
        row = row if row is not None else self._row()
        row_digest = hashlib.sha256(json.dumps(row, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
        receipt = {
            "schema": "metaengine.compute.f1-verification-readback.h205f22.v1",
            "source": "SUPABASE_PERSISTED_READBACK",
            "table": "destruktion_meta.compute_fabric_provider_signature_verification_h205f22",
            "status": "ROW_PRESENT",
            "verification_id": "3f1c2a90-1111-4222-8333-444455556666",
            "row": row,
            "row_digest_sha256": row_digest,
            "evaluated_at": "2026-08-23T09:30:00Z",
            "authority_effect": False,
        }
        receipt.update(over)
        return receipt

    def _candidate(self):
        from federation.f1.provider_adapter import ProviderAdapter as PA
        return PA(
            provider_id="github-actions-f1-live",
            provider_kind=GITHUB_ACTIONS_F1.provider_kind,
            oidc_issuer=GITHUB_ACTIONS_F1.oidc_issuer,
            sigstore_instance=GITHUB_ACTIONS_F1.sigstore_instance,
            trust_generation=GITHUB_ACTIONS_F1.trust_generation,
            crypto_channel=GITHUB_ACTIONS_F1.crypto_channel,
            max_lifetime_seconds=GITHUB_ACTIONS_F1.max_lifetime_seconds,
            external_execution_format=GITHUB_ACTIONS_F1.external_execution_format,
            verification_proof=None,
        )

    # ---- F1-GPT-003: forged local proofs ----

    def test_forged_fully_populated_dict_rejected(self):
        # GPT requirement: self-consistent local proof with no matching
        # persisted row must FAIL — plain dict is not an authority object
        with self.assertRaises(AdapterRegistrationError):
            register_from_readback(self._candidate(), self._row(), evaluated_at_epoch=1_800_000_000.0)

    def test_receipt_with_wrong_source_rejected(self):
        with self.assertRaises(AdapterRegistrationError):
            register_from_readback(
                self._candidate(),
                self._receipt(source="CALLER_ASSERTED"),
                evaluated_at_epoch=1_800_000_000.0,
            )

    def test_receipt_digest_mismatch_rejected(self):
        # copied/mutated row with stale digest = forgery
        row = self._row(verification_status="PENDING")
        with self.assertRaises(AdapterRegistrationError):
            register_from_readback(
                self._candidate(),
                self._receipt(row=row),  # digest computed over ORIGINAL row
                evaluated_at_epoch=1_800_000_000.0,
            )

    def test_receipt_missing_fields_rejected(self):
        for missing in ("schema", "source", "table", "verification_id", "row", "row_digest_sha256", "evaluated_at"):
            r = self._receipt()
            r.pop(missing)
            with self.assertRaises(AdapterRegistrationError):
                register_from_readback(self._candidate(), r, evaluated_at_epoch=1_800_000_000.0)

    # ---- F1-GPT-004: mandatory bindings ----

    def test_missing_verification_status_rejected(self):
        row = self._row()
        row.pop("verification_status")
        with self.assertRaises(AdapterRegistrationError):
            register_from_readback(self._candidate(), self._receipt(row=row), evaluated_at_epoch=1_800_000_000.0)

    def test_missing_expires_at_rejected(self):
        row = self._row()
        row.pop("expires_at")
        with self.assertRaises(AdapterRegistrationError):
            register_from_readback(self._candidate(), self._receipt(row=row), evaluated_at_epoch=1_800_000_000.0)

    def test_missing_verification_id_row_field_rejected(self):
        # verifier_id required in row
        row = self._row()
        row.pop("verifier_id")
        with self.assertRaises(AdapterRegistrationError):
            register_from_readback(self._candidate(), self._receipt(row=row), evaluated_at_epoch=1_800_000_000.0)

    def test_wrong_provider_kind_rejected(self):
        row = self._row(provider_kind="SOMETHING_ELSE")
        with self.assertRaises(AdapterRegistrationError):
            register_from_readback(self._candidate(), self._receipt(row=row), evaluated_at_epoch=1_800_000_000.0)

    def test_row_authority_flags_rejected(self):
        row = self._row(canonical=True)
        with self.assertRaises(AdapterRegistrationError):
            register_from_readback(self._candidate(), self._receipt(row=row), evaluated_at_epoch=1_800_000_000.0)
        row2 = self._row(authority_effect=True)
        with self.assertRaises(AdapterRegistrationError):
            register_from_readback(self._candidate(), self._receipt(row=row2), evaluated_at_epoch=1_800_000_000.0)

    def test_malformed_external_execution_id_rejected(self):
        # substring-match bypass: contains 'github-actions' but wrong grammar
        for bad in ("github-actions:123", "xgithub-actions:1:1", "github-actions:1:1:extra", "appveyor:5:3"):
            row = self._row(external_execution_id=bad)
            with self.assertRaises(AdapterRegistrationError):
                register_from_readback(self._candidate(), self._receipt(row=row), evaluated_at_epoch=1_800_000_000.0)

    def test_envelope_sha_substitution_rejected(self):
        # envelope digest conflated with receipt digest
        row = self._row(
            envelope_sha256="60bbd9fbf5f99252cc907e244430ab7933235b28630e2b936f311b10577288c4",
            signed_claims_sha256="a" * 64,
        )
        with self.assertRaises(AdapterRegistrationError):
            register_from_readback(self._candidate(), self._receipt(row=row), evaluated_at_epoch=1_800_000_000.0)

    def test_expired_row_is_historical_rejected(self):
        row = self._row(expires_at="2026-08-23T08:55:20Z")
        with self.assertRaises(AdapterRegistrationError):
            register_from_readback(self._candidate(), self._receipt(row=row), evaluated_at_epoch=1_800_000_000.0)

    def test_future_verified_at_rejected(self):
        row = self._row(verified_at="2098-01-01T00:00:00Z")
        with self.assertRaises(AdapterRegistrationError):
            register_from_readback(self._candidate(), self._receipt(row=row), evaluated_at_epoch=1_800_000_000.0)

    def test_valid_receipt_registers_and_binds(self):
        from federation.f1.provider_adapter import readback_bindings, get
        register_from_readback(self._candidate(), self._receipt(), evaluated_at_epoch=1_800_000_000.0)
        self.assertIn("github-actions-f1-live", registered())
        a = get("github-actions-f1-live")
        self.assertEqual(a.verification_proof.receipt_sha256,
                         "60bbd9fbf5f99252cc907e244430ab7933235b28630e2b936f311b10577288c4")
        self.assertEqual(a.verification_proof.verifier_run_id, 32629013167)
        bindings = readback_bindings()
        self.assertIn("github-actions-f1-live", bindings)
        self.assertEqual(bindings["github-actions-f1-live"]["verification_id"],
                         "3f1c2a90-1111-4222-8333-444455556666")


class ExistingGitHubAdapterTests(unittest.TestCase):
    def test_github_adapter_matches_verifier_constants(self):
        import sys, importlib.util
        from pathlib import Path
        vp = Path(__file__).resolve().parents[2] / "federation" / "f1" / "live_provider_verifier.py"
        spec = importlib.util.spec_from_file_location("lpv", vp)
        lpv = importlib.util.module_from_spec(spec)
        sys.modules["lpv"] = lpv
        spec.loader.exec_module(lpv)
        self.assertEqual(GITHUB_ACTIONS_F1.provider_id, lpv.PROVIDER_ID)
        self.assertEqual(GITHUB_ACTIONS_F1.provider_kind, lpv.PROVIDER_KIND)
        self.assertEqual(GITHUB_ACTIONS_F1.trust_generation, lpv.TRUST_GENERATION)
        self.assertEqual(GITHUB_ACTIONS_F1.max_lifetime_seconds, lpv.MAX_LIFETIME_SECONDS)
        self.assertEqual(GITHUB_ACTIONS_F1.crypto_channel, "gh-attestation+sigstore")


if __name__ == "__main__":
    unittest.main(verbosity=2)
