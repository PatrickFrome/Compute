#!/usr/bin/env python3
"""Verify and bind AWS-signed EC2 Instance Identity Documents for H205F22 W1.

This module is deliberately non-authoritative. It accepts a raw IID document,
its RSA-2048 PKCS#7 signature, and the AWS region certificate. Verification is
fail-closed against a repository-pinned certificate fingerprint and exact
provider/account/region bindings. A successful result may upgrade only the
provider-identity field of an un-ingested reboot receipt candidate.

It never proves reboot completion, worker persistence, W1 verification,
canonical status, or runtime admission.
"""
from __future__ import annotations

import argparse
import base64
import copy
import hashlib
import json
import re
import ssl
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

INSTANCE_ID = re.compile(r"^i-[0-9a-f]+$")
ACCOUNT_ID = re.compile(r"^[0-9]{12}$")
REGION = re.compile(r"^[a-z]{2}(-gov)?-[a-z]+-[0-9]+$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")

VERIFICATION_SCHEMA = "metaengine.compute.w1-aws-signed-instance-identity.h205f22.v1"
INPUT_RECEIPT_SCHEMA = "metaengine.compute.w1-provider-reboot-receipt-candidate.h205f22.v1"
OUTPUT_RECEIPT_SCHEMA = "metaengine.compute.w1-provider-reboot-receipt-candidate.h205f22.v2"

# SHA-256 of DER-encoded AWS RSA-2048 certificate for EC2 IID signatures.
# Source: AWS EC2 "AWS public certificates for instance identity document
# signatures", region US East (Ohio) / us-east-2, rechecked 2026-08-23.
AWS_RSA2048_CERT_DER_SHA256_BY_REGION = {
    "us-east-2": "aa6f3e8afcd5e477501fbaf9d19f0945c7d94548f5a2de6375d8bfbab744cae0",
}


