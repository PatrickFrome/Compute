#!/usr/bin/env python3
"""Provider-neutral F1 adapter registry with DB-backed admission.

ProviderAdapter is declaration-only. Direct registration is forbidden. The
production path accepts only an immutable verification UUID, performs its own
fixed Supabase persisted-readback RPC call, validates CURRENT/fresh bindings,
and only then populates a non-authority local cache. Caller-supplied row or
receipt objects cannot grant registration.
"""
from __future__ import annotations
import datetime as _dt
import json,os,re,urllib.error,urllib.request,uuid
from dataclasses import dataclass,field
SHA256_RE=re.compile(r"^[0-9a-f]{64}$"); OIDC_RE=re.compile(r"^https://[a-z0-9.-]+[a-z]$")
EXECUTION_ID_RE={"github-actions-f1-live":re.compile(r"^github-actions:([1-9][0-9]*):([1-9][0-9]*)$"),"appveyor-f1-live":re.compile(r"^appveyor:([1-9][0-9]*):([1-9][0-9]*)$")}
CRYPTO_CHANNELS={"gh-attestation+sigstore","appveyor-attestation+sigstore","manual-cosign+sigstore"}
SUPABASE_URL="https://xpeibufgzjknrhbhpffp.supabase.co"; READBACK_RPC="h205f22_read_signature_verification_v1"; READBACK_SCHEMA="metaengine.compute.provider-signature-readback.h205f22.v1"; READBACK_SOURCE="SUPABASE_PERSISTED_READBACK"
class AdapterRegistrationError(ValueError): pass
@dataclass(frozen=True)
class ProviderAdapter:
    provider_id:str; provider_kind:str; oidc_issuer:str; sigstore_instance:str; trust_generation:int; crypto_channel:str; max_lifetime_seconds:int; external_execution_format:str; repository:str; signer_workflow:str; revoked_identities:tuple=field(default_factory=tuple)
    def __post_init__(self):
        if not re.fullmatch(r"[A-Za-z0-9._:-]{1,96}",self.provider_id or ""): raise AdapterRegistrationError("provider_id invalid")
        if not re.fullmatch(r"[A-Za-z0-9._:-]{1,64}",self.provider_kind or ""): raise AdapterRegistrationError("provider_kind invalid")
        if not OIDC_RE.fullmatch(self.oidc_issuer or ""): raise AdapterRegistrationError("oidc_issuer must be an https URL")
        if self.sigstore_instance not in {"public-good","staging"}: raise AdapterRegistrationError("unsupported sigstore instance")
        if type(self.trust_generation) is not int or self.trust_generation<1: raise AdapterRegistrationError("trust_generation must be positive integer")
        if self.crypto_channel not in CRYPTO_CHANNELS: raise AdapterRegistrationError("unsupported cryptographic verification channel")
        if type(self.max_lifetime_seconds) is not int or not 60<=self.max_lifetime_seconds<=24*3600: raise AdapterRegistrationError("max_lifetime_seconds out of policy range")
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+",self.repository or ""): raise AdapterRegistrationError("repository must be owner/name")
        if self.provider_id=="github-actions-f1-live" and not self.signer_workflow.startswith(f"{self.repository}/.github/workflows/"): raise AdapterRegistrationError("GitHub signer_workflow outside bound repository")
        tmpl=set(re.findall(r"\{([a-z_]+)\}",self.external_execution_format)); expected={"run_id","run_attempt"} if self.provider_id=="github-actions-f1-live" else {"build_id","build_number"} if self.provider_id=="appveyor-f1-live" else tmpl
        if tmpl!=expected or len(tmpl)<2: raise AdapterRegistrationError("external_execution_format must use exact provider-native coordinates")
@dataclass(frozen=True)
class RegisteredProvider:
    adapter:ProviderAdapter; verification_id:str; verifier_id:str; external_execution_id:str; receipt_sha256:str; expires_at:str; signed_claims_sha256:str; envelope_sha256:str; payload_type:str
