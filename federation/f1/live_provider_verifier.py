#!/usr/bin/env python3
"""F1 live external federation evidence policy.

This module deliberately separates transport/content observations from cryptographic
verification. A SHA-256 match is necessary for subject binding but is never treated
as signature verification. Cryptographic verification is performed by the verifier
job with `gh attestation verify` against GitHub OIDC/Sigstore identity constraints.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCHEMA = "metaengine.compute.f1-live-provider-evidence.h205f22.v1"
PROVIDER_ID = "github-actions-f1-live"
PROVIDER_KIND = "GITHUB_HOSTED_ACTIONS"
TRUST_GENERATION = 1
MAX_LIFETIME_SECONDS = 20 * 60


class PolicyError(ValueError):
    pass


def canonical_json(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def parse_time(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise PolicyError("timestamp must be timezone-aware")
    return parsed.astimezone(timezone.utc)


def replay_nonce(repository: str, source_digest: str, run_id: int, run_attempt: int, workflow_ref: str) -> str:
    material = "\n".join((repository, source_digest, str(run_id), str(run_attempt), workflow_ref)).encode("utf-8")
    return sha256_hex(material)


def signer_identity(signer_workflow: str, source_ref: str) -> str:
    return f"https://github.com/{signer_workflow}@{source_ref}"


@dataclass(frozen=True)
class ExpectedContext:
    repository: str
    source_digest: str
    source_ref: str
    run_id: int
    run_attempt: int
    signer_workflow: str
    trust_generation: int
    now: datetime
    revoked_identities: frozenset[str]


def validate_evidence(evidence: dict, expected: ExpectedContext) -> None:
    required = {
        "schema",
        "provider_id",
        "provider_kind",
        "repository",
        "source_digest",
        "source_ref",
        "run_id",
        "run_attempt",
        "external_execution_id",
        "workflow_ref",
        "signer_workflow",
        "signer_identity",
        "oidc_issuer",
        "sigstore_instance",
        "trust_generation",
        "issued_at",
        "expires_at",
        "replay_nonce",
        "verification_contract",
    }
    missing = sorted(required.difference(evidence))
    if missing:
        raise PolicyError(f"missing fields: {missing}")

    if evidence["schema"] != SCHEMA:
        raise PolicyError("schema mismatch")
    if evidence["provider_id"] != PROVIDER_ID or evidence["provider_kind"] != PROVIDER_KIND:
        raise PolicyError("provider identity mismatch")
    if evidence["repository"] != expected.repository:
        raise PolicyError("repository mismatch")
    if evidence["source_digest"] != expected.source_digest:
        raise PolicyError("source digest mismatch")
    if evidence["source_ref"] != expected.source_ref:
        raise PolicyError("source ref mismatch")
    if int(evidence["run_id"]) != expected.run_id or int(evidence["run_attempt"]) != expected.run_attempt:
        raise PolicyError("execution replay/context mismatch")
    if evidence["signer_workflow"] != expected.signer_workflow:
        raise PolicyError("signer workflow mismatch")
    if int(evidence["trust_generation"]) != expected.trust_generation:
        raise PolicyError("trust generation mismatch")
    if evidence["oidc_issuer"] != "https://token.actions.githubusercontent.com":
        raise PolicyError("unexpected OIDC issuer")
    if evidence["sigstore_instance"] != "public-good":
        raise PolicyError("unexpected Sigstore instance")

    expected_identity = signer_identity(expected.signer_workflow, expected.source_ref)
    if evidence["signer_identity"] != expected_identity:
        raise PolicyError("signer identity mismatch")
    if expected_identity in expected.revoked_identities:
        raise PolicyError("signer identity revoked")

    expected_execution = f"github-actions:{expected.run_id}:{expected.run_attempt}"
    if evidence["external_execution_id"] != expected_execution:
        raise PolicyError("external execution id mismatch")

    expected_nonce = replay_nonce(
        expected.repository,
        expected.source_digest,
        expected.run_id,
        expected.run_attempt,
        evidence["workflow_ref"],
    )
    if evidence["replay_nonce"] != expected_nonce:
        raise PolicyError("replay nonce mismatch")

    issued = parse_time(evidence["issued_at"])
    expires = parse_time(evidence["expires_at"])
    if expires <= issued:
        raise PolicyError("invalid evidence lifetime")
    if (expires - issued).total_seconds() > MAX_LIFETIME_SECONDS:
        raise PolicyError("evidence lifetime exceeds policy")
    if expected.now < issued - timedelta(seconds=60):
        raise PolicyError("evidence issued in the future")
    if expected.now >= expires:
        raise PolicyError("evidence expired")

    contract = evidence["verification_contract"]
    if not isinstance(contract, dict):
        raise PolicyError("verification contract must be an object")
    if contract.get("content_hash_only") is not False:
        raise PolicyError("CONTENT_HASH_ONLY must never satisfy cryptographic verification")
    if contract.get("fetched_equals_verified") is not False:
        raise PolicyError("FETCHED must remain distinct from VERIFIED")
    if contract.get("cryptographic_verifier") != "gh-attestation+sigstore":
        raise PolicyError("dedicated cryptographic verifier is required")
    if contract.get("transparency_log_required") is not True:
        raise PolicyError("transparency log evidence is required")


def make_expected(evidence: dict, *, now: datetime | None = None, run_id: int | None = None,
                  trust_generation: int | None = None, revoked: frozenset[str] | None = None) -> ExpectedContext:
    return ExpectedContext(
        repository=evidence["repository"],
        source_digest=evidence["source_digest"],
        source_ref=evidence["source_ref"],
        run_id=int(evidence["run_id"]) if run_id is None else run_id,
        run_attempt=int(evidence["run_attempt"]),
        signer_workflow=evidence["signer_workflow"],
        trust_generation=int(evidence["trust_generation"]) if trust_generation is None else trust_generation,
        now=datetime.now(timezone.utc) if now is None else now,
        revoked_identities=frozenset() if revoked is None else revoked,
    )


def generate(path: Path) -> dict:
    repository = os.environ["GITHUB_REPOSITORY"]
    source_digest = os.environ["GITHUB_SHA"]
    source_ref = os.environ["GITHUB_REF"]
    run_id = int(os.environ["GITHUB_RUN_ID"])
    run_attempt = int(os.environ["GITHUB_RUN_ATTEMPT"])
    workflow_ref = os.environ["GITHUB_WORKFLOW_REF"]
    signer_workflow = workflow_ref.split("@", 1)[0]

    issued = datetime.now(timezone.utc).replace(microsecond=0)
    expires = issued + timedelta(minutes=12)

    evidence = {
        "schema": SCHEMA,
        "provider_id": PROVIDER_ID,
        "provider_kind": PROVIDER_KIND,
        "repository": repository,
        "source_digest": source_digest,
        "source_ref": source_ref,
        "run_id": run_id,
        "run_attempt": run_attempt,
        "external_execution_id": f"github-actions:{run_id}:{run_attempt}",
        "workflow_ref": workflow_ref,
        "signer_workflow": signer_workflow,
        "signer_identity": signer_identity(signer_workflow, source_ref),
        "oidc_issuer": "https://token.actions.githubusercontent.com",
        "sigstore_instance": "public-good",
        "trust_generation": TRUST_GENERATION,
        "issued_at": issued.isoformat().replace("+00:00", "Z"),
        "expires_at": expires.isoformat().replace("+00:00", "Z"),
        "replay_nonce": replay_nonce(repository, source_digest, run_id, run_attempt, workflow_ref),
        "verification_contract": {
            "fetched_equals_verified": False,
            "content_hash_only": False,
            "cryptographic_verifier": "gh-attestation+sigstore",
            "transparency_log_required": True,
            "revocation_mode": "local-identity-denylist+attestation-lifecycle",
            "rotation_mode": "trust-generation+sigstore-tuf-root",
        },
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = canonical_json(evidence) + b"\n"
    path.write_bytes(payload)
    digest = sha256_hex(payload)
    return {"evidence": evidence, "payload": payload, "sha256": digest}


def write_github_outputs(result: dict) -> None:
    output_file = os.environ.get("GITHUB_OUTPUT")
    if not output_file:
        return
    evidence = result["evidence"]
    encoded = base64.b64encode(result["payload"]).decode("ascii")
    values = {
        "evidence_b64": encoded,
        "evidence_sha256": result["sha256"],
        "expires_at": evidence["expires_at"],
        "external_execution_id": evidence["external_execution_id"],
        "signer_workflow": evidence["signer_workflow"],
        "signer_identity": evidence["signer_identity"],
    }
    with open(output_file, "a", encoding="utf-8") as handle:
        for key, value in values.items():
            handle.write(f"{key}={value}\n")


def self_test(path: Path) -> dict:
    evidence = json.loads(path.read_text(encoding="utf-8"))
    baseline = make_expected(evidence, now=parse_time(evidence["issued_at"]) + timedelta(seconds=1))
    validate_evidence(evidence, baseline)

    negatives: dict[str, str] = {}

    def expect_reject(name: str, context: ExpectedContext) -> None:
        try:
            validate_evidence(evidence, context)
        except PolicyError as exc:
            negatives[name] = f"REJECTED:{exc}"
            return
        raise AssertionError(f"negative test unexpectedly accepted: {name}")

    expect_reject("replay", make_expected(evidence, run_id=int(evidence["run_id"]) + 1,
                                           now=baseline.now))
    expect_reject("expiry", make_expected(evidence, now=parse_time(evidence["expires_at"]) + timedelta(seconds=1)))
    expect_reject("revocation", make_expected(evidence, now=baseline.now,
                                               revoked=frozenset({evidence["signer_identity"]})))
    expect_reject("rotation_generation", make_expected(evidence, now=baseline.now,
                                                        trust_generation=int(evidence["trust_generation"]) + 1))

    tampered = json.loads(json.dumps(evidence))
    tampered["verification_contract"]["content_hash_only"] = True
    try:
        validate_evidence(tampered, baseline)
    except PolicyError as exc:
        negatives["content_hash_only"] = f"REJECTED:{exc}"
    else:
        raise AssertionError("CONTENT_HASH_ONLY negative test unexpectedly accepted")

    return {"baseline": "PASS", "negative_tests": negatives}


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    gen = sub.add_parser("generate")
    gen.add_argument("--output", required=True, type=Path)

    verify = sub.add_parser("verify-policy")
    verify.add_argument("--input", required=True, type=Path)
    verify.add_argument("--repository", required=True)
    verify.add_argument("--source-digest", required=True)
    verify.add_argument("--source-ref", required=True)
    verify.add_argument("--run-id", required=True, type=int)
    verify.add_argument("--run-attempt", required=True, type=int)
    verify.add_argument("--signer-workflow", required=True)
    verify.add_argument("--trust-generation", type=int, default=TRUST_GENERATION)
    verify.add_argument("--now")
    verify.add_argument("--revoked-identity", action="append", default=[])

    test = sub.add_parser("self-test")
    test.add_argument("--input", required=True, type=Path)

    args = parser.parse_args()

    try:
        if args.command == "generate":
            result = generate(args.output)
            write_github_outputs(result)
            print(json.dumps({"status": "GENERATED", "sha256": result["sha256"],
                              "external_execution_id": result["evidence"]["external_execution_id"],
                              "expires_at": result["evidence"]["expires_at"]}, sort_keys=True))
            return 0

        if args.command == "verify-policy":
            evidence = json.loads(args.input.read_text(encoding="utf-8"))
            now = datetime.now(timezone.utc) if args.now is None else parse_time(args.now)
            expected = ExpectedContext(
                repository=args.repository,
                source_digest=args.source_digest,
                source_ref=args.source_ref,
                run_id=args.run_id,
                run_attempt=args.run_attempt,
                signer_workflow=args.signer_workflow,
                trust_generation=args.trust_generation,
                now=now,
                revoked_identities=frozenset(args.revoked_identity),
            )
            validate_evidence(evidence, expected)
            print(json.dumps({"status": "POLICY_VERIFIED", "provider_id": evidence["provider_id"],
                              "external_execution_id": evidence["external_execution_id"]}, sort_keys=True))
            return 0

        result = self_test(args.input)
        print(json.dumps(result, sort_keys=True))
        return 0
    except (PolicyError, AssertionError, KeyError, ValueError) as exc:
        print(f"verification failed: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
