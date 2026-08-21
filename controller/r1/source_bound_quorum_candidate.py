#!/usr/bin/env python3
"""Bind a verified STEP07 source handoff to the existing two-domain quorum candidate.

This is deliberately not an R2 authority transition. It only replaces the historical
"source attestation not yet verified" condition on the provider candidate with an
explicitly validated STEP07A handoff, preserving all provider/readback nonclaims.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

HANDOFF_SCHEMA = "metaengine.compute.r1-verified-source-handoff.h205f22.v1"
BASE_SCHEMA = "metaengine.compute.r1-live-two-domain-orchestration-result.h205f22.v1"
OUT_SCHEMA = "metaengine.compute.r1-source-bound-two-domain-candidate.h205f22.v1"
SHA256 = re.compile(r"^[0-9a-f]{64}$")


class SourceBoundQuorumError(RuntimeError):
    pass


def _canonical(value: Any) -> bytes:
    return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


def _read(path: Path, label: str) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError,json.JSONDecodeError) as exc:
        raise SourceBoundQuorumError(f"{label}_invalid_json") from exc


def _self_hash(value: dict[str,Any], field: str, label: str) -> str:
    claimed=value.get(field)
    if not isinstance(claimed,str) or not SHA256.fullmatch(claimed):
        raise SourceBoundQuorumError(f"{label}_{field}_invalid")
    core=dict(value); core.pop(field,None)
    if _sha(core)!=claimed:
        raise SourceBoundQuorumError(f"{label}_{field}_mismatch")
    return claimed


def bind_candidate(base: Any, handoff: Any) -> dict[str,Any]:
    if not isinstance(base,dict) or base.get("schema")!=BASE_SCHEMA:
        raise SourceBoundQuorumError("base_schema_invalid")
    base_sha=_self_hash(base,"orchestration_result_sha256","base")
    if base.get("classification")!="TWO_DOMAIN_PROVIDER_READBACK_CANDIDATE_NONAUTHORITATIVE":
        raise SourceBoundQuorumError("base_classification_invalid")
    if base.get("source_attestation_verified") is not False or base.get("source_attestation_required_before_authority") is not True:
        raise SourceBoundQuorumError("base_source_gate_boundary_invalid")
    if any(base.get(k) is not False for k in ("canonical","authority_effect","r2_proven","r3_proven","persisted_seal_allowed")):
        raise SourceBoundQuorumError("base_authority_boundary_invalid")
    quorum=base.get("quorum")
    if not isinstance(quorum,dict) or quorum.get("candidate_ready") is not True:
        raise SourceBoundQuorumError("base_quorum_not_ready")
    if quorum.get("distinct_operator_classes")!=2 or quorum.get("strong_immutability_domains")!=2:
        raise SourceBoundQuorumError("base_quorum_independence_invalid")

    if not isinstance(handoff,dict) or handoff.get("schema")!=HANDOFF_SCHEMA:
        raise SourceBoundQuorumError("handoff_schema_invalid")
    handoff_sha=_self_hash(handoff,"handoff_sha256","handoff")
    if handoff.get("source_attestation_verified") is not True:
        raise SourceBoundQuorumError("handoff_source_attestation_not_verified")
    if handoff.get("provider_credentials_eligible_after_environment_and_readiness_gates") is not True:
        raise SourceBoundQuorumError("handoff_provider_eligibility_missing")
    if handoff.get("provider_execution_authorized") is not False:
        raise SourceBoundQuorumError("handoff_must_not_authorize_provider")
    if any(handoff.get(k) is not False for k in ("canonical","authority_effect","r2_proven","r3_proven","persisted_seal_allowed")):
        raise SourceBoundQuorumError("handoff_authority_boundary_invalid")
    if handoff.get("final_r2_evidence_binding_required") is not True:
        raise SourceBoundQuorumError("handoff_final_binding_requirement_missing")

    bs=base.get("source") or {}
    hs=handoff.get("source") or {}
    for field in ("run_id","head_sha","workflow_path"):
        if bs.get(field)!=hs.get(field):
            raise SourceBoundQuorumError(f"source_identity_mismatch:{field}")
    bc=base.get("ciphertext") or {}
    if bc.get("sha256")!=hs.get("ciphertext_sha256") or bc.get("bytes")!=hs.get("ciphertext_bytes"):
        raise SourceBoundQuorumError("ciphertext_identity_mismatch")

    core={
        "schema":OUT_SCHEMA,
        "classification":"VERIFIED_SOURCE_TWO_DOMAIN_PROVIDER_READBACK_CANDIDATE_NONAUTHORITATIVE",
        "source":bs,
        "ciphertext":bc,
        "provider_results":base.get("provider_results"),
        "quorum":quorum,
        "source_provenance":{
            "source_attestation_verified":True,
            "handoff_sha256":handoff_sha,
            "source_verification_artifact":hs.get("source_verification_artifact"),
            "source_verification_receipt_sha256":hs.get("source_verification_receipt_sha256"),
            "predicate_sha256":hs.get("predicate_sha256"),
            "canonical_digest_at_source":hs.get("canonical_digest_at_source"),
            "semantic_head_at_source":hs.get("semantic_head_at_source"),
            "migration_ledger_sha256":hs.get("migration_ledger_sha256"),
        },
        "base_orchestration_result_sha256":base_sha,
        "source_attestation_verified":True,
        "final_r2_evidence_binding_required":True,
        "canonical":False,
        "authority_effect":False,
        "r2_proven":False,
        "r3_proven":False,
        "persisted_seal_allowed":False,
        "required_next":"BIND_SOURCE_HANDOFF_READINESS_AND_PROVIDER_RESULT_HASHES_IN_FINAL_R2_EVIDENCE_THEN_SUPERVISOR_INGEST_AND_REEVALUATE_R2",
    }
    out=dict(core); out["candidate_sha256"]=_sha(core)
    return out


def main(argv=None) -> int:
    p=argparse.ArgumentParser()
    p.add_argument("--base",required=True)
    p.add_argument("--handoff",required=True)
    p.add_argument("--output",required=True)
    a=p.parse_args(argv)
    try:
        out=bind_candidate(_read(Path(a.base),"base"),_read(Path(a.handoff),"handoff"))
        Path(a.output).parent.mkdir(parents=True,exist_ok=True)
        Path(a.output).write_bytes(_canonical(out)+b"\n")
        return 0
    except SourceBoundQuorumError as exc:
        print(f"R1_SOURCE_BOUND_QUORUM_REJECTED:{exc}",file=sys.stderr)
        return 1


if __name__=="__main__":
    raise SystemExit(main())
