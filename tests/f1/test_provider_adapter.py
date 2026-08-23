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
    AdapterRegistrationError,
    ProviderAdapter,
    expected_context,
    register,
    get,
    registered,
)


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
        verification_proof_sha256="c" * 64,
    )
    base.update(over)
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

    def test_unproven_adapter_without_proof_digest_rejected(self):
        with self.assertRaises(AdapterRegistrationError):
            register(_github_like(provider_id="unproven-a", verification_proof_sha256=None))

    def test_malformed_proof_digest_rejected(self):
        with self.assertRaises(AdapterRegistrationError):
            register(_github_like(provider_id="unproven-b", verification_proof_sha256="not-hex"))

    def test_proven_adapter_registers(self):
        register(_github_like(provider_id="proven-ok"))
        self.assertIn("proven-ok", registered())

    def test_github_live_adapter_is_proven(self):
        # The GitHub adapter carries the persisted verifier-channel proof
        # digest (live F1 producer+verifier receipts) and must register.
        register(GITHUB_ACTIONS_F1)
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
