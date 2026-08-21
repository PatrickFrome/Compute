#!/usr/bin/env python3
"""Create and verify a non-authoritative encrypted recovery envelope for H205F22 R1.

Cryptography is delegated exclusively to the official `age` CLI. Production policy
requires at least two unique native post-quantum hybrid recipients (`age1pq1...`).
The ciphertext is created once and MUST then be copied byte-for-byte to independent
storage domains; re-encrypting separately for each provider would create different
ciphertext and break the cross-provider identity contract.

This module has no provider, network, Supabase, or secret-management client.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Iterable

AGE_REQUIRED_VERSION = "1.3.1"
BUNDLE_SCHEMA = "metaengine.compute.r1-recovery-bundle-build-receipt.h205f22.v1"
BUNDLE_CLASSIFICATION = "PLAINTEXT_BUNDLE_BUILD_RECEIPT_NONAUTHORITATIVE"
ENVELOPE_SCHEMA = "metaengine.compute.r1-recovery-encryption-envelope.h205f22.v1"
ENVELOPE_CLASSIFICATION = "ENCRYPTED_RECOVERY_ARTIFACT_CANDIDATE_NONAUTHORITATIVE"
PROFILE_PRODUCTION_PQ = "PRODUCTION_PQ_TWO_RECIPIENT_MIN"
PROFILE_COMPAT_TEST = "COMPATIBILITY_TEST_ONLY"
PQ_RECIPIENT = re.compile(r"^age1pq1[0-9a-z]{32,}$")
CLASSIC_RECIPIENT = re.compile(r"^age1(?!pq1)[0-9a-z]{32,}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")


class EnvelopeError(RuntimeError):
    pass


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _hash_file(path: Path) -> tuple[str, int]:
    h = hashlib.sha256()
    total = 0
    try:
        with path.open("rb") as handle:
            while True:
                chunk = handle.read(1024 * 1024)
                if not chunk:
                    break
                h.update(chunk)
                total += len(chunk)
    except OSError as exc:
        raise EnvelopeError(f"file_unavailable:{path}") from exc
    return h.hexdigest(), total


def _read_json_object(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise EnvelopeError(f"{label}_invalid_json") from exc
    if not isinstance(value, dict):
        raise EnvelopeError(f"{label}_must_be_object")
    return value


def _verify_self_hash(value: dict[str, Any], field: str, label: str) -> None:
    claimed = value.get(field)
    if not isinstance(claimed, str) or not SHA256.fullmatch(claimed):
        raise EnvelopeError(f"{label}_{field}_invalid")
    core = dict(value)
    core.pop(field, None)
    actual = _sha256_bytes(_canonical_bytes(core))
    if actual != claimed:
        raise EnvelopeError(f"{label}_{field}_mismatch")


def validate_bundle_receipt(bundle: Path, receipt_path: Path) -> dict[str, Any]:
    receipt = _read_json_object(receipt_path, "bundle_receipt")
    if receipt.get("schema") != BUNDLE_SCHEMA:
        raise EnvelopeError("bundle_receipt_schema_invalid")
    if receipt.get("classification") != BUNDLE_CLASSIFICATION:
        raise EnvelopeError("bundle_receipt_classification_invalid")
    _verify_self_hash(receipt, "receipt_sha256", "bundle_receipt")
    if any(receipt.get(k) is not False for k in ("external_storage_ready", "canonical", "authority_effect", "r2_proven", "r3_proven", "persisted_seal_allowed")):
        raise EnvelopeError("bundle_receipt_authority_boundary_invalid")
    if receipt.get("required_next") != "AGE_OR_EQUIVALENT_REVIEWED_ENCRYPTION_ENVELOPE":
        raise EnvelopeError("bundle_receipt_required_next_invalid")
    bundle_sha, bundle_bytes = _hash_file(bundle)
    if bundle_sha != receipt.get("bundle_sha256"):
        raise EnvelopeError("bundle_sha256_mismatch")
    if bundle_bytes != receipt.get("bundle_bytes"):
        raise EnvelopeError("bundle_bytes_mismatch")
    return receipt


def _recipient_kind(recipient: str) -> str:
    if PQ_RECIPIENT.fullmatch(recipient):
        return "MLKEM768_X25519_HYBRID"
    if recipient.startswith("AGE-SECRET-KEY"):
        raise EnvelopeError("identity_material_forbidden_in_recipients")
    # Native classic X25519 is one Bech32 value with HRP `age`. Bech32 data
    # does not use the separator character `1`; another `1` after `age1`
    # therefore denotes a plugin/tagged recipient shape, not native X25519.
    if recipient.startswith("age1") and "1" in recipient[4:]:
        raise EnvelopeError("unsupported_age_recipient_type")
    if CLASSIC_RECIPIENT.fullmatch(recipient):
        return "X25519_CLASSIC"
    if recipient.startswith("age1"):
        raise EnvelopeError("unsupported_age_recipient_type")
    raise EnvelopeError("recipient_invalid")


def load_recipients(path: Path, profile: str) -> list[dict[str, str]]:
    try:
        lines = path.read_text().splitlines()
    except OSError as exc:
        raise EnvelopeError("recipients_file_unavailable") from exc
    recipients: list[str] = []
    for raw in lines:
        text = raw.strip()
        if not text or text.startswith("#"):
            continue
        recipients.append(text)
    if len(recipients) < 2:
        raise EnvelopeError("minimum_two_recipients_required")
    if len(set(recipients)) != len(recipients):
        raise EnvelopeError("duplicate_recipient")
    parsed = [{"recipient": r, "kind": _recipient_kind(r)} for r in recipients]
    if profile == PROFILE_PRODUCTION_PQ:
        if any(item["kind"] != "MLKEM768_X25519_HYBRID" for item in parsed):
            raise EnvelopeError("production_profile_requires_all_pq_hybrid_recipients")
    elif profile == PROFILE_COMPAT_TEST:
        pass
    else:
        raise EnvelopeError("encryption_profile_invalid")
    return parsed


def _age_version(age_bin: Path) -> str:
    try:
        proc = subprocess.run([str(age_bin), "--version"], check=True, text=True, capture_output=True, timeout=10)
    except (OSError, subprocess.SubprocessError) as exc:
        raise EnvelopeError("age_version_check_failed") from exc
    text = (proc.stdout + "\n" + proc.stderr).strip()
    if AGE_REQUIRED_VERSION not in text:
        raise EnvelopeError(f"age_version_mismatch:required={AGE_REQUIRED_VERSION}:observed={text[:120]}")
    return AGE_REQUIRED_VERSION


def _run_age_encrypt(age_bin: Path, recipients_file: Path, bundle: Path, output: Path) -> None:
    if output.exists():
        raise EnvelopeError("ciphertext_output_already_exists")
    output.parent.mkdir(parents=True, exist_ok=True)
    command = [str(age_bin), "--encrypt", "--recipients-file", str(recipients_file), "--output", str(output), str(bundle)]
    try:
        subprocess.run(command, check=True, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=300)
    except (OSError, subprocess.SubprocessError) as exc:
        try:
            output.unlink(missing_ok=True)
        except OSError:
            pass
        raise EnvelopeError("age_encrypt_failed") from exc
    try:
        output.chmod(0o600)
    except OSError as exc:
        raise EnvelopeError("ciphertext_chmod_failed") from exc


def _recipient_public_summary(items: Iterable[dict[str, str]]) -> list[dict[str, str]]:
    summary = []
    for item in items:
        recipient = item["recipient"]
        summary.append({
            "kind": item["kind"],
            "recipient_sha256": _sha256_bytes(recipient.encode("utf-8")),
        })
    return sorted(summary, key=lambda x: x["recipient_sha256"])


def build_envelope(
    *,
    bundle: Path,
    bundle_receipt_path: Path,
    recipients_file: Path,
    profile: str,
    age_bin: Path,
    output_ciphertext: Path,
    output_receipt: Path,
) -> dict[str, Any]:
    bundle_receipt = validate_bundle_receipt(bundle, bundle_receipt_path)
    recipients = load_recipients(recipients_file, profile)
    version = _age_version(age_bin)
    _run_age_encrypt(age_bin, recipients_file, bundle, output_ciphertext)
    ciphertext_sha, ciphertext_bytes = _hash_file(output_ciphertext)
    if ciphertext_bytes <= 0:
        raise EnvelopeError("ciphertext_empty")
    if ciphertext_sha == bundle_receipt["bundle_sha256"]:
        raise EnvelopeError("ciphertext_equals_plaintext_digest")

    production_ready = profile == PROFILE_PRODUCTION_PQ
    core = {
        "schema": ENVELOPE_SCHEMA,
        "classification": ENVELOPE_CLASSIFICATION,
        "source_bundle": {
            "bundle_sha256": bundle_receipt["bundle_sha256"],
            "bundle_bytes": bundle_receipt["bundle_bytes"],
            "manifest_sha256": bundle_receipt["manifest_sha256"],
            "bundle_receipt_sha256": bundle_receipt["receipt_sha256"],
            "storage_api_objects_included": bool(bundle_receipt.get("storage_api_objects_included")),
        },
        "ciphertext": {
            "format": "age-encryption.org/v1",
            "sha256": ciphertext_sha,
            "bytes": ciphertext_bytes,
        },
        "encryption": {
            "tool": "age",
            "required_version": AGE_REQUIRED_VERSION,
            "observed_version": version,
            "profile": profile,
            "recipient_count": len(recipients),
            "recipients": _recipient_public_summary(recipients),
            "post_quantum_required": profile == PROFILE_PRODUCTION_PQ,
            "encrypt_once_required": True,
            "replication_contract": "COPY_EXACT_CIPHERTEXT_BYTES_DO_NOT_REENCRYPT_PER_PROVIDER",
        },
        "security": {
            "plaintext_upload_allowed": False,
            "plaintext_bundle_must_remain_local": True,
            "external_storage_ready": production_ready,
            "identity_material_embedded": False,
        },
        "authority": {
            "canonical": False,
            "authority_effect": False,
            "r2_proven": False,
            "r3_proven": False,
            "persisted_seal_allowed": False,
        },
        "required_next": "UPLOAD_IDENTICAL_CIPHERTEXT_TO_TWO_INDEPENDENT_DOMAINS_THEN_MATERIALIZE_AND_HASH_READBACK",
    }
    receipt = dict(core)
    receipt["receipt_sha256"] = _sha256_bytes(_canonical_bytes(core))
    output_receipt.parent.mkdir(parents=True, exist_ok=True)
    try:
        output_receipt.write_bytes(_canonical_bytes(receipt) + b"\n")
        output_receipt.chmod(0o600)
    except OSError as exc:
        raise EnvelopeError("envelope_receipt_write_failed") from exc
    return receipt


def validate_envelope_receipt(ciphertext: Path, receipt_path: Path, *, require_production_ready: bool = True) -> dict[str, Any]:
    receipt = _read_json_object(receipt_path, "envelope_receipt")
    if receipt.get("schema") != ENVELOPE_SCHEMA or receipt.get("classification") != ENVELOPE_CLASSIFICATION:
        raise EnvelopeError("envelope_receipt_schema_or_classification_invalid")
    _verify_self_hash(receipt, "receipt_sha256", "envelope_receipt")
    authority = receipt.get("authority")
    security = receipt.get("security")
    encryption = receipt.get("encryption")
    if not isinstance(authority, dict) or any(authority.get(k) is not False for k in ("canonical", "authority_effect", "r2_proven", "r3_proven", "persisted_seal_allowed")):
        raise EnvelopeError("envelope_authority_boundary_invalid")
    if not isinstance(security, dict) or security.get("plaintext_upload_allowed") is not False or security.get("identity_material_embedded") is not False:
        raise EnvelopeError("envelope_security_boundary_invalid")
    if not isinstance(encryption, dict) or encryption.get("replication_contract") != "COPY_EXACT_CIPHERTEXT_BYTES_DO_NOT_REENCRYPT_PER_PROVIDER":
        raise EnvelopeError("envelope_replication_contract_invalid")
    if require_production_ready and security.get("external_storage_ready") is not True:
        raise EnvelopeError("envelope_not_production_storage_ready")
    if require_production_ready and encryption.get("profile") != PROFILE_PRODUCTION_PQ:
        raise EnvelopeError("envelope_not_production_pq_profile")
    actual_sha, actual_bytes = _hash_file(ciphertext)
    cipher = receipt.get("ciphertext")
    if not isinstance(cipher, dict) or actual_sha != cipher.get("sha256") or actual_bytes != cipher.get("bytes"):
        raise EnvelopeError("ciphertext_receipt_mismatch")
    return receipt


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    enc = sub.add_parser("encrypt")
    enc.add_argument("--bundle", required=True)
    enc.add_argument("--bundle-receipt", required=True)
    enc.add_argument("--recipients-file", required=True)
    enc.add_argument("--profile", choices=[PROFILE_PRODUCTION_PQ, PROFILE_COMPAT_TEST], default=PROFILE_PRODUCTION_PQ)
    enc.add_argument("--age-bin", required=True)
    enc.add_argument("--output-ciphertext", required=True)
    enc.add_argument("--output-receipt", required=True)

    verify = sub.add_parser("verify-receipt")
    verify.add_argument("--ciphertext", required=True)
    verify.add_argument("--receipt", required=True)
    verify.add_argument("--allow-compatibility-test", action="store_true")
    args = parser.parse_args(argv)

    try:
        if args.command == "encrypt":
            build_envelope(
                bundle=Path(args.bundle),
                bundle_receipt_path=Path(args.bundle_receipt),
                recipients_file=Path(args.recipients_file),
                profile=args.profile,
                age_bin=Path(args.age_bin),
                output_ciphertext=Path(args.output_ciphertext),
                output_receipt=Path(args.output_receipt),
            )
        else:
            validate_envelope_receipt(Path(args.ciphertext), Path(args.receipt), require_production_ready=not args.allow_compatibility_test)
        return 0
    except EnvelopeError as exc:
        print(f"R1_RECOVERY_ENVELOPE_REJECTED:{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
