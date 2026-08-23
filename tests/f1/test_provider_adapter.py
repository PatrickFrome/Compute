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
    """F1-GPT-001 final: registration authority derives ONLY from persisted rows."""

    def _row(self, **over):
        base = {
            "provider_id": "github-actions-f1-live",
            "external_execution_id": "github-actions:32629013167:1",
            "receipt_sha256": "60bbd9fbf5f99252cc907e244430ab7933235b28630e2b936f311b10577288c4",
            "verification_status": "CRYPTO_VERIFIED_EVIDENCE_READY",
            "verified_at": "2026-08-23T08:49:54Z",
            "expires_at": "2099-01-01T00:00:00Z",  # far future for CURRENT semantics
        }
        base.update(over)
        return base

    def test_absent_readback_rejected_even_if_consistent(self):
        # GPT requirement 5: reject absent DB readback even if all caller
        # fields are internally consistent
        with self.assertRaises(AdapterRegistrationError):
            register_from_readback(GITHUB_ACTIONS_F1, {}, evaluated_at_epoch=1_800_000_000.0)
        with self.assertRaises(AdapterRegistrationError):
            register_from_readback(GITHUB_ACTIONS_F1, None, evaluated_at_epoch=1_800_000_000.0)

    def test_expired_readback_is_historical_and_rejected(self):
        with self.assertRaises(AdapterRegistrationError):
            register_from_readback(
                GITHUB_ACTIONS_F1,
                self._row(expires_at="2026-08-23T08:55:20Z"),
                evaluated_at_epoch=1_800_000_000.0,  # 2027: far past expiry
            )

    def test_provider_mismatch_rejected(self):
        with self.assertRaises(AdapterRegistrationError):
            register_from_readback(
                GITHUB_ACTIONS_F1,
                self._row(provider_id="somebody-else"),
                evaluated_at_epoch=1_800_000_000.0,
            )

    def test_unverified_status_rejected(self):
        with self.assertRaises(AdapterRegistrationError):
            register_from_readback(
                GITHUB_ACTIONS_F1,
                self._row(verification_status="PENDING"),
                evaluated_at_epoch=1_800_000_000.0,
            )

    def test_current_readback_registers(self):
        from federation.f1.provider_adapter import ProviderAdapter as PA
        rb_adapter = PA(
            provider_id="github-actions-f1-live",  # same identity
            provider_kind=GITHUB_ACTIONS_F1.provider_kind,
            oidc_issuer=GITHUB_ACTIONS_F1.oidc_issuer,
            sigstore_instance=GITHUB_ACTIONS_F1.sigstore_instance,
            trust_generation=GITHUB_ACTIONS_F1.trust_generation,
            crypto_channel=GITHUB_ACTIONS_F1.crypto_channel,
            max_lifetime_seconds=GITHUB_ACTIONS_F1.max_lifetime_seconds,
            external_execution_format=GITHUB_ACTIONS_F1.external_execution_format,
            verification_proof=None,  # candidate shell; readback supplies authority
        )
        try:
            register_from_readback(rb_adapter, self._row(), evaluated_at_epoch=1_800_000_000.0)
        except AdapterRegistrationError as e:
            if "duplicate" not in str(e):
                raise
        self.assertIn("github-actions-f1-live", registered())

    def test_registration_bound_to_row_receipt(self):
        from federation.f1.provider_adapter import ProviderAdapter as PA
        rb_adapter = PA(
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
        try:
            register_from_readback(rb_adapter, self._row(), evaluated_at_epoch=1_800_000_000.0)
        except AdapterRegistrationError as e:
            if "duplicate" not in str(e):
                raise
        a = get("github-actions-f1-live")
        self.assertEqual(
            a.verification_proof.receipt_sha256,
            "60bbd9fbf5f99252cc907e244430ab7933235b28630e2b936f311b10577288c4",
        )
        self.assertEqual(a.verification_proof.verifier_run_id, 32629013167)


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
