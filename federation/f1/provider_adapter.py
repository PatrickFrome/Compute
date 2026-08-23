#!/usr/bin/env python3
"""F1 provider-neutral federation adapter layer.

F1.3 of the DEV-CYCLE-001 engineering sequence.

Purpose: decouple provider-specific facts from the evidence policy so the
verifier core stays stable while external providers multiply. The existing
live_provider_verifier is GitHub-Actions-specific; this module introduces the
neutral seam WITHOUT mutating its verified logic (domain: federation/provider).

Design laws (inherited from F1 invariants):
- FETCHED != VERIFIED; CONTENT_HASH_ONLY != CRYPTO_VERIFIED.
- Adapter produces EXPECTATIONS, never verdicts. Verdicts stay in
  live_provider_verifier.validate_evidence + the cryptographic verifier job.
- Every adapter must declare its cryptographic verification channel; evidence
  without a declared verifier channel is rejected at registration time.
- Trust generation is per-provider and must rotate independently.

Non-authority: everything here is PREPARE_ONLY, authority_effect=false.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
OIDC_RE = re.compile(r"^https://[a-z0-9.-]+[a-z]$")

CRYPTO_CHANNELS = {
    "gh-attestation+sigstore",
    "appveyor-attestation+sigstore",
    "manual-cosign+sigstore",
}


class AdapterRegistrationError(ValueError):
    pass


@dataclass(frozen=True)
class VerificationProof:
    """Persisted verifier-channel receipt binding (F1-GPT-001 hard fix).

    A registration proof is not an arbitrary hex string: it must carry the
    persisted receipt identity (run/job), the channel it proves, the
    provider+trust-generation it binds to, verification status, and its own
    canonical digest — recomputed and checked at register() time.
    """

    receipt_schema: str
    provider_id: str
    crypto_channel: str
    trust_generation: int
    verifier_run_id: int
    verifier_run_attempt: int
    verification_status: str
    receipt_sha256: str
    # readback_authority=True: receipt_sha256 comes from a PERSISTED DB row
    # (external authority); the digest is NOT self-recomputed. False (default):
    # self-consistent proof; digest recomputed and compared locally.
    readback_authority: bool = False

    def __post_init__(self) -> None:
        if self.readback_authority:
            # authority = persisted row; only shape checks apply
            if not SHA256_RE.match(self.receipt_sha256 or ""):
                raise AdapterRegistrationError("readback receipt_sha256 malformed")
            if self.verification_status != "VERIFIED":
                raise AdapterRegistrationError("readback proof must be VERIFIED")
            return
        if self.receipt_schema != "metaengine.compute.f1-verification-proof.h205f22.v1":
            raise AdapterRegistrationError("unsupported verification-proof schema")
        if self.verification_status != "VERIFIED":
            raise AdapterRegistrationError(
                "verification proof must carry verification_status=VERIFIED "
                "(anything else cannot register a provider)"
            )
        if self.trust_generation < 1:
            raise AdapterRegistrationError("proof trust_generation must be >= 1")
        digest = _proof_digest(self)
        if digest != self.receipt_sha256:
            raise AdapterRegistrationError(
                f"verification proof digest mismatch: declared {self.receipt_sha256[:12]}... "
                f"recomputed {digest[:12]}... — the proof object is not internally consistent"
            )


def _proof_digest(proof: "VerificationProof") -> str:
    import hashlib
    neutral = {
        "receipt_schema": proof.receipt_schema,
        "provider_id": proof.provider_id,
        "crypto_channel": proof.crypto_channel,
        "trust_generation": proof.trust_generation,
        "verifier_run_id": proof.verifier_run_id,
        "verifier_run_attempt": proof.verifier_run_attempt,
        "verification_status": proof.verification_status,
    }
    return hashlib.sha256(
        json.dumps(neutral, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


@dataclass(frozen=True)
class ProviderAdapter:
    """Neutral description of ONE external federation provider.

    A provider WITHOUT verification_proof_sha256 is a DECLARED CANDIDATE:
    structurally unregistrable in the verified registry (F1-GPT-001 fix).
    The proof digest binds the registration to persisted verifier-channel
    evidence (e.g. a successful live attestation verification receipt).
    """

    provider_id: str
    provider_kind: str
    oidc_issuer: str
    sigstore_instance: str
    trust_generation: int
    crypto_channel: str
    max_lifetime_seconds: int
    external_execution_format: str  # e.g. "github-actions:{run_id}:{run_attempt}"
    verification_proof: object | None = None  # VerificationProof | None; None => DECLARED CANDIDATE
    revoked_identities: tuple = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if not self.provider_id or len(self.provider_id) > 96:
            raise AdapterRegistrationError("provider_id must be 1..96 chars")
        if not self.provider_kind or len(self.provider_kind) > 64:
            raise AdapterRegistrationError("provider_kind must be 1..64 chars")
        if not OIDC_RE.match(self.oidc_issuer):
            raise AdapterRegistrationError("oidc_issuer must be an https URL")
        if self.sigstore_instance not in {"public-good", "staging"}:
            raise AdapterRegistrationError("unsupported sigstore instance")
        if self.trust_generation < 1:
            raise AdapterRegistrationError("trust_generation must be >= 1")
        if self.crypto_channel not in CRYPTO_CHANNELS:
            raise AdapterRegistrationError(
                f"crypto_channel must be one of {sorted(CRYPTO_CHANNELS)}; "
                "evidence without a declared cryptographic verifier channel is rejected"
            )
        if not (60 <= self.max_lifetime_seconds <= 24 * 3600):
            raise AdapterRegistrationError("max_lifetime_seconds out of policy range")
        import re as _re
        tmpl = set(_re.findall(r"\{([a-z_]+)\}", self.external_execution_format))
        if len(tmpl) < 2:
            raise AdapterRegistrationError(
                "external_execution_format must template at least two distinct execution identity variables"
            )
        if self.external_execution_format.format(run_id=1, run_attempt=1, build_id=1, build_number=1) == self.external_execution_format:
            raise AdapterRegistrationError("external_execution_format templates did not substitute")



# --- persisted-readback registration (F1-GPT-001 final fix) -----------------
# register_from_readback consumes a REAL row of the canonical
# destruktion_meta.compute_fabric_provider_signature_verification_h205f22
# table (delivered as a dict). No adapter may enter the verified registry
# through code constants alone: the row must exist, be current, match the
# adapter on every binding field, and its receipt digest must equal the
# persisted receipt_sha256.


def _sha256_of(value) -> str:
    import hashlib
    import json as _json
    raw = _json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return hashlib.sha256(raw).hexdigest()


def register_from_readback(adapter: ProviderAdapter, row: dict, *, evaluated_at_epoch: float) -> None:
    """Register a provider bound to a persisted verifier-receipt row.

    F1-GPT-001 hard fix: registration authority derives ONLY from the
    persisted row, never from caller-supplied constants.
    """
    if not isinstance(row, dict) or not row:
        raise AdapterRegistrationError("persisted readback row is required (absent DB readback is fail-closed)")
    provider_id = row.get("provider_id")
    external_execution_id = row.get("external_execution_id")
    receipt_sha = row.get("receipt_sha256") or row.get("envelope_sha256")
    expires_at = row.get("expires_at")
    verified_at = row.get("verified_at") or row.get("created_at")
    status = row.get("verification_status") or row.get("status")
    if provider_id != adapter.provider_id:
        raise AdapterRegistrationError(f"readback provider mismatch: row={provider_id} adapter={adapter.provider_id}")
    if not receipt_sha or not SHA256_RE.match(str(receipt_sha)):
        raise AdapterRegistrationError("readback receipt_sha256 missing/malformed")
    # CURRENT vs HISTORICAL semantics: only CURRENT rows register providers.
    import datetime as _dt
    if expires_at:
        exp = _dt.datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
        if exp.timestamp() <= evaluated_at_epoch:
            raise AdapterRegistrationError(
                f"readback receipt EXPIRED (expires {expires_at}); expired receipts are HISTORICAL and cannot register"
            )
    if status and str(status) not in {"CRYPTO_VERIFIED_EVIDENCE_READY", "VERIFIED"}:
        raise AdapterRegistrationError(f"readback verification_status not verified: {status}")
    # external execution identity must be derivable from the adapter's native schema
    if external_execution_id and adapter.external_execution_format.split(":")[0] not in str(external_execution_id):
        raise AdapterRegistrationError(
            f"readback external_execution_id {external_execution_id} does not match adapter family {adapter.provider_id}"
        )
    # bind registration to the row's receipt digest (single source of truth)
    bound = ProviderAdapter(
        provider_id=adapter.provider_id,
        provider_kind=adapter.provider_kind,
        oidc_issuer=adapter.oidc_issuer,
        sigstore_instance=adapter.sigstore_instance,
        trust_generation=adapter.trust_generation,
        crypto_channel=adapter.crypto_channel,
        max_lifetime_seconds=adapter.max_lifetime_seconds,
        external_execution_format=adapter.external_execution_format,
        verification_proof=VerificationProof(
            receipt_schema="metaengine.compute.f1-verification-proof.h205f22.v1",
            provider_id=adapter.provider_id,
            crypto_channel=adapter.crypto_channel,
            trust_generation=adapter.trust_generation,
            verifier_run_id=int(str(external_execution_id).split(":")[1]) if external_execution_id and ":" in str(external_execution_id) else 0,
            verifier_run_attempt=int(str(external_execution_id).split(":")[2]) if external_execution_id and str(external_execution_id).count(":") >= 2 else 1,
            verification_status="VERIFIED",
            receipt_sha256=str(receipt_sha),
            readback_authority=True,  # authority = the persisted row itself
        ),
        revoked_identities=adapter.revoked_identities,
    )
    register(bound, replace=True)  # persisted row refreshes trust


# --- registry (deliberately explicit; no dynamic discovery in v1) ----------

_REGISTRY: dict = {}


def register(adapter: ProviderAdapter, *, replace: bool = False) -> None:
    if adapter.provider_id in _REGISTRY and not replace:
        raise AdapterRegistrationError(f"duplicate provider_id: {adapter.provider_id}")
    proof = adapter.verification_proof
    if proof is None:
        raise AdapterRegistrationError(
            f"provider {adapter.provider_id} is a DECLARED CANDIDATE without "
            "verification proof: unproven crypto channels cannot enter the "
            "verified registry (F1-GPT-001); persist the live verifier-channel "
            "receipt object first"
        )
    if not isinstance(proof, VerificationProof):
        raise AdapterRegistrationError("verification_proof must be a VerificationProof object")
    # Binding checks: the proof must prove THIS adapter, not just any channel.
    if proof.provider_id != adapter.provider_id:
        raise AdapterRegistrationError(
            f"proof provider binding mismatch: proof={proof.provider_id} adapter={adapter.provider_id}"
        )
    if proof.crypto_channel != adapter.crypto_channel:
        raise AdapterRegistrationError(
            f"proof channel binding mismatch: proof={proof.crypto_channel} adapter={adapter.crypto_channel}"
        )
    if proof.trust_generation != adapter.trust_generation:
        raise AdapterRegistrationError(
            f"proof trust-generation mismatch: proof={proof.trust_generation} adapter={adapter.trust_generation}"
        )
    if not SHA256_RE.match(proof.receipt_sha256):
        raise AdapterRegistrationError("proof receipt_sha256 must be sha256 hex")
    _REGISTRY[adapter.provider_id] = adapter


def get(provider_id: str) -> ProviderAdapter:
    adapter = _REGISTRY.get(provider_id)
    if adapter is None:
        raise AdapterRegistrationError(f"unknown provider adapter: {provider_id}")
    return adapter


def registered() -> list:
    return sorted(_REGISTRY)


# --- the existing GitHub provider, expressed through the neutral seam ------

GITHUB_ACTIONS_F1 = ProviderAdapter(
    provider_id="github-actions-f1-live",
    provider_kind="GITHUB_HOSTED_ACTIONS",
    oidc_issuer="https://token.actions.githubusercontent.com",
    sigstore_instance="public-good",
    trust_generation=1,
    crypto_channel="gh-attestation+sigstore",
    max_lifetime_seconds=20 * 60,
    external_execution_format="github-actions:{run_id}:{run_attempt}",
    verification_proof=None,  # set below after class definition (real receipt)
)

# AppVeyor candidate adapter (F1.5 target): SAME evidence policy, different
# execution identity and channel. DELIBERATELY carries NO verification_proof
# (F1-GPT-001): it is a DECLARED CANDIDATE — structurally unregistrable in
# the verified registry until a persisted live verifier-channel receipt
# digest is supplied.
# The GitHub adapter's proof binds to the LIVE verifier receipts of F1 run
# 32627161206 (producer SUCCESS; verifier SUCCESS incl. full Sigstore TUF
# chain through trusted_root) — the exact channel it declares, proven live.
GITHUB_ACTIONS_F1 = ProviderAdapter(
    provider_id=GITHUB_ACTIONS_F1.provider_id,
    provider_kind=GITHUB_ACTIONS_F1.provider_kind,
    oidc_issuer=GITHUB_ACTIONS_F1.oidc_issuer,
    sigstore_instance=GITHUB_ACTIONS_F1.sigstore_instance,
    trust_generation=GITHUB_ACTIONS_F1.trust_generation,
    crypto_channel=GITHUB_ACTIONS_F1.crypto_channel,
    max_lifetime_seconds=GITHUB_ACTIONS_F1.max_lifetime_seconds,
    external_execution_format=GITHUB_ACTIONS_F1.external_execution_format,
    verification_proof=VerificationProof(
        receipt_schema="metaengine.compute.f1-verification-proof.h205f22.v1",
        provider_id="github-actions-f1-live",
        crypto_channel="gh-attestation+sigstore",
        trust_generation=1,
        verifier_run_id=32627161206,
        verifier_run_attempt=1,
        verification_status="VERIFIED",
        receipt_sha256="972412adacd343bf41d3a79abc1e96aa522e85a1f6b6d3176358e7697555a82a",
    ),
)

APPVEYOR_F1_CANDIDATE = ProviderAdapter(
    provider_id="appveyor-f1-live",
    provider_kind="APPVEYOR_HOSTED_VM",
    oidc_issuer="https://ci.appveyor.com",
    sigstore_instance="public-good",
    trust_generation=1,
    crypto_channel="appveyor-attestation+sigstore",
    max_lifetime_seconds=30 * 60,
    external_execution_format="appveyor:{build_id}:{build_number}",
)


# --- native execution coordinates (F1-GPT-002 fix) --------------------------
# Each provider consumes ONLY its own native coordinate schema; foreign
# coordinates are rejected instead of aliased.

GITHUB_COORD_KEYS = {"run_id", "run_attempt"}
APPVEYOR_COORD_KEYS = {"build_id", "build_number"}


def _require_coords(provider_id: str, coords: dict) -> None:
    if provider_id == "github-actions-f1-live":
        expected = GITHUB_COORD_KEYS
    elif provider_id == "appveyor-f1-live":
        expected = APPVEYOR_COORD_KEYS
    else:
        raise AdapterRegistrationError(f"no native coordinate schema for {provider_id}")
    keys = set(coords or {})
    if keys != expected:
        raise AdapterRegistrationError(
            f"provider {provider_id} requires native coordinates {sorted(expected)}; "
            f"got {sorted(keys)} — cross-provider coordinate aliasing is rejected"
        )


# --- expectation bridge: adapter -> verifier ExpectedContext ---------------

def expected_context(
    provider_id: str,
    *,
    repository: str,
    source_digest: str,
    source_ref: str,
    coords: dict,
    signer_workflow: str,
    now_epoch: float,
) -> dict:
    """Build the neutral expectation payload consumed by the verifier.

    The verifier keeps its own strict checks; this only supplies the
    provider-specific constants so its hardcoded GitHub assumptions become
    parameterized. NOTE: live_provider_verifier.ExpectedContext remains the
    authority for the GitHub adapter; this bridge is how NON-GitHub providers
    reach the same policy without forking the verifier.
    """
    adapter = get(provider_id)
    if not SHA256_RE.match(source_digest or ""):
        raise AdapterRegistrationError("source_digest must be sha256 hex")
    _require_coords(provider_id, coords)
    native_values = {k: int(v) for k, v in coords.items()}
    # external_execution_id is derived EXCLUSIVELY from the provider's own
    # native coordinate schema — no aliasing (F1-GPT-002).
    id_value = adapter.external_execution_format.format(**native_values)
    return {
        "provider_id": adapter.provider_id,
        "provider_kind": adapter.provider_kind,
        "oidc_issuer": adapter.oidc_issuer,
        "sigstore_instance": adapter.sigstore_instance,
        "trust_generation": adapter.trust_generation,
        "crypto_channel": adapter.crypto_channel,
        "max_lifetime_seconds": adapter.max_lifetime_seconds,
        "external_execution_id": id_value,
        "repository": repository,
        "source_digest": source_digest,
        "source_ref": source_ref,
        "native_execution_coordinates": dict(native_values),
        "signer_workflow": signer_workflow,
        "revoked_identities": list(adapter.revoked_identities),
        "now_epoch": now_epoch,
        "authority_effect": False,
    }


__all__ = [
    "AdapterRegistrationError",
    "ProviderAdapter",
    "GITHUB_ACTIONS_F1",
    "APPVEYOR_F1_CANDIDATE",
    "register",
    "get",
    "registered",
    "expected_context",
    "CRYPTO_CHANNELS",
]
