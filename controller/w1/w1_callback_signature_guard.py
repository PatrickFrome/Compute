#!/usr/bin/env python3
"""Verify enrollment-bound P-256 W1 execution callback signatures.

Pure validation only. No network, AWS mutation, database mutation, reboot,
admission, roadmap mutation, checkpoint seal, or W1 verification occurs here.
"""
from __future__ import annotations

import argparse
import base64
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from typing import Any
import uuid

from controller.w1 import w1_execution_marker_guard as marker_guard

ENROLLMENT_SCHEMA = "metaengine.compute.w1-callback-key-enrollment.h205f22.v1"
ENROLLMENT_PREFIX = "METAENGINE_W1_CALLBACK_KEY_ENROLLMENT_JSON="
CALLBACK_ENVELOPE_SCHEMA = "metaengine.compute.w1-execution-callback-envelope.h205f22.v1"
ATTESTATION_SCHEMA = marker_guard.CALLBACK_SCHEMA
KEY_DOCUMENT_NAME = "Metaengine-W1-Callback-Key-Enroll-H205F22"
KEY_DOCUMENT_VERSION = "1"
KEY_PLUGIN_NAME = "enrollCallbackSigningKey"
ALGORITHM = "ES256-P1363-SHA256"
DOMAIN = b"METAENGINE:H205F22:W1:EXECUTION-CALLBACK:v1\n"
MAX_ENROLLMENT_STDOUT_BYTES = 4096
MAX_ENVELOPE_BYTES = 8192

