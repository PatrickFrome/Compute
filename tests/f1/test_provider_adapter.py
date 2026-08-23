#!/usr/bin/env python3
"""Adversarial tests for the F1 provider-neutral adapter (F1.6).

Attack targets from the F1 security invariants list:
- trust-root substitution (bogus sigstore instance / trust generation)
- crypto-channel downgrade (no-channel / unknown channel)
- cross-provider identity confusion (GitHub evidence against AppVeyor adapter)
- replay (execution format must bind run_id AND run_attempt)
- lifetime policy abuse (0s, 25h)
- registration poisoning (duplicate provider_id, malformed fields)
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
        # content-hash-only adapters are structurally impossible to register
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


class CrossProviderConfusionTests(unittest.TestCase):
    def test_github_evidence_against_appveyor_context_is_detected(self):
        if APPVEYOR_F1_CANDIDATE.provider_id not in registered():
            register(APPVEYOR_F1_CANDIDATE)
        ctx = expected_context(
            APPVEYOR_F1_CANDIDATE.provider_id,
            repository="PatrickFrome/Compute",
            source_digest="a" * 64,
            source_ref="refs/heads/work/f1-live-federation",
            run_id=123,
            run_attempt=1,
            signer_workflow="f1-live-provider.yml",
            now_epoch=1_800_000_000.0,
        )
        self.assertEqual(ctx["external_execution_id"], "appveyor:123:1")
        self.assertNotIn("github-actions", ctx["external_execution_id"])

    def test_execution_format_binds_attempt(self):
        _register_quiet("fmt-a")
        a = expected_context(
            "fmt-a",
            repository="r", source_digest="a" * 64, source_ref="ref",
            run_id=5, run_attempt=1, signer_workflow="w", now_epoch=1.0,
        )
        b = expected_context(
            "fmt-a",
            repository="r", source_digest="a" * 64, source_ref="ref",
            run_id=5, run_attempt=2, signer_workflow="w", now_epoch=1.0,
        )
        self.assertNotEqual(a["external_execution_id"], b["external_execution_id"])

    def test_bad_digest_shape_rejected(self):
        _register_quiet("fmt-b")
        with self.assertRaises(AdapterRegistrationError):
            expected_context(
                "fmt-b",
                repository="r", source_digest="not-hex", source_ref="ref",
                run_id=1, run_attempt=1, signer_workflow="w", now_epoch=1.0,
            )

    def test_context_is_non_authority(self):
        _register_quiet("fmt-c")
        ctx = expected_context(
            "fmt-c",
            repository="r", source_digest="b" * 64, source_ref="ref",
            run_id=1, run_attempt=1, signer_workflow="w", now_epoch=1.0,
        )
        self.assertIs(ctx["authority_effect"], False)


class ExistingGitHubAdapterTests(unittest.TestCase):
    def test_github_adapter_matches_verifier_constants(self):
        # The neutral seam must not drift from the verifier's own constants.
        import sys, importlib.util
        from pathlib import Path
        vp = Path(__file__).resolve().parents[2] / "federation" / "f1" / "live_provider_verifier.py"
        spec = importlib.util.spec_from_file_location("lpv", vp)
        lpv = importlib.util.module_from_spec(spec)
        sys.modules["lpv"] = lpv  # dataclass needs resolvable module
        spec.loader.exec_module(lpv)
        self.assertEqual(GITHUB_ACTIONS_F1.provider_id, lpv.PROVIDER_ID)
        self.assertEqual(GITHUB_ACTIONS_F1.provider_kind, lpv.PROVIDER_KIND)
        self.assertEqual(GITHUB_ACTIONS_F1.trust_generation, lpv.TRUST_GENERATION)
        self.assertEqual(GITHUB_ACTIONS_F1.max_lifetime_seconds, lpv.MAX_LIFETIME_SECONDS)
        self.assertEqual(GITHUB_ACTIONS_F1.crypto_channel, "gh-attestation+sigstore")


def _register_quiet(pid: str) -> str:
    try:
        register(_github_like(provider_id=pid))
    except AdapterRegistrationError:
        pass
    return pid


if __name__ == "__main__":
    unittest.main(verbosity=2)