_REGISTRY:dict[str,RegisteredProvider]={}
def register(_adapter:ProviderAdapter,*,replace:bool=False)->None:
    del replace; raise AdapterRegistrationError("direct provider registration is forbidden; use register_from_supabase(verification_id)")
def get(provider_id:str)->ProviderAdapter:
    e=_REGISTRY.get(provider_id)
    if e is None: raise AdapterRegistrationError(f"provider is not registered from CURRENT persisted readback: {provider_id}")
    return e.adapter
def get_registration(provider_id:str)->RegisteredProvider:
    e=_REGISTRY.get(provider_id)
    if e is None: raise AdapterRegistrationError(f"provider is not registered: {provider_id}")
    return e
def registered()->list[str]: return sorted(_REGISTRY)
def clear_registry_for_tests()->None: _REGISTRY.clear()
def _require_sha(v:object,label:str)->str:
    if not isinstance(v,str) or SHA256_RE.fullmatch(v) is None: raise AdapterRegistrationError(f"{label} must be lowercase sha256 hex")
    return v
def _parse_iso(v:object,label:str)->_dt.datetime:
    if not isinstance(v,str): raise AdapterRegistrationError(f"{label} must be ISO-8601")
    try: d=_dt.datetime.fromisoformat(v.replace("Z","+00:00"))
    except ValueError as exc: raise AdapterRegistrationError(f"{label} must be ISO-8601") from exc
    if d.tzinfo is None: raise AdapterRegistrationError(f"{label} must include timezone")
    return d