INSTANCE_ID = re.compile(r"^i-[0-9a-f]{8}([0-9a-f]{9})?$")
WORKER_ID = re.compile(r"^[A-Za-z0-9._:-]{3,160}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
B64U = re.compile(r"^[A-Za-z0-9_-]+$")
UUID36 = re.compile(r"^[0-9a-fA-F-]{36}$")
P256_SPKI_PREFIX = bytes.fromhex(
    "3059301306072a8648ce3d020106082a8648ce3d03010703420004"
)


class CallbackSignatureError(RuntimeError):
    pass


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sha_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha(value: Any) -> str:
    return _sha_bytes(_canonical_bytes(value))


def _parse_time(value: Any, label: str) -> datetime:
    if not isinstance(value, str) or not value:
        raise CallbackSignatureError(f"{label}_missing")
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise CallbackSignatureError(f"{label}_invalid") from exc
    if dt.tzinfo is None:
        raise CallbackSignatureError(f"{label}_timezone_required")
    return dt.astimezone(timezone.utc)


def _require_uuid(value: Any, label: str) -> str:
    if not isinstance(value, str) or UUID36.fullmatch(value) is None:
        raise CallbackSignatureError(f"{label}_invalid")
    try:
        return str(uuid.UUID(value))
    except ValueError as exc:
        raise CallbackSignatureError(f"{label}_invalid") from exc


def _b64u_decode(value: Any, *, size: int, label: str) -> bytes:
    if not isinstance(value, str) or not value or "=" in value or B64U.fullmatch(value) is None:
        raise CallbackSignatureError(f"{label}_invalid")
    try:
        raw = base64.urlsafe_b64decode(value + "=" * ((4 - len(value) % 4) % 4))
    except Exception as exc:
        raise CallbackSignatureError(f"{label}_invalid") from exc
    if len(raw) != size:
        raise CallbackSignatureError(f"{label}_size_invalid")
    return raw


def jwk_key_id(jwk: Any) -> str:
    if not isinstance(jwk, dict) or set(jwk) != {"kty", "crv", "x", "y"}:
        raise CallbackSignatureError("public_jwk_shape_invalid")
    if jwk.get("kty") != "EC" or jwk.get("crv") != "P-256":
        raise CallbackSignatureError("public_jwk_curve_invalid")
    _b64u_decode(jwk.get("x"), size=32, label="public_jwk_x")
    _b64u_decode(jwk.get("y"), size=32, label="public_jwk_y")
    return _sha(jwk)


def _public_key_pem(jwk: dict[str, Any]) -> bytes:
    x = _b64u_decode(jwk["x"], size=32, label="public_jwk_x")
    y = _b64u_decode(jwk["y"], size=32, label="public_jwk_y")
    der = P256_SPKI_PREFIX + x + y
    body = base64.b64encode(der).decode("ascii")
    wrapped = "\n".join(body[i:i + 64] for i in range(0, len(body), 64))
    return f"-----BEGIN PUBLIC KEY-----\n{wrapped}\n-----END PUBLIC KEY-----\n".encode("ascii")


def _der_int(raw: bytes) -> bytes:
    raw = raw.lstrip(b"\x00") or b"\x00"
    if raw[0] & 0x80:
        raw = b"\x00" + raw
    return b"\x02" + bytes([len(raw)]) + raw


def p1363_to_der(signature: bytes) -> bytes:
    if len(signature) != 64:
        raise CallbackSignatureError("signature_size_invalid")
    body = _der_int(signature[:32]) + _der_int(signature[32:])
    if len(body) >= 128:
        raise CallbackSignatureError("signature_der_length_invalid")
    return b"\x30" + bytes([len(body)]) + body


def _cloudwatch_disabled(value: Any) -> bool:
    if value in (None, {}, ""):
        return True
    return (
        isinstance(value, dict)
        and value.get("CloudWatchOutputEnabled") in (None, False)
        and value.get("CloudWatchLogGroupName") in (None, "")
        and set(value).issubset({"CloudWatchOutputEnabled", "CloudWatchLogGroupName"})
    )


def validate_key_enrollment_invocation(value: Any, *, expected_instance_id: str) -> dict[str, Any]:
    if not isinstance(expected_instance_id, str) or INSTANCE_ID.fullmatch(expected_instance_id) is None:
        raise CallbackSignatureError("expected_instance_id_invalid")
    if not isinstance(value, dict):
        raise CallbackSignatureError("key_enrollment_invocation_invalid")
    if value.get("InstanceId") != expected_instance_id:
        raise CallbackSignatureError("key_enrollment_instance_mismatch")
    if value.get("DocumentName") != KEY_DOCUMENT_NAME:
        raise CallbackSignatureError("key_enrollment_document_name_mismatch")
    if str(value.get("DocumentVersion")) != KEY_DOCUMENT_VERSION:
        raise CallbackSignatureError("key_enrollment_document_version_mismatch")
    if value.get("PluginName") != KEY_PLUGIN_NAME:
        raise CallbackSignatureError("key_enrollment_plugin_mismatch")
    if value.get("Status") != "Success" or value.get("StatusDetails") not in (None, "Success"):
        raise CallbackSignatureError("key_enrollment_status_not_success")
    if value.get("ResponseCode") != 0:
        raise CallbackSignatureError("key_enrollment_response_code_nonzero")
    if value.get("StandardErrorContent") not in (None, ""):
        raise CallbackSignatureError("key_enrollment_stderr_nonempty")
    if value.get("StandardOutputUrl") not in (None, "") or value.get("StandardErrorUrl") not in (None, ""):
        raise CallbackSignatureError("key_enrollment_output_url_forbidden")
    if not _cloudwatch_disabled(value.get("CloudWatchOutputConfig")):
        raise CallbackSignatureError("key_enrollment_cloudwatch_forbidden")
    stdout = value.get("StandardOutputContent")
    if not isinstance(stdout, str) or not stdout:
        raise CallbackSignatureError("key_enrollment_stdout_missing")
    if len(stdout.encode("utf-8")) > MAX_ENROLLMENT_STDOUT_BYTES:
        raise CallbackSignatureError("key_enrollment_stdout_too_large")
    normalized = stdout[:-1] if stdout.endswith("\n") else stdout
    if "\n" in normalized or "\r" in normalized or not normalized.startswith(ENROLLMENT_PREFIX):
        raise CallbackSignatureError("key_enrollment_stdout_contract_invalid")
    try:
        record = json.loads(normalized[len(ENROLLMENT_PREFIX):])
    except json.JSONDecodeError as exc:
        raise CallbackSignatureError("key_enrollment_json_invalid") from exc
    if not isinstance(record, dict) or record.get("schema") != ENROLLMENT_SCHEMA:
        raise CallbackSignatureError("key_enrollment_schema_invalid")
    if record.get("provider_kind") != "AWS_EC2" or record.get("provider_instance_id") != expected_instance_id:
        raise CallbackSignatureError("key_enrollment_provider_binding_invalid")
    if record.get("algorithm") != ALGORITHM:
        raise CallbackSignatureError("key_enrollment_algorithm_invalid")
    jwk = record.get("public_jwk")
    key_id = jwk_key_id(jwk)
    if record.get("key_id") != key_id:
        raise CallbackSignatureError("key_enrollment_key_id_mismatch")
    observed_at = _parse_time(record.get("observed_at"), "key_enrollment_observed_at")
    if record.get("private_key_exported") is not False:
        raise CallbackSignatureError("key_enrollment_private_key_export_claim_invalid")
    for field in ("canonical", "authority_effect", "worker_admitted", "w1_verified",
                  "persistent_worker_proof", "reboot_completion_proven"):
        if record.get(field) is not False:
            raise CallbackSignatureError(f"key_enrollment_nonclaim_invalid:{field}")
    return {
        "key_id": key_id,
        "public_jwk": jwk,
        "observed_at": observed_at,
        "provider_instance_id": expected_instance_id,
        "record_sha256": _sha(record),
    }


def _verify_signature(*, jwk: dict[str, Any], signature_p1363: bytes, message: bytes) -> None:
    signature_der = p1363_to_der(signature_p1363)
    with tempfile.TemporaryDirectory(prefix="metaengine-w1-callback-") as tmp:
        base = Path(tmp)
        pub = base / "pub.pem"
        sig = base / "sig.der"
        msg = base / "message.bin"
        pub.write_bytes(_public_key_pem(jwk))
        sig.write_bytes(signature_der)
        msg.write_bytes(message)
        proc = subprocess.run(
            ["openssl", "dgst", "-sha256", "-verify", str(pub), "-signature", str(sig), str(msg)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
    if proc.returncode != 0:
        raise CallbackSignatureError("callback_signature_verification_failed")


def verify_callback_envelope(
    envelope: Any,
    *,
    key_enrollment_invocation: Any,
    expected_worker_id: str,
    expected_instance_id: str,
    expected_challenge_nonce: str,
    callback_receipt_id: str,
    received_at: str,
) -> dict[str, Any]:
    if not isinstance(expected_worker_id, str) or WORKER_ID.fullmatch(expected_worker_id) is None:
        raise CallbackSignatureError("expected_worker_id_invalid")
    if not isinstance(expected_challenge_nonce, str) or SHA256.fullmatch(expected_challenge_nonce) is None:
        raise CallbackSignatureError("expected_challenge_nonce_invalid")
    receipt_id = _require_uuid(callback_receipt_id, "callback_receipt_id")
    received = _parse_time(received_at, "callback_received_at")
    enrollment = validate_key_enrollment_invocation(
        key_enrollment_invocation, expected_instance_id=expected_instance_id
    )
    if not isinstance(envelope, dict) or envelope.get("schema") != CALLBACK_ENVELOPE_SCHEMA:
        raise CallbackSignatureError("callback_envelope_schema_invalid")
    if len(_canonical_bytes(envelope)) > MAX_ENVELOPE_BYTES:
        raise CallbackSignatureError("callback_envelope_too_large")
    if envelope.get("algorithm") != ALGORITHM or envelope.get("key_id") != enrollment["key_id"]:
        raise CallbackSignatureError("callback_envelope_key_binding_invalid")
    marker = envelope.get("marker")
    if not isinstance(marker, dict) or marker.get("schema") != marker_guard.MARKER_SCHEMA:
        raise CallbackSignatureError("callback_marker_schema_invalid")
    if marker.get("worker_id") != expected_worker_id:
        raise CallbackSignatureError("callback_marker_worker_mismatch")
    if marker.get("provider_kind") != "AWS_EC2" or marker.get("provider_instance_id") != expected_instance_id:
        raise CallbackSignatureError("callback_marker_instance_mismatch")
    if marker.get("callback_key_id") != enrollment["key_id"]:
        raise CallbackSignatureError("callback_marker_key_id_mismatch")
    if marker.get("callback_challenge_nonce") != expected_challenge_nonce:
        raise CallbackSignatureError("callback_challenge_mismatch")
    for field in ("host_safety_verified", "persistent_worker_proof", "worker_admitted",
                  "w1_verified", "canonical", "authority_effect"):
        if marker.get(field) is not False:
            raise CallbackSignatureError(f"callback_marker_nonclaim_invalid:{field}")
    observed = _parse_time(marker.get("observed_at"), "callback_marker_observed_at")
    if received < observed - timedelta(seconds=30) or received > observed + timedelta(minutes=5):
        raise CallbackSignatureError("callback_receipt_time_outside_window")
    message = DOMAIN + _canonical_bytes(marker)
    signed_payload_sha256 = _sha_bytes(message)
    if envelope.get("signed_payload_sha256") != signed_payload_sha256:
        raise CallbackSignatureError("callback_signed_payload_hash_mismatch")
    signature = _b64u_decode(envelope.get("signature_b64u"), size=64, label="callback_signature")
    _verify_signature(jwk=enrollment["public_jwk"], signature_p1363=signature, message=message)
    return {
        "schema": ATTESTATION_SCHEMA,
        "callback_receipt_id": receipt_id,
        "accepted": True,
        "auth_kind": "WORKER_ENROLLMENT_SIGNATURE_V1",
        "auth_verified": True,
        "marker_id": marker.get("marker_id"),
        "worker_id": expected_worker_id,
        "provider_kind": "AWS_EC2",
        "provider_instance_id": expected_instance_id,
        "execution_payload_sha256": marker.get("execution_payload_sha256"),
        "package_sha256": marker.get("package_sha256"),
        "payload_lock_sha256": marker.get("payload_lock_sha256"),
        "marker_body_sha256": _sha(marker),
        "received_at": received.isoformat(),
        "key_id": enrollment["key_id"],
        "key_enrollment_record_sha256": enrollment["record_sha256"],
        "challenge_nonce_sha256": _sha_bytes(expected_challenge_nonce.encode("ascii")),
        "signed_payload_sha256": signed_payload_sha256,
        "signature_sha256": _sha_bytes(signature),
        "database_persistence_verified": False,
        "persistent_worker_proof": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--enrollment-invocation", required=True)
    parser.add_argument("--envelope", required=True)
    parser.add_argument("--worker-id", required=True)
    parser.add_argument("--instance-id", required=True)
    parser.add_argument("--challenge-nonce", required=True)
    parser.add_argument("--callback-receipt-id", required=True)
    parser.add_argument("--received-at", required=True)
    args = parser.parse_args()
    try:
        result = verify_callback_envelope(
            json.loads(Path(args.envelope).read_text()),
            key_enrollment_invocation=json.loads(Path(args.enrollment_invocation).read_text()),
            expected_worker_id=args.worker_id,
            expected_instance_id=args.instance_id,
            expected_challenge_nonce=args.challenge_nonce,
            callback_receipt_id=args.callback_receipt_id,
            received_at=args.received_at,
        )
    except (CallbackSignatureError, OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, sort_keys=True, separators=(",", ":")))
        return 2
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