class IdentityVerificationError(RuntimeError):
    pass


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _canonical_sha256(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _read_bytes(path: str | Path) -> bytes:
    try:
        return Path(path).read_bytes()
    except OSError as exc:
        raise IdentityVerificationError(f"read_failed:{path}") from exc


def _read_json(path: str | Path) -> Any:
    try:
        return json.loads(Path(path).read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise IdentityVerificationError(f"invalid_json:{path}") from exc


def _write_json(path: str | Path, value: Any) -> None:
    Path(path).write_text(json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n")


def certificate_der_sha256(certificate_pem: bytes) -> str:
    try:
        der = ssl.PEM_cert_to_DER_cert(certificate_pem.decode("ascii"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise IdentityVerificationError("certificate_pem_invalid") from exc
    return _sha256_bytes(der)


def _normalize_pkcs7(signature_raw: bytes) -> tuple[bytes, bytes]:
    try:
        text = signature_raw.decode("ascii").strip()
    except UnicodeDecodeError as exc:
        raise IdentityVerificationError("rsa2048_signature_not_ascii") from exc

    if text.startswith("-----BEGIN PKCS7-----"):
        if not text.endswith("-----END PKCS7-----"):
            raise IdentityVerificationError("rsa2048_pem_footer_missing")
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        if lines[0] != "-----BEGIN PKCS7-----" or lines[-1] != "-----END PKCS7-----":
            raise IdentityVerificationError("rsa2048_pem_invalid")
        body = "".join(lines[1:-1])
    else:
        body = "".join(text.split())

    if not body or not re.fullmatch(r"[A-Za-z0-9+/=]+", body):
        raise IdentityVerificationError("rsa2048_base64_invalid")
    try:
        der = base64.b64decode(body, validate=True)
    except Exception as exc:
        raise IdentityVerificationError("rsa2048_base64_invalid") from exc
    if len(der) < 256:
        raise IdentityVerificationError("rsa2048_signature_too_small")

    wrapped = "\n".join(body[i : i + 64] for i in range(0, len(body), 64))
    pem = f"-----BEGIN PKCS7-----\n{wrapped}\n-----END PKCS7-----\n".encode("ascii")
    return pem, der


def _validate_expected(instance_id: str, account_id: str, region: str) -> None:
    if not INSTANCE_ID.fullmatch(instance_id):
        raise IdentityVerificationError("expected_instance_id_invalid")
    if not ACCOUNT_ID.fullmatch(account_id):
        raise IdentityVerificationError("expected_account_id_invalid")
    if not REGION.fullmatch(region):
        raise IdentityVerificationError("expected_region_invalid")
    if region not in AWS_RSA2048_CERT_DER_SHA256_BY_REGION:
        raise IdentityVerificationError("region_certificate_pin_unavailable")


def verify_instance_identity(
    *,
    document_raw: bytes,
    rsa2048_signature_raw: bytes,
    certificate_pem: bytes,
    expected_instance_id: str,
    expected_account_id: str,
    expected_region: str,
) -> dict[str, Any]:
    _validate_expected(expected_instance_id, expected_account_id, expected_region)

    cert_sha = certificate_der_sha256(certificate_pem)
    expected_cert_sha = AWS_RSA2048_CERT_DER_SHA256_BY_REGION[expected_region]
    if cert_sha != expected_cert_sha:
        raise IdentityVerificationError("aws_certificate_pin_mismatch")

    signature_pem, signature_der = _normalize_pkcs7(rsa2048_signature_raw)

    with tempfile.TemporaryDirectory(prefix="metaengine-w1-iid-") as tmp:
        root = Path(tmp)
        document_path = root / "document.json"
        signature_path = root / "rsa2048.pem"
        certificate_path = root / "aws-rsa2048.pem"
        recovered_path = root / "recovered-document.json"
        document_path.write_bytes(document_raw)
        signature_path.write_bytes(signature_pem)
        certificate_path.write_bytes(certificate_pem)

        # -nointern is critical: the signer certificate embedded in a PKCS#7
        # object must not be trusted. Only the independently pinned AWS
        # certificate supplied through -certfile may resolve the signer.
        proc = subprocess.run(
            [
                "openssl",
                "smime",
                "-verify",
                "-binary",
                "-in",
                str(signature_path),
                "-inform",
                "PEM",
                "-certfile",
                str(certificate_path),
                "-nointern",
                "-noverify",
                "-out",
                str(recovered_path),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            raise IdentityVerificationError("rsa2048_signature_verification_failed")
        recovered = recovered_path.read_bytes()

    if recovered != document_raw:
        raise IdentityVerificationError("signed_document_bytes_mismatch")

    try:
        document = json.loads(document_raw)
    except json.JSONDecodeError as exc:
        raise IdentityVerificationError("instance_identity_document_invalid_json") from exc
    if not isinstance(document, dict):
        raise IdentityVerificationError("instance_identity_document_not_object")

    if document.get("instanceId") != expected_instance_id:
        raise IdentityVerificationError("instance_identity_mismatch")
    if document.get("accountId") != expected_account_id:
        raise IdentityVerificationError("account_identity_mismatch")
    if document.get("region") != expected_region:
        raise IdentityVerificationError("region_identity_mismatch")

    availability_zone = document.get("availabilityZone")
    if availability_zone is not None:
        if not isinstance(availability_zone, str) or not availability_zone.startswith(expected_region):
            raise IdentityVerificationError("availability_zone_region_mismatch")

    architecture = document.get("architecture")
    if architecture is not None and architecture not in {"x86_64", "arm64", "i386"}:
        raise IdentityVerificationError("architecture_invalid")

    evidence = {
        "provider_kind": "AWS_EC2",
        "provider_instance_id": expected_instance_id,
        "provider_account_id": expected_account_id,
        "region": expected_region,
        "availability_zone": availability_zone,
        "architecture": architecture,
        "image_id": document.get("imageId"),
        "private_ip": document.get("privateIp"),
        "pending_time": document.get("pendingTime"),
        "signature_format": "AWS_EC2_IID_RSA2048_PKCS7_SHA256",
        "certificate_der_sha256": cert_sha,
        "document_sha256": _sha256_bytes(document_raw),
        "signature_der_sha256": _sha256_bytes(signature_der),
    }
    return {
        "schema": VERIFICATION_SCHEMA,
        "classification": "SIGNED_PROVIDER_IDENTITY_VERIFIED_NONAUTHORITY",
        "identity_attestation_kind": "SIGNED_PROVIDER_IDENTITY",
        "identity_attestation_verified": True,
        "evidence": evidence,
        "verification_receipt_sha256": _canonical_sha256(evidence),
        "persistent_worker_proof": False,
        "reboot_completion_proven": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }


def bind_verified_identity(
    *,
    reboot_receipt: dict[str, Any],
    verified_identity: dict[str, Any],
) -> dict[str, Any]:
    if not isinstance(reboot_receipt, dict) or reboot_receipt.get("schema") != INPUT_RECEIPT_SCHEMA:
        raise IdentityVerificationError("reboot_receipt_schema_invalid")
    if not isinstance(verified_identity, dict) or verified_identity.get("schema") != VERIFICATION_SCHEMA:
        raise IdentityVerificationError("verified_identity_schema_invalid")

    for key in ("canonical", "authority_effect", "persistent_worker_proof", "w1_verified"):
        if reboot_receipt.get(key) is not False:
            raise IdentityVerificationError(f"reboot_receipt_authority_boundary_invalid:{key}")
        if verified_identity.get(key) is not False:
            raise IdentityVerificationError(f"verified_identity_authority_boundary_invalid:{key}")

    if reboot_receipt.get("provider_kind") != "AWS_EC2":
        raise IdentityVerificationError("reboot_receipt_provider_kind_invalid")
    if reboot_receipt.get("identity_attestation_verified") is not False:
        raise IdentityVerificationError("reboot_receipt_identity_already_verified")
    if reboot_receipt.get("completed_at_semantics") != "PROVIDER_REQUEST_ACCEPTED_AT_NOT_REBOOT_COMPLETION":
        raise IdentityVerificationError("reboot_receipt_completion_semantics_invalid")

    if verified_identity.get("identity_attestation_kind") != "SIGNED_PROVIDER_IDENTITY":
        raise IdentityVerificationError("verified_identity_kind_invalid")
    if verified_identity.get("identity_attestation_verified") is not True:
        raise IdentityVerificationError("verified_identity_not_verified")

    identity_evidence = verified_identity.get("evidence")
    receipt_evidence = reboot_receipt.get("evidence")
    if not isinstance(identity_evidence, dict) or not isinstance(receipt_evidence, dict):
        raise IdentityVerificationError("identity_or_receipt_evidence_invalid")

    instance_id = reboot_receipt.get("provider_instance_id")
    if identity_evidence.get("provider_instance_id") != instance_id:
        raise IdentityVerificationError("provider_instance_binding_mismatch")
    if identity_evidence.get("provider_kind") != reboot_receipt.get("provider_kind"):
        raise IdentityVerificationError("provider_kind_binding_mismatch")

    preflight = receipt_evidence.get("preflight")
    cloudtrail = receipt_evidence.get("cloudtrail")
    caller = receipt_evidence.get("caller_identity")
    if not isinstance(preflight, dict) or not isinstance(cloudtrail, dict) or not isinstance(caller, dict):
        raise IdentityVerificationError("receipt_provider_evidence_shape_invalid")

    if preflight.get("instance_id") != instance_id:
        raise IdentityVerificationError("preflight_instance_binding_mismatch")

    cloudtrail_event = cloudtrail.get("cloudtrail_event")
    if not isinstance(cloudtrail_event, dict):
        raise IdentityVerificationError("cloudtrail_event_missing")
    if cloudtrail_event.get("awsRegion") != identity_evidence.get("region"):
        raise IdentityVerificationError("cloudtrail_region_binding_mismatch")
    if caller.get("Account") != identity_evidence.get("provider_account_id"):
        raise IdentityVerificationError("caller_account_binding_mismatch")

    availability_zone = preflight.get("availability_zone")
    if not isinstance(availability_zone, str) or not availability_zone.startswith(identity_evidence["region"]):
        raise IdentityVerificationError("preflight_region_binding_mismatch")

    out = copy.deepcopy(reboot_receipt)
    out["schema"] = OUTPUT_RECEIPT_SCHEMA
    out["classification"] = "LIVE_PROVIDER_CONTROLLER_RECEIPT_WITH_VERIFIED_IDENTITY_UNINGESTED"
    out["identity_attestation_kind"] = "SIGNED_PROVIDER_IDENTITY"
    out["identity_attestation_verified"] = True
    out_evidence = out["evidence"]
    out_evidence["signed_provider_identity"] = verified_identity
    out["evidence_artifact_sha256"] = _canonical_sha256(out_evidence)

    # Explicit nonclaims survive identity verification.
    out["canonical"] = False
    out["authority_effect"] = False
    out["persistent_worker_proof"] = False
    out["w1_verified"] = False
    return out


def _cmd_verify(args: argparse.Namespace) -> int:
    result = verify_instance_identity(
        document_raw=_read_bytes(args.document),
        rsa2048_signature_raw=_read_bytes(args.rsa2048),
        certificate_pem=_read_bytes(args.certificate),
        expected_instance_id=args.instance_id,
        expected_account_id=args.account_id,
        expected_region=args.region,
    )
    _write_json(args.output, result)
    return 0


def _cmd_bind(args: argparse.Namespace) -> int:
    result = bind_verified_identity(
        reboot_receipt=_read_json(args.reboot_receipt),
        verified_identity=_read_json(args.verified_identity),
    )
    _write_json(args.output, result)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("verify-iid")
    p.add_argument("--document", required=True)
    p.add_argument("--rsa2048", required=True)
    p.add_argument("--certificate", required=True)
    p.add_argument("--instance-id", required=True)
    p.add_argument("--account-id", required=True)
    p.add_argument("--region", required=True)
    p.add_argument("--output", required=True)
    p.set_defaults(func=_cmd_verify)

    p = sub.add_parser("bind-receipt")
    p.add_argument("--reboot-receipt", required=True)
    p.add_argument("--verified-identity", required=True)
    p.add_argument("--output", required=True)
    p.set_defaults(func=_cmd_bind)

    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except IdentityVerificationError as exc:
        print(f"W1_AWS_IDENTITY_REJECTED:{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
