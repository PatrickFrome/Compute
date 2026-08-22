#!/usr/bin/env python3
"""Fetch the W1 bearer token from AWS Secrets Manager using only stdlib.

The EC2 instance role is the credential boundary. The secret value is written to
an explicitly requested local path and is never printed. IMDSv2 is mandatory.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import hmac
import json
import os
import stat
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

IMDS = "http://169.254.169.254/latest"


def request(url: str, *, method: str = "GET", headers: dict[str, str] | None = None, data: bytes | None = None, timeout: int = 10) -> bytes:
    req = urllib.request.Request(url, method=method, headers=headers or {}, data=data)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        if resp.status < 200 or resp.status >= 300:
            raise RuntimeError(f"http_{resp.status}")
        return resp.read(1024 * 1024)


def imds_token() -> str:
    raw = request(
        f"{IMDS}/api/token",
        method="PUT",
        headers={"X-aws-ec2-metadata-token-ttl-seconds": "300"},
    )
    token = raw.decode().strip()
    if len(token) < 16:
        raise RuntimeError("imds_v2_token_invalid")
    return token


def imds_get(path: str, token: str) -> str:
    return request(
        f"{IMDS}/{path.lstrip('/')}",
        headers={"X-aws-ec2-metadata-token": token},
    ).decode().strip()


def sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def signing_key(secret: str, date_stamp: str, region: str, service: str) -> bytes:
    k_date = sign(("AWS4" + secret).encode("utf-8"), date_stamp)
    k_region = sign(k_date, region)
    k_service = sign(k_region, service)
    return sign(k_service, "aws4_request")


def fetch_secret(region: str, secret_id: str, creds: dict[str, str]) -> str:
    service = "secretsmanager"
    host = f"secretsmanager.{region}.amazonaws.com"
    endpoint = f"https://{host}/"
    body = json.dumps({"SecretId": secret_id}, separators=(",", ":")).encode("utf-8")

    now = dt.datetime.now(dt.timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    payload_hash = hashlib.sha256(body).hexdigest()
    canonical_headers = (
        "content-type:application/x-amz-json-1.1\n"
        f"host:{host}\n"
        f"x-amz-date:{amz_date}\n"
        f"x-amz-security-token:{creds['Token']}\n"
        "x-amz-target:secretsmanager.GetSecretValue\n"
    )
    signed_headers = "content-type;host;x-amz-date;x-amz-security-token;x-amz-target"
    canonical_request = "\n".join([
        "POST", "/", "", canonical_headers, signed_headers, payload_hash
    ])
    scope = f"{date_stamp}/{region}/{service}/aws4_request"
    string_to_sign = "\n".join([
        "AWS4-HMAC-SHA256",
        amz_date,
        scope,
        hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
    ])
    signature = hmac.new(
        signing_key(creds["SecretAccessKey"], date_stamp, region, service),
        string_to_sign.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    authorization = (
        f"AWS4-HMAC-SHA256 Credential={creds['AccessKeyId']}/{scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )
    headers = {
        "Content-Type": "application/x-amz-json-1.1",
        "Host": host,
        "X-Amz-Date": amz_date,
        "X-Amz-Security-Token": creds["Token"],
        "X-Amz-Target": "secretsmanager.GetSecretValue",
        "Authorization": authorization,
    }
    raw = request(endpoint, method="POST", headers=headers, data=body)
    doc = json.loads(raw)
    if not isinstance(doc, dict) or "SecretString" not in doc:
        raise RuntimeError("secret_string_required")
    value = str(doc["SecretString"]).strip()
    if len(value) < 32 or any(ch.isspace() for ch in value):
        raise RuntimeError("bootstrap_secret_invalid")
    return value


def secure_write(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(path, flags, 0o400)
    try:
        os.fchmod(fd, stat.S_IRUSR)
        os.write(fd, (value + "\n").encode("utf-8"))
        os.fsync(fd)
    finally:
        os.close(fd)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--region", required=True)
    ap.add_argument("--secret-id", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--receipt", required=True)
    args = ap.parse_args()

    if not args.secret_id.startswith("arn:") or ":secretsmanager:" not in args.secret_id:
        raise RuntimeError("secrets_manager_arn_required")
    arn_parts = args.secret_id.split(":", 5)
    if len(arn_parts) < 6 or arn_parts[3] != args.region:
        raise RuntimeError("secret_region_mismatch")

    token = imds_token()
    role_name = imds_get("meta-data/iam/security-credentials/", token).splitlines()[0].strip()
    if not role_name:
        raise RuntimeError("instance_role_required")
    creds_doc = json.loads(imds_get(f"meta-data/iam/security-credentials/{urllib.parse.quote(role_name)}", token))
    for key in ("AccessKeyId", "SecretAccessKey", "Token"):
        if not creds_doc.get(key):
            raise RuntimeError(f"instance_role_{key.lower()}_missing")

    instance_id = imds_get("meta-data/instance-id", token)
    identity_doc_raw = imds_get("dynamic/instance-identity/document", token)
    identity_sig = imds_get("dynamic/instance-identity/signature", token)
    secret = fetch_secret(args.region, args.secret_id, creds_doc)
    secure_write(Path(args.output), secret)

    receipt = {
        "schema": "metaengine.compute.aws-bootstrap-secret.h205f22.v1",
        "provider_kind": "AWS_EC2",
        "instance_id": instance_id,
        "region": args.region,
        "role_name_sha256": hashlib.sha256(role_name.encode()).hexdigest(),
        "secret_sha256": hashlib.sha256(secret.encode()).hexdigest(),
        "identity_document_sha256": hashlib.sha256(identity_doc_raw.encode()).hexdigest(),
        "identity_signature_sha256": hashlib.sha256(identity_sig.encode()).hexdigest(),
        "imds_version": 2,
        "secret_value_logged": False,
        "canonical": False,
        "authority_effect": False,
        "persistent_worker_proof": False,
    }
    Path(args.receipt).write_text(json.dumps(receipt, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": "BOOTSTRAP_SECRET_WRITTEN",
        "instance_id": instance_id,
        "receipt": args.receipt,
        "secret_value_logged": False,
    }, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, OSError, urllib.error.URLError, json.JSONDecodeError) as exc:
        print(json.dumps({"status": "FAILED", "error": type(exc).__name__, "detail": str(exc)[:240]}), file=sys.stderr)
        raise SystemExit(1)
