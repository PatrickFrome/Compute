#!/usr/bin/env python3
import hashlib
import json
import os
import platform
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


def required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name}_required")
    return value


def credential_path() -> Path:
    configured = os.getenv("METAENGINE_BEARER_TOKEN_FILE", "").strip()
    if configured:
        return Path(configured)
    cdir = os.getenv("CREDENTIALS_DIRECTORY", "").strip()
    if cdir:
        return Path(cdir) / "bearer-token"
    raise RuntimeError("bearer_token_credential_missing")


def read_token() -> str:
    path = credential_path()
    token = path.read_text().strip()
    if len(token) < 32 or any(ch.isspace() for ch in token):
        raise RuntimeError("bearer_token_invalid")
    return token


def read_text(path: str) -> str:
    try:
        return Path(path).read_text().strip()
    except OSError:
        return ""


def health_payload(worker_id: str, started_monotonic: float) -> dict:
    boot = read_text("/proc/sys/kernel/random/boot_id")
    cg = read_text("/proc/self/cgroup")
    return {
        "schema": "metaengine.compute.native-linux-worker-health.h205f22.v1",
        "worker_id": worker_id,
        "status": "ACTIVE",
        "os": platform.system().lower(),
        "arch": platform.machine(),
        "pid": os.getpid(),
        "euid": os.geteuid(),
        "uptime_seconds": round(time.monotonic() - started_monotonic, 3),
        "boot_id_sha256": hashlib.sha256(boot.encode()).hexdigest() if boot else None,
        "cgroup_sha256": hashlib.sha256(cg.encode()).hexdigest() if cg else None,
    }


def post_heartbeat(url: str, token: str, worker_id: str, health: dict) -> dict:
    body = json.dumps({
        "action": "resource_heartbeat",
        "worker_id": worker_id,
        "health": health,
    }, separators=(",", ":")).encode()
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "metaengine-native-linux-worker-h205f22/1",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read(65536)
            if resp.status != 200:
                raise RuntimeError(f"heartbeat_http_{resp.status}")
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise PermissionError(f"heartbeat_auth_{exc.code}") from exc
        raise RuntimeError(f"heartbeat_http_{exc.code}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError("heartbeat_transport_failed") from exc
    try:
        doc = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError("heartbeat_invalid_json") from exc
    if not isinstance(doc, dict) or doc.get("state") != "ACTIVE" or doc.get("worker_id") != worker_id:
        raise RuntimeError("heartbeat_receipt_mismatch")
    return doc


def main() -> int:
    url = required_env("METAENGINE_GATEWAY_URL")
    worker_id = required_env("METAENGINE_WORKER_ID")
    interval = int(os.getenv("METAENGINE_HEARTBEAT_INTERVAL_SECONDS", "30"))
    if interval < 10 or interval > 90:
        raise RuntimeError("heartbeat_interval_out_of_bounds")
    if os.geteuid() == 0:
        raise RuntimeError("root_execution_forbidden")

    started = time.monotonic()
    consecutive_failures = 0
    while True:
        try:
            token = read_token()  # re-read on every cycle for atomic credential rotation
            receipt = post_heartbeat(url, token, worker_id, health_payload(worker_id, started))
            consecutive_failures = 0
            print(json.dumps({
                "event": "heartbeat_accepted",
                "worker_id": worker_id,
                "pool_id": receipt.get("pool_id"),
                "generation": receipt.get("generation"),
                "last_seen_at": receipt.get("last_seen_at"),
            }, separators=(",", ":")), flush=True)
        except PermissionError as exc:
            print(json.dumps({"event": "heartbeat_auth_fenced", "error": str(exc)}), file=sys.stderr, flush=True)
            return 77
        except Exception as exc:
            consecutive_failures += 1
            print(json.dumps({
                "event": "heartbeat_failed",
                "error": type(exc).__name__,
                "detail": str(exc)[:240],
                "consecutive_failures": consecutive_failures,
                "fallback": False,
            }, separators=(",", ":")), file=sys.stderr, flush=True)
            # Fail closed before the scheduler's 120s freshness window can be silently exceeded.
            if consecutive_failures >= 2:
                return 75
        time.sleep(interval)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"event": "worker_start_failed", "error": type(exc).__name__, "detail": str(exc)[:240], "fallback": False}), file=sys.stderr)
        raise SystemExit(78)