def _validate_projection(adapter:ProviderAdapter,projection:object,*,verification_id:str,evaluated_at_epoch:float)->RegisteredProvider:
    if not isinstance(projection,dict): raise AdapterRegistrationError("readback projection must be object")
    if projection.get("schema")!=READBACK_SCHEMA or projection.get("source_kind")!=READBACK_SOURCE: raise AdapterRegistrationError("invalid persisted-readback provenance/schema")
    if projection.get("readback_state")!="CURRENT": raise AdapterRegistrationError("only CURRENT persisted receipts may register")
    if projection.get("canonical") is not False or projection.get("authority_effect") is not False or projection.get("receipt_digest_valid") is not True: raise AdapterRegistrationError("readback integrity/authority flags invalid")
    row,provider,verifier=projection.get("verification"),projection.get("provider_binding"),projection.get("verifier_binding")
    if not all(isinstance(x,dict) for x in (row,provider,verifier)): raise AdapterRegistrationError("readback projection missing bound rows")
    try: expected_uuid=str(uuid.UUID(str(verification_id))); actual_uuid=str(uuid.UUID(str(row.get("verification_id"))))
    except (ValueError,AttributeError) as exc: raise AdapterRegistrationError("verification_id invalid") from exc
    if actual_uuid!=expected_uuid: raise AdapterRegistrationError("verification_id readback mismatch")
    if row.get("provider_id")!=adapter.provider_id or provider.get("provider_id")!=adapter.provider_id: raise AdapterRegistrationError("provider_id binding mismatch")
    if provider.get("provider_kind")!=adapter.provider_kind or provider.get("lifecycle_state") not in {"READY_FOR_PILOT","ACTIVE"} or provider.get("scheduler_eligible") is not False or provider.get("authority_effect") is not False: raise AdapterRegistrationError("provider binding invalid")
    if verifier.get("verifier_id")!=row.get("verifier_id") or verifier.get("verifier_kind")!="SIGSTORE_BUNDLE" or verifier.get("enabled") is not True or verifier.get("lifecycle_state") not in {"READY_FOR_PILOT","ACTIVE"} or verifier.get("authority_effect") is not False: raise AdapterRegistrationError("verifier binding invalid")
    if verifier.get("crypto_channel")!=adapter.crypto_channel or verifier.get("trust_generation")!=adapter.trust_generation: raise AdapterRegistrationError("verifier trust binding mismatch")
    if row.get("verification_status")!="VERIFIED" or row.get("canonical") is not False or row.get("authority_effect") is not False: raise AdapterRegistrationError("verification row status/authority invalid")
    if row.get("receipt_sha256")!=projection.get("receipt_recomputed_sha256"): raise AdapterRegistrationError("receipt digest/object mismatch")
    receipt_sha=_require_sha(row.get("receipt_sha256"),"receipt_sha256"); signed_sha=_require_sha(row.get("signed_claims_sha256"),"signed_claims_sha256"); envelope_sha=_require_sha(row.get("envelope_sha256"),"envelope_sha256")
    payload_type=row.get("payload_type")
    if not isinstance(payload_type,str) or not payload_type.startswith("application/vnd.in-toto"): raise AdapterRegistrationError("unsupported payload type")
    exec_id=row.get("external_execution_id"); matcher=EXECUTION_ID_RE.get(adapter.provider_id); match=matcher.fullmatch(exec_id) if matcher and isinstance(exec_id,str) else None
    if match is None: raise AdapterRegistrationError("external execution identity mismatch")
    run_id,run_attempt=int(match.group(1)),int(match.group(2)); evidence,signer=row.get("evidence"),row.get("signer_identity")
    if not isinstance(evidence,dict) or not isinstance(signer,dict): raise AdapterRegistrationError("persisted evidence/signer identity invalid")
    for key,expected in (("provider_kind",adapter.provider_kind),("crypto_channel",adapter.crypto_channel),("trust_generation",adapter.trust_generation),("repository",adapter.repository),("signer_workflow",adapter.signer_workflow),("oidc_issuer",adapter.oidc_issuer),("sigstore_instance",adapter.sigstore_instance),("run_id",run_id),("run_attempt",run_attempt)):
        if evidence.get(key)!=expected: raise AdapterRegistrationError(f"evidence {key} mismatch")
    for key in ("external_receipt_sha256","cryptographic_verification_sha256","sigstore_bundle_sha256","tuf_chain_verification_sha256","verifier_source_blob_sha256","verifier_workflow_blob_sha256"): _require_sha(evidence.get(key),f"evidence.{key}")
    if evidence.get("tuf_chain_status")!="FULL_TUF_CHAIN_CRYPTO_VERIFIED" or not isinstance(evidence.get("verifier_implementation"),str) or not evidence["verifier_implementation"]: raise AdapterRegistrationError("verifier/TUF evidence invalid")
    if signer.get("issuer")!=adapter.oidc_issuer or signer.get("workflow")!=adapter.signer_workflow: raise AdapterRegistrationError("signer identity mismatch")
    verified_at=_parse_iso(row.get("verified_at"),"verified_at"); expires_at=_parse_iso(row.get("expires_at"),"expires_at"); evaluated_at=_dt.datetime.fromtimestamp(float(evaluated_at_epoch),tz=_dt.timezone.utc)
    if expires_at<=verified_at or expires_at<=evaluated_at: raise AdapterRegistrationError("persisted receipt is invalid/HISTORICAL")
    if (expires_at-verified_at).total_seconds()>adapter.max_lifetime_seconds+30: raise AdapterRegistrationError("persisted receipt exceeds provider lifetime policy")
    return RegisteredProvider(adapter,actual_uuid,str(row["verifier_id"]),exec_id,receipt_sha,row["expires_at"],signed_sha,envelope_sha,payload_type)
def _readback_rpc(verification_id:str)->dict:
    key=os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not key: raise AdapterRegistrationError("SUPABASE_SERVICE_ROLE_KEY is required for persisted readback")
    payload=json.dumps({"p_verification_id":verification_id},separators=(",",":")).encode(); req=urllib.request.Request(f"{SUPABASE_URL}/rest/v1/rpc/{READBACK_RPC}",data=payload,method="POST",headers={"apikey":key,"authorization":f"Bearer {key}","content-type":"application/json","accept":"application/json"})
    try:
        with urllib.request.urlopen(req,timeout=15) as response:
            if response.status!=200: raise AdapterRegistrationError(f"persisted readback RPC returned HTTP {response.status}")
            result=json.loads(response.read())
    except (urllib.error.URLError,TimeoutError,json.JSONDecodeError) as exc: raise AdapterRegistrationError("persisted readback RPC failed") from exc
    if not isinstance(result,dict): raise AdapterRegistrationError("persisted readback RPC returned non-object")
    return result
