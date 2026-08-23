#!/usr/bin/env python3
"""Provider-neutral F1 adapter registry with DB-backed admission.

Security boundary:
- ProviderAdapter is only a declaration/candidate.
- A candidate cannot be inserted into the verified registry directly.
- The production admission API accepts only a verification UUID, fetches the
  exact projection from the fixed Supabase persisted-readback RPC, validates
  its bindings/freshness, and only then populates the local non-authority cache.
- No caller-supplied ``dict`` can grant registration.

The database remains the source of authority. The in-process registry is only
a cache of CURRENT persisted verification receipts.
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import re
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field

SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
OIDC_RE = re.compile(r"^https://[a-z0-9.-]+[a-z]$")
EXECUTION_ID_RE = {
    "github-actions-f1-live": re.compile(r"^github-actions:([1-9][0-9]*):([1-9][0-9]*)$"),
    "appveyor-f1-live": re.compile(r"^appveyor:([1-9][0-9]*):([1-9][0-9]*)$"),
}
CRYPTO_CHANNELS = {"gh-attestation+sigstore", "appveyor-attestation+sigstore", "manual-cosign+sigstore"}
SUPABASE_URL = "https://xpeibufgzjknrhbhpffp.supabase.co"
READBACK_RPC = "h205f22_read_signature_verification_v1"
READBACK_SCHEMA = "metaengine.compute.provider-signature-readback.h205f22.v1"
READBACK_SOURCE = "SUPABASE_PERSISTED_READBACK"


class AdapterRegistrationError(ValueError):
    pass


@dataclass(frozen=True)
class ProviderAdapter:
    """Declaration of one provider; never an admission proof."""
    provider_id: str
    provider_kind: str
    oidc_issuer: str
    sigstore_instance: str
    trust_generation: int
    crypto_channel: str
    max_lifetime_seconds: int
    external_execution_format: str
    repository: str
    signer_workflow: str
    revoked_identities: tuple = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if not re.fullmatch(r"[A-Za-z0-9._:-]{1,96}", self.provider_id or ""): raise AdapterRegistrationError("provider_id invalid")
        if not re.fullmatch(r"[A-Za-z0-9._:-]{1,64}", self.provider_kind or ""): raise AdapterRegistrationError("provider_kind invalid")
        if not OIDC_RE.fullmatch(self.oidc_issuer or ""): raise AdapterRegistrationError("oidc_issuer must be an https URL")
        if self.sigstore_instance not in {"public-good", "staging"}: raise AdapterRegistrationError("unsupported sigstore instance")
        if type(self.trust_generation) is not int or self.trust_generation < 1: raise AdapterRegistrationError("trust_generation must be a positive integer")
        if self.crypto_channel not in CRYPTO_CHANNELS: raise AdapterRegistrationError("unsupported cryptographic verification channel")
        if type(self.max_lifetime_seconds) is not int or not (60 <= self.max_lifetime_seconds <= 24*3600): raise AdapterRegistrationError("max_lifetime_seconds out of policy range")
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", self.repository or ""): raise AdapterRegistrationError("repository must be owner/name")
        if self.provider_id == "github-actions-f1-live" and not self.signer_workflow.startswith(f"{self.repository}/.github/workflows/"): raise AdapterRegistrationError("GitHub signer_workflow is outside bound repository")
        tmpl=set(re.findall(r"\{([a-z_]+)\}",self.external_execution_format))
        expected={"run_id","run_attempt"} if self.provider_id=="github-actions-f1-live" else {"build_id","build_number"} if self.provider_id=="appveyor-f1-live" else tmpl
        if tmpl != expected or len(tmpl)<2: raise AdapterRegistrationError("external_execution_format must use the exact provider-native coordinates")


@dataclass(frozen=True)
class RegisteredProvider:
    adapter: ProviderAdapter
    verification_id: str
    verifier_id: str
    external_execution_id: str
    receipt_sha256: str
    expires_at: str
    signed_claims_sha256: str
    envelope_sha256: str
    payload_type: str


_REGISTRY: dict[str, RegisteredProvider] = {}


def register(_adapter: ProviderAdapter, *, replace: bool=False) -> None:
    del replace
    raise AdapterRegistrationError("direct provider registration is forbidden; use register_from_supabase(verification_id)")


def get(provider_id: str) -> ProviderAdapter:
    entry=_REGISTRY.get(provider_id)
    if entry is None: raise AdapterRegistrationError(f"provider is not registered from CURRENT persisted readback: {provider_id}")
    return entry.adapter


def get_registration(provider_id: str) -> RegisteredProvider:
    entry=_REGISTRY.get(provider_id)
    if entry is None: raise AdapterRegistrationError(f"provider is not registered: {provider_id}")
    return entry


def registered() -> list[str]: return sorted(_REGISTRY)
def clear_registry_for_tests() -> None: _REGISTRY.clear()


def _require_sha(value: object,label: str)->str:
    if not isinstance(value,str) or SHA256_RE.fullmatch(value) is None: raise AdapterRegistrationError(f"{label} must be lowercase sha256 hex")
    return value


def _parse_iso(value: object,label: str)->_dt.datetime:
    if not isinstance(value,str): raise AdapterRegistrationError(f"{label} must be ISO-8601")
    try: parsed=_dt.datetime.fromisoformat(value.replace("Z","+00:00"))
    except ValueError as exc: raise AdapterRegistrationError(f"{label} must be ISO-8601") from exc
    if parsed.tzinfo is None: raise AdapterRegistrationError(f"{label} must include timezone")
    return parsed


def _validate_projection(adapter: ProviderAdapter,projection: object,*,verification_id: str,evaluated_at_epoch: float)->RegisteredProvider:
    """Validate DB projection only. This helper never registers anything."""
    if not isinstance(projection,dict): raise AdapterRegistrationError("readback projection must be an object")
    if projection.get("schema")!=READBACK_SCHEMA: raise AdapterRegistrationError("unsupported persisted-readback schema")
    if projection.get("source_kind")!=READBACK_SOURCE: raise AdapterRegistrationError("readback provenance is not Supabase persisted readback")
    if projection.get("readback_state")!="CURRENT": raise AdapterRegistrationError("only CURRENT persisted receipts may register")
    if projection.get("canonical") is not False or projection.get("authority_effect") is not False: raise AdapterRegistrationError("readback authority flags invalid")
    if projection.get("receipt_digest_valid") is not True: raise AdapterRegistrationError("database receipt digest was not revalidated")
    row,provider,verifier=projection.get("verification"),projection.get("provider_binding"),projection.get("verifier_binding")
    if not all(isinstance(x,dict) for x in (row,provider,verifier)): raise AdapterRegistrationError("readback projection missing bound rows")
    try: expected_uuid=str(uuid.UUID(str(verification_id))); actual_uuid=str(uuid.UUID(str(row.get("verification_id"))))
    except (ValueError,AttributeError) as exc: raise AdapterRegistrationError("verification_id invalid") from exc
    if actual_uuid!=expected_uuid: raise AdapterRegistrationError("verification_id readback mismatch")
    if row.get("provider_id")!=adapter.provider_id or provider.get("provider_id")!=adapter.provider_id: raise AdapterRegistrationError("provider_id binding mismatch")
    if provider.get("provider_kind")!=adapter.provider_kind: raise AdapterRegistrationError("provider_kind binding mismatch")
    if provider.get("lifecycle_state") not in {"READY_FOR_PILOT","ACTIVE"}: raise AdapterRegistrationError("provider binding is not live enough")
    if provider.get("scheduler_eligible") is not False: raise AdapterRegistrationError("F1 provider must not gain scheduler authority")
    if provider.get("authority_effect") is not False: raise AdapterRegistrationError("provider binding authority_effect must be false")
    if verifier.get("verifier_id")!=row.get("verifier_id"): raise AdapterRegistrationError("verifier_id binding mismatch")
    if verifier.get("verifier_kind")!="SIGSTORE_BUNDLE": raise AdapterRegistrationError("wrong verifier kind")
    if verifier.get("enabled") is not True or verifier.get("lifecycle_state") not in {"READY_FOR_PILOT","ACTIVE"}: raise AdapterRegistrationError("signature verifier is not active")
    if verifier.get("authority_effect") is not False: raise AdapterRegistrationError("verifier authority_effect must be false")
    if verifier.get("crypto_channel")!=adapter.crypto_channel: raise AdapterRegistrationError("crypto channel binding mismatch")
    if verifier.get("trust_generation")!=adapter.trust_generation: raise AdapterRegistrationError("trust generation binding mismatch")
    if row.get("verification_status")!="VERIFIED": raise AdapterRegistrationError("persisted verification status is not VERIFIED")
    if row.get("canonical") is not False or row.get("authority_effect") is not False: raise AdapterRegistrationError("verification row authority flags invalid")
    if row.get("receipt_sha256")!=projection.get("receipt_recomputed_sha256"): raise AdapterRegistrationError("receipt digest/object mismatch")
    receipt_sha=_require_sha(row.get("receipt_sha256"),"receipt_sha256"); signed_sha=_require_sha(row.get("signed_claims_sha256"),"signed_claims_sha256"); envelope_sha=_require_sha(row.get("envelope_sha256"),"envelope_sha256")
    payload_type=row.get("payload_type")
    if not isinstance(payload_type,str) or not payload_type.startswith("application/vnd.in-toto"): raise AdapterRegistrationError("unsupported payload type")
    exec_id=row.get("external_execution_id"); matcher=EXECUTION_ID_RE.get(adapter.provider_id)
    if matcher is None or not isinstance(exec_id,str): raise AdapterRegistrationError("provider execution identity schema unavailable")
    match=matcher.fullmatch(exec_id)
    if match is None: raise AdapterRegistrationError("external execution identity mismatch")
    run_id,run_attempt=int(match.group(1)),int(match.group(2))
    evidence,signer=row.get("evidence"),row.get("signer_identity")
    if not isinstance(evidence,dict) or not isinstance(signer,dict): raise AdapterRegistrationError("persisted evidence/signer identity invalid")
    checks=(("provider_kind",adapter.provider_kind),("crypto_channel",adapter.crypto_channel),("trust_generation",adapter.trust_generation),("repository",adapter.repository),("signer_workflow",adapter.signer_workflow),("oidc_issuer",adapter.oidc_issuer),("sigstore_instance",adapter.sigstore_instance),("run_id",run_id),("run_attempt",run_attempt))
    for key,expected in checks:
        if evidence.get(key)!=expected: raise AdapterRegistrationError(f"evidence {key} mismatch")
    for key in ("external_receipt_sha256","cryptographic_verification_sha256","sigstore_bundle_sha256","tuf_chain_verification_sha256","verifier_source_blob_sha256","verifier_workflow_blob_sha256"): _require_sha(evidence.get(key),f"evidence.{key}")
    if evidence.get("tuf_chain_status")!="FULL_TUF_CHAIN_CRYPTO_VERIFIED": raise AdapterRegistrationError("full TUF chain evidence missing")
    if not isinstance(evidence.get("verifier_implementation"),str) or not evidence["verifier_implementation"]: raise AdapterRegistrationError("verifier implementation identity missing")
    if signer.get("issuer")!=adapter.oidc_issuer or signer.get("workflow")!=adapter.signer_workflow: raise AdapterRegistrationError("signer identity mismatch")
    verified_at=_parse_iso(row.get("verified_at"),"verified_at"); expires_at=_parse_iso(row.get("expires_at"),"expires_at"); evaluated_at=_dt.datetime.fromtimestamp(float(evaluated_at_epoch),tz=_dt.timezone.utc)
    if expires_at<=verified_at: raise AdapterRegistrationError("receipt expiry ordering invalid")
    if expires_at<=evaluated_at: raise AdapterRegistrationError("persisted receipt is HISTORICAL/expired")
    if (expires_at-verified_at).total_seconds()>adapter.max_lifetime_seconds+30: raise AdapterRegistrationError("persisted receipt exceeds provider lifetime policy")
    return RegisteredProvider(adapter,actual_uuid,str(row["verifier_id"]),exec_id,receipt_sha,row["expires_at"],signed_sha,envelope_sha,payload_type)


def _readback_rpc(verification_id: str,evaluated_at: _dt.datetime)->dict:
    key=os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not key: raise AdapterRegistrationError("SUPABASE_SERVICE_ROLE_KEY is required for persisted readback")
    payload=json.dumps({"p_verification_id":verification_id,"p_evaluated_at":evaluated_at.isoformat()},separators=(",",":")).encode()
    request=urllib.request.Request(f"{SUPABASE_URL}/rest/v1/rpc/{READBACK_RPC}",data=payload,method="POST",headers={"apikey":key,"authorization":f"Bearer {key}","content-type":"application/json","accept":"application/json"})
    try:
        with urllib.request.urlopen(request,timeout=15) as response:
            if response.status!=200: raise AdapterRegistrationError(f"persisted readback RPC returned HTTP {response.status}")
            result=json.loads(response.read())
    except (urllib.error.URLError,TimeoutError,json.JSONDecodeError) as exc: raise AdapterRegistrationError("persisted readback RPC failed") from exc
    if not isinstance(result,dict): raise AdapterRegistrationError("persisted readback RPC returned non-object")
    return result


def register_from_supabase(adapter: ProviderAdapter,verification_id: str,*,evaluated_at_epoch: float|None=None)->RegisteredProvider:
    try: normalized=str(uuid.UUID(str(verification_id)))
    except (ValueError,AttributeError) as exc: raise AdapterRegistrationError("verification_id must be UUID") from exc
    evaluated_at=_dt.datetime.now(tz=_dt.timezone.utc) if evaluated_at_epoch is None else _dt.datetime.fromtimestamp(float(evaluated_at_epoch),tz=_dt.timezone.utc)
    projection=_readback_rpc(normalized,evaluated_at); entry=_validate_projection(adapter,projection,verification_id=normalized,evaluated_at_epoch=evaluated_at.timestamp()); _REGISTRY[adapter.provider_id]=entry; return entry


GITHUB_ACTIONS_F1=ProviderAdapter("github-actions-f1-live","GITHUB_HOSTED_ACTIONS","https://token.actions.githubusercontent.com","public-good",1,"gh-attestation+sigstore",20*60,"github-actions:{run_id}:{run_attempt}","PatrickFrome/Compute","PatrickFrome/Compute/.github/workflows/f1-live-provider-pr.yml")
APPVEYOR_F1_CANDIDATE=ProviderAdapter("appveyor-f1-live","APPVEYOR_HOSTED_VM","https://ci.appveyor.com","public-good",1,"appveyor-attestation+sigstore",30*60,"appveyor:{build_id}:{build_number}","PatrickFrome/Compute","PatrickFrome/Compute/.github/workflows/appveyor-f1.yml")
GITHUB_COORD_KEYS={"run_id","run_attempt"}; APPVEYOR_COORD_KEYS={"build_id","build_number"}


def _require_coords(provider_id: str,coords: dict)->None:
    expected=GITHUB_COORD_KEYS if provider_id==GITHUB_ACTIONS_F1.provider_id else APPVEYOR_COORD_KEYS if provider_id==APPVEYOR_F1_CANDIDATE.provider_id else None
    if expected is None or set(coords or {})!=expected: raise AdapterRegistrationError(f"provider {provider_id} requires provider-native coordinates {sorted(expected or [])}")
    for key,value in coords.items():
        if type(value) is not int or value<1: raise AdapterRegistrationError(f"coordinate {key} must be positive integer")


def expected_context(provider_id: str,*,repository: str,source_digest: str,source_ref: str,coords: dict,signer_workflow: str,now_epoch: float)->dict:
    adapter=get(provider_id)
    if repository!=adapter.repository: raise AdapterRegistrationError("repository differs from persisted provider binding")
    if signer_workflow!=adapter.signer_workflow: raise AdapterRegistrationError("signer workflow differs from persisted provider binding")
    if not SHA256_RE.fullmatch(source_digest or ""): raise AdapterRegistrationError("source_digest must be sha256 hex")
    _require_coords(provider_id,coords); native=dict(coords); exec_id=adapter.external_execution_format.format(**native)
    return {"provider_id":adapter.provider_id,"provider_kind":adapter.provider_kind,"oidc_issuer":adapter.oidc_issuer,"sigstore_instance":adapter.sigstore_instance,"trust_generation":adapter.trust_generation,"crypto_channel":adapter.crypto_channel,"max_lifetime_seconds":adapter.max_lifetime_seconds,"external_execution_id":exec_id,"repository":repository,"source_digest":source_digest,"source_ref":source_ref,"native_execution_coordinates":native,"signer_workflow":signer_workflow,"revoked_identities":list(adapter.revoked_identities),"now_epoch":now_epoch,"authority_effect":False}


__all__=["AdapterRegistrationError","ProviderAdapter","RegisteredProvider","GITHUB_ACTIONS_F1","APPVEYOR_F1_CANDIDATE","register","register_from_supabase","get","get_registration","registered","expected_context","CRYPTO_CHANNELS"]
