#!/usr/bin/env python3
"""Collect AWS EC2 IID bytes as an explicitly untrusted transport envelope.

The courier never verifies provider identity and never claims reboot completion,
persistence, W1 verification, admission, canonical status, or authority. It only
uses IMDSv2 at the fixed EC2 link-local IPv4 endpoint and exports the raw signed
bytes plus transport hashes for independent off-host verification.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import http.client
import json
import sys
from typing import Any, Callable

IMDS_HOST = "169.254.169.254"
IMDS_PORT = 80
TOKEN_PATH = "/latest/api/token"
DOCUMENT_PATH = "/latest/dynamic/instance-identity/document"
RSA2048_PATH = "/latest/dynamic/instance-identity/rsa2048"
TOKEN_TTL_SECONDS = "60"
TIMEOUT_SECONDS = 2.0
MAX_TOKEN_BYTES = 4096
MAX_DOCUMENT_BYTES = 16384
MAX_RSA2048_BYTES = 32768
SCHEMA = "metaengine.compute.w1-aws-iid-courier.h205f22.v1"


class CourierError(RuntimeError):
    pass


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _read_limited(response: Any, limit: int, label: str) -> bytes:
    data = response.read(limit + 1)
    if not isinstance(data, (bytes, bytearray)):
        raise CourierError(f"{label}_response_not_bytes")
    data = bytes(data)
    if len(data) > limit:
        raise CourierError(f"{label}_response_too_large")
    if not data:
        raise CourierError(f"{label}_response_empty")
    return data


def _require_status(response: Any, label: str) -> None:
    status = getattr(response, "status", None)
    if status != 200:
        raise CourierError(f"{label}_http_status:{status}")


def _fetch_token(connection: Any) -> str:
    connection.request(
        "PUT",
        TOKEN_PATH,
        body=None,
        headers={"X-aws-ec2-metadata-token-ttl-seconds": TOKEN_TTL_SECONDS},
    )
    response = connection.getresponse()
    _require_status(response, "token")
    raw = _read_limited(response, MAX_TOKEN_BYTES, "token")
    try:
        token = raw.decode("ascii")
    except UnicodeDecodeError as exc:
        raise CourierError("token_not_ascii") from exc
    if token.strip() != token or any(ord(ch) < 33 or ord(ch) > 126 for ch in token):
        raise CourierError("token_invalid_characters")
    return token


def _fetch_dynamic(connection: Any, path: str, token: str, limit: int, label: str) -> bytes:
    connection.request(
        "GET",
        path,
        body=None,
        headers={"X-aws-ec2-metadata-token": token},
    )
    response = connection.getresponse()
    _require_status(response, label)
    return _read_limited(response, limit, label)


def collect(
    connection_factory: Callable[..., Any] = http.client.HTTPConnection,
) -> dict[str, Any]:
    # Host and port are constants, never caller input. http.client does not
    # follow redirects; any 3xx is rejected by _require_status.
    connection = connection_factory(IMDS_HOST, IMDS_PORT, timeout=TIMEOUT_SECONDS)
    try:
        token = _fetch_token(connection)
        document = _fetch_dynamic(connection, DOCUMENT_PATH, token, MAX_DOCUMENT_BYTES, "document")
        rsa2048 = _fetch_dynamic(connection, RSA2048_PATH, token, MAX_RSA2048_BYTES, "rsa2048")
    except (OSError, http.client.HTTPException) as exc:
        raise CourierError("imds_transport_failure") from exc
    finally:
        try:
            connection.close()
        except Exception:
            pass

    return {
        "schema": SCHEMA,
        "source": "HOST_UNTRUSTED_TRANSPORT",
        "transport": "AWS_IMDSV2_LINK_LOCAL_IPV4",
        "document_base64": base64.b64encode(document).decode("ascii"),
        "document_sha256": _sha256(document),
        "rsa2048_base64": base64.b64encode(rsa2048).decode("ascii"),
        "rsa2048_transport_sha256": _sha256(rsa2048),
        "provider_identity_verified": False,
        "reboot_completion_proven": False,
        "persistent_worker_proof": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    try:
        result = collect()
    except CourierError as exc:
        print(f"W1_AWS_IID_COURIER_REJECTED:{exc}", file=sys.stderr)
        return 1
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(result, handle, sort_keys=True, separators=(",", ":"))
        handle.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