def register_from_supabase(adapter:ProviderAdapter,verification_id:str)->RegisteredProvider:
    try: normalized=str(uuid.UUID(str(verification_id)))
    except (ValueError,AttributeError) as exc: raise AdapterRegistrationError("verification_id must be UUID") from exc
    projection=_readback_rpc(normalized); now=_dt.datetime.now(tz=_dt.timezone.utc); entry=_validate_projection(adapter,projection,verification_id=normalized,evaluated_at_epoch=now.timestamp()); _REGISTRY[adapter.provider_id]=entry; return entry
GITHUB_ACTIONS_F1=ProviderAdapter("github-actions-f1-live","GITHUB_HOSTED_ACTIONS","https://token.actions.githubusercontent.com","public-good",1,"gh-attestation+sigstore",20*60,"github-actions:{run_id}:{run_attempt}","PatrickFrome/Compute","PatrickFrome/Compute/.github/workflows/f1-live-provider-pr.yml")
APPVEYOR_F1_CANDIDATE=ProviderAdapter("appveyor-f1-live","APPVEYOR_HOSTED_VM","https://ci.appveyor.com","public-good",1,"appveyor-attestation+sigstore",30*60,"appveyor:{build_id}:{build_number}","PatrickFrome/Compute","PatrickFrome/Compute/.github/workflows/appveyor-f1.yml")
GITHUB_COORD_KEYS={"run_id","run_attempt"}; APPVEYOR_COORD_KEYS={"build_id","build_number"}
def _require_coords(provider_id:str,coords:dict)->None:
    expected=GITHUB_COORD_KEYS if provider_id==GITHUB_ACTIONS_F1.provider_id else APPVEYOR_COORD_KEYS if provider_id==APPVEYOR_F1_CANDIDATE.provider_id else None
    if expected is None or set(coords or {})!=expected: raise AdapterRegistrationError(f"provider {provider_id} requires provider-native coordinates {sorted(expected or [])}")
    for key,value in coords.items():
        if type(value) is not int or value<1: raise AdapterRegistrationError(f"coordinate {key} must be positive integer")
def expected_context(provider_id:str,*,repository:str,source_digest:str,source_ref:str,coords:dict,signer_workflow:str,now_epoch:float)->dict:
    a=get(provider_id)
    if repository!=a.repository or signer_workflow!=a.signer_workflow: raise AdapterRegistrationError("repository/signer differs from persisted provider binding")
    if not SHA256_RE.fullmatch(source_digest or ""): raise AdapterRegistrationError("source_digest must be sha256 hex")
    _require_coords(provider_id,coords); native=dict(coords); exec_id=a.external_execution_format.format(**native)
    return {"provider_id":a.provider_id,"provider_kind":a.provider_kind,"oidc_issuer":a.oidc_issuer,"sigstore_instance":a.sigstore_instance,"trust_generation":a.trust_generation,"crypto_channel":a.crypto_channel,"max_lifetime_seconds":a.max_lifetime_seconds,"external_execution_id":exec_id,"repository":repository,"source_digest":source_digest,"source_ref":source_ref,"native_execution_coordinates":native,"signer_workflow":signer_workflow,"revoked_identities":list(a.revoked_identities),"now_epoch":now_epoch,"authority_effect":False}
__all__=["AdapterRegistrationError","ProviderAdapter","RegisteredProvider","GITHUB_ACTIONS_F1","APPVEYOR_F1_CANDIDATE","register","register_from_supabase","get","get_registration","registered","expected_context","CRYPTO_CHANNELS"]
