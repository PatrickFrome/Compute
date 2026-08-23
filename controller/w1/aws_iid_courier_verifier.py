#!/usr/bin/env python3
"""Treat an AWS IID courier envelope only as byte transport, then verify off-host."""
from __future__ import annotations

import argparse
import base64
import copy
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

from controller.w1 import aws_instance_identity_verifier as iid
from worker.native_linux import aws_iid_courier as courier

EXPECTED_KEYS = {
    "schema",
    "source",
    "transport",
    "document_base64",
    "document_sha256",
    "rsa2048_base64",
    "rsa2048_transport_sha256",
    "provider_identity_verified",
    "reboot_completion_proven",
    "persistent_worker_proof",
    "w1_verified",
    "canonical",
    "authority_effect",
}


class CourierVerificationError(RuntimeError):
    pass


def _canonical_sha256(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _decode64(value: Any, label: str, limit: int) -> bytes:
    if not isinstance(value, str) or not value:
        raise CourierVerificationError(f"{label}_missing")
    try:
        raw = base64.b64decode(value, validate=True)
    except Exception as exc:
        raise CourierVerificationError(f"{label}_base64_invalid") from exc
    if not raw or len(raw) > limit:
        raise CourierVerificationError(f"{label}_size_invalid")
    return raw


def decode_untrusted_envelope(envelope: Any) -> tuple[bytes, bytes]:
    if not isinstance(envelope, dict) or set(envelope) != EXPECTED_KEYS:
        raise CourierVerificationError("courier_envelope_shape_invalid")
    if envelope["schema"] != courier.SCHEMA:
        raise CourierVerificationError("courier_schema_invalid")
    if envelope["source"] != "HOST_UNTRUSTED_TRANSPORT":
        raise CourierVerificationError("courier_source_must_remain_untrusted")
    if envelope["transport"] != "AWS_IMDSV2_LINK_LOCAL_IPV4":
        raise CourierVerificationError("courier_transport_invalid")

    for key in (
        "provider_identity_verified",
        "reboot_completion_proven",
        "persistent_worker_proof",
        "w1_verified",
        "canonical",
        "authority_effect",
    ):
        if envelope[key] is not False:
            raise CourierVerificationError(f"courier_nonclaim_violation:{key}")

    document = _decode64(envelope["document_base64"], "document", courier.MAX_DOCUMENT_BYTES)
    rsa2048 = _decode64(envelope["rsa2048_base64"], "rsa2048", courier.MAX_RSA2048_BYTES)
    if hashlib.sha256(document).hexdigest() != envelope["document_sha256"]:
        raise CourierVerificationError("document_transport_digest_mismatch")
    if hashlib.sha256(rsa2048).hexdigest() != envelope["rsa2048_transport_sha256"]:
        raise CourierVerificationError("rsa2048_transport_digest_mismatch")
    return document, rsa2048


def verify_envelope(
    *,
    envelope: dict[str, Any],
    certificate_pem: bytes,
    expected_instance_id: str,
    expected_account_id: str,
    expected_region: str,
) -> dict[str, Any]:
    document, rsa2048 = decode_untrusted_envelope(envelope)
    verified = iid.verify_instance_identity(
        document_raw=document,
        rsa2048_signature_raw=rsa2048,
        certificate_pem=certificate_pem,
        expected_instance_id=expected_instance_id,
        expected_account_id=expected_account_id,
        expected_region=expected_region,
    )
    out = copy.deepcopy(verified)
    evidence = out.get("evidence")
    if not isinstance(evidence, dict):
        raise CourierVerificationError("core_verifier_evidence_missing")
    evidence["courier_transport"] = {
        "schema": courier.SCHEMA,
        "source": "HOST_UNTRUSTED_TRANSPORT",
        "transport": "AWS_IMDSV2_LINK_LOCAL_IPV4",
        "envelope_sha256": _canonical_sha256(envelope),
        "document_transport_sha256": envelope["document_sha256"],
        "rsa2048_transport_sha256": envelope["rsa2048_transport_sha256"],
    }
    out["verification_receipt_sha256"] = iid._canonical_sha256(evidence)
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--envelope", required=True)
    parser.add_argument("--certificate", required=True)
    parser.add_argument("--instance-id", required=True)
    parser.add_argument("--account-id", required=True)
    parser.add_argument("--region", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    try:
        envelope = json.loads(Path(args.envelope).read_text())
        result = verify_envelope(
            envelope=envelope,
            certificate_pem=Path(args.certificate).read_bytes(),
            expected_instance_id=args.instance_id,
            expected_account_id=args.account_id,
            expected_region=args.region,
        )
    except (OSError, json.JSONDecodeError, CourierVerificationError, iid.IdentityVerificationError) as exc:
        print(f"W1_AWS_IID_OFFHOST_REJECTED:{exc}", file=sys.stderr)
        return 1
    Path(args.output).write_text(json.dumps(result, sort_keys=True, separators=(",", ":")) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
