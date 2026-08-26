#!/usr/bin/env python3
"""GitHub Codespaces lifecycle provenance collector for W1.

Default mode is DRY_RUN and performs no network/provider mutation. EXECUTE is
armed only when BOTH --execute and METAENGINE_W1_PROVIDER_MUTATION_AUTHORIZED=1
are present. The GitHub token is read from an environment variable and is never
serialized, hashed, echoed or stored in the receipt.

An executed receipt is still NON-AUTHORITY: it records successful authenticated
REST observations, but Supabase persisted readback and supervisor verification
must independently bind it to a fresh W1 claim/directive before any W1 outcome.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any

from controller.w1 import github_codespaces_snapshot_guard

SCHEMA = "metaengine.compute.w1-github-codespaces-lifecycle-provenance.h205f22.v1"
API_BASE = "https://api.github.com"
API_VERSION = "2026-03-10"
ACCEPT = "application/vnd.github+json"
USER_AGENT = "METAENGINE-H205F22-W1-Provenance/1"
EXECUTE_ENV = "METAENGINE_W1_PROVIDER_MUTATION_AUTHORIZED"
NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,240}$")
REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
POLL_SECONDS = 2.0
DEFAULT_TIMEOUT_SECONDS = 120


def canonical_hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def _endpoint(name: str, suffix: str = "") -> str:
    if not NAME_RE.fullmatch(name):
        raise ValueError("invalid codespace name")
    if suffix not in {"", "/stop", "/start"}:
        raise ValueError("unsupported Codespaces lifecycle suffix")
    return f"{API_BASE}/user/codespaces/{name}{suffix}"


def _request_headers(token: str) -> dict[str, str]:
    if not isinstance(token, str) or not token.strip():
        raise RuntimeError("GitHub token required for execute mode")
    return {
        "Accept": ACCEPT,
        "Authorization": "Bearer " + token,
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": USER_AGENT,
    }


def _selected_snapshot(body: Any, *, expected_name: str, expected_repo: str) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise ValueError("GitHub Codespaces response must be an object")
    if not NAME_RE.fullmatch(expected_name) or not REPO_RE.fullmatch(expected_repo):
        raise ValueError("invalid expected Codespace identity")
    required = ("id", "name", "environment_id", "repository", "machine", "updated_at", "state", "location", "url", "start_url", "stop_url")
    missing = [key for key in required if key not in body]
    if missing:
        raise ValueError(f"GitHub Codespaces response missing fields: {missing}")
    repo = body.get("repository") or {}
    machine = body.get("machine") or {}
    selected = {
        "id": body["id"],
        "name": body["name"],
        "environment_id": body["environment_id"],
        "repository": {"full_name": repo.get("full_name")},
        "machine": {"operating_system": machine.get("operating_system")},
        "updated_at": body["updated_at"],
        "state": body["state"],
        "location": body["location"],
        "url": body["url"],
        "start_url": body["start_url"],
        "stop_url": body["stop_url"],
    }
    # Reuse the exact structural parser by constructing a single-state payload later.
    if selected["name"] != expected_name or selected["repository"]["full_name"] != expected_repo:
        raise ValueError("GitHub Codespaces response identity mismatch")
    if selected["machine"]["operating_system"] != "linux":
        raise ValueError("GitHub Codespace must report Linux")
    expected = _endpoint(expected_name)
    if selected["url"] != expected or selected["start_url"] != expected + "/start" or selected["stop_url"] != expected + "/stop":
        raise ValueError("GitHub Codespaces lifecycle URLs mismatch")
    return selected


def _safe_response_headers(headers: Any) -> dict[str, str]:
    # Only non-secret response metadata. Do not persist request headers or token-derived values.
    allow = {"date", "etag", "x-github-api-version-selected", "x-github-request-id", "x-ratelimit-resource"}
    result: dict[str, str] = {}
    if headers is None:
        return result
    for key in allow:
        value = headers.get(key)
        if value:
            result[key] = str(value)[:512]
    return result


def _call(*, method: str, url: str, token: str, timeout: float) -> dict[str, Any]:
    if method not in {"GET", "POST"}:
        raise ValueError("only GET/POST allowed")
    if not url.startswith(API_BASE + "/user/codespaces/"):
        raise ValueError("GitHub endpoint outside Codespaces allow-list")
    request = urllib.request.Request(
        url=url,
        data=b"" if method == "POST" else None,
        headers=_request_headers(token),
        method=method,
    )
    started = _utc_now()
    try:
        # Default HTTPS context performs normal certificate and hostname validation.
        with urllib.request.urlopen(request, timeout=timeout, context=ssl.create_default_context()) as response:
            raw = response.read()
            status = int(response.status)
            response_headers = _safe_response_headers(response.headers)
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        status = int(exc.code)
        response_headers = _safe_response_headers(exc.headers)
    completed = _utc_now()
    try:
        body = json.loads(raw.decode("utf-8")) if raw else {}
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("GitHub response is not valid UTF-8 JSON") from exc
    return {
        "method": method,
        "url": url,
        "requested_at": started,
        "completed_at": completed,
        "http_status": status,
        "response_body_sha256": hashlib.sha256(raw).hexdigest(),
        "response_headers": response_headers,
        "body": body,
    }


def _observation(call: dict[str, Any], *, kind: str, expected_name: str, expected_repo: str, expected_status: int = 200) -> dict[str, Any]:
    if call.get("http_status") != expected_status:
        raise RuntimeError(f"GitHub {kind} returned HTTP {call.get('http_status')}")
    selected = _selected_snapshot(call.get("body"), expected_name=expected_name, expected_repo=expected_repo)
    return {
        "kind": kind,
        "method": call["method"],
        "url": call["url"],
        "requested_at": call["requested_at"],
        "completed_at": call["completed_at"],
        "http_status": call["http_status"],
        "response_body_sha256": call["response_body_sha256"],
        "response_headers": call["response_headers"],
        "selected_snapshot": selected,
        "selected_snapshot_sha256": github_codespaces_snapshot_guard.canonical_hash(selected),
    }


def _poll_state(*, name: str, repo: str, token: str, wanted: str, deadline: float) -> dict[str, Any]:
    last: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        call = _call(method="GET", url=_endpoint(name), token=token, timeout=20)
        last = _observation(call, kind=f"poll_{wanted.lower()}", expected_name=name, expected_repo=repo)
        if last["selected_snapshot"]["state"] == wanted:
            return last
        time.sleep(POLL_SECONDS)
    state = None if last is None else last["selected_snapshot"].get("state")
    raise RuntimeError(f"Codespace did not reach {wanted}; last_state={state}")


def compose_execute_receipt(*, name: str, repo: str, pre: dict[str, Any], stop: dict[str, Any], stopped: dict[str, Any], start: dict[str, Any], post: dict[str, Any]) -> dict[str, Any]:
    if not NAME_RE.fullmatch(name) or not REPO_RE.fullmatch(repo):
        raise ValueError("invalid Codespace identity")
    observations = {"pre_get": pre, "stop_post": stop, "stopped_get": stopped, "start_post": start, "post_get": post}
    for label, obs in observations.items():
        if not isinstance(obs, dict) or obs.get("http_status") != 200:
            raise ValueError(f"{label} must be a successful GitHub observation")
        snap = obs.get("selected_snapshot")
        selected = _selected_snapshot(snap, expected_name=name, expected_repo=repo)
        if obs.get("selected_snapshot_sha256") != github_codespaces_snapshot_guard.canonical_hash(selected):
            raise ValueError(f"{label} selected snapshot hash mismatch")
        body_sha = obs.get("response_body_sha256")
        if not isinstance(body_sha, str) or not re.fullmatch(r"[0-9a-f]{64}", body_sha):
            raise ValueError(f"{label} body hash invalid")
    if pre["method"] != "GET" or stopped["method"] != "GET" or post["method"] != "GET":
        raise ValueError("pre/stopped/post must be GET observations")
    if stop["method"] != "POST" or stop["url"] != _endpoint(name, "/stop"):
        raise ValueError("stop action endpoint mismatch")
    if start["method"] != "POST" or start["url"] != _endpoint(name, "/start"):
        raise ValueError("start action endpoint mismatch")

    pre_snap = pre["selected_snapshot"]
    stop_snap = stop["selected_snapshot"]
    stopped_snap = stopped["selected_snapshot"]
    start_snap = start["selected_snapshot"]
    post_snap = post["selected_snapshot"]
    if pre_snap["state"] != "Available" or stopped_snap["state"] != "Shutdown" or post_snap["state"] != "Available":
        raise ValueError("provider state sequence must be Available->Shutdown->Available")
    ids = {x["id"] for x in (pre_snap, stop_snap, stopped_snap, start_snap, post_snap)}
    names = {x["name"] for x in (pre_snap, stop_snap, stopped_snap, start_snap, post_snap)}
    if len(ids) != 1 or len(names) != 1:
        raise ValueError("Codespace provider identity changed across lifecycle")

    snapshot_input = {
        "schema": github_codespaces_snapshot_guard.INPUT_SCHEMA,
        "pre": pre_snap,
        "stopped": stopped_snap,
        "post": post_snap,
        "nonclaims": {
            "canonical": False,
            "authority_effect": False,
            "provider_identity_verified": False,
            "provider_action_verified": False,
            "persistent_worker_proof": False,
            "worker_admitted": False,
            "w1_verified": False,
        },
    }
    oracle = github_codespaces_snapshot_guard.evaluate(snapshot_input)
    if oracle["outcome"] != "CODESPACES_SNAPSHOTS_STRUCTURALLY_ELIGIBLE_NONAUTHORITY":
        raise ValueError("authenticated observations do not form eligible provider oracle")

    evidence = {
        "api_base": API_BASE,
        "api_version": API_VERSION,
        "accept": ACCEPT,
        "codespace_name": name,
        "repository_full_name": repo,
        "transport": "HTTPS_DEFAULT_CA_HOSTNAME_VALIDATION",
        "token_material_persisted": False,
        "observations": observations,
        "provider_oracle": oracle,
        "provider_oracle_sha256": oracle["oracle_sha256"],
        "pre_snapshot_sha256": oracle["evidence"]["pre_snapshot_sha256"],
        "stopped_snapshot_sha256": oracle["evidence"]["stopped_snapshot_sha256"],
        "post_snapshot_sha256": oracle["evidence"]["post_snapshot_sha256"],
        "checks": {
            "get_pre_http_200": True,
            "stop_post_http_200": True,
            "get_shutdown_http_200": True,
            "start_post_http_200": True,
            "get_post_http_200": True,
            "provider_sequence_eligible": True,
            "provider_identity_stable": True,
            "token_not_persisted": True,
            "https_default_ca_hostname_validation": True,
        },
    }
    return {
        "schema": SCHEMA,
        "mode": "EXECUTE",
        "outcome": "CAPTURED_NONAUTHORITY",
        "evidence": evidence,
        "receipt_sha256": canonical_hash(evidence),
        "api_authentication_observed": True,
        "provider_identity_verified": False,
        "provider_action_verified": False,
        "authenticated_provider_provenance_verified": False,
        "persisted_readback_verified": False,
        "persistent_worker_proof": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
        "requires_supabase_persisted_readback": True,
        "requires_supervisor_verification": True,
    }


def dry_plan(*, name: str, repo: str, token_env: str) -> dict[str, Any]:
    if not NAME_RE.fullmatch(name) or not REPO_RE.fullmatch(repo):
        raise ValueError("invalid Codespace identity")
    if not token_env or not re.fullmatch(r"[A-Z][A-Z0-9_]{1,127}", token_env):
        raise ValueError("invalid token environment variable name")
    return {
        "schema": SCHEMA,
        "mode": "DRY_RUN",
        "outcome": "PLAN_NONAUTHORITY",
        "api_base": API_BASE,
        "api_version": API_VERSION,
        "accept": ACCEPT,
        "codespace_name": name,
        "repository_full_name": repo,
        "sequence": [
            {"method": "GET", "url": _endpoint(name), "expected_state": "Available"},
            {"method": "POST", "url": _endpoint(name, "/stop"), "expected_http_status": 200},
            {"method": "GET_POLL", "url": _endpoint(name), "expected_state": "Shutdown"},
            {"method": "POST", "url": _endpoint(name, "/start"), "expected_http_status": 200},
            {"method": "GET_POLL", "url": _endpoint(name), "expected_state": "Available"},
        ],
        "token_source": {"kind": "ENVIRONMENT_VARIABLE", "name": token_env, "material_persisted": False},
        "execute_requires": ["--execute", f"{EXECUTE_ENV}=1", "fresh external W1 authority before invocation"],
        "provider_mutation_performed": False,
        "canonical": False,
        "authority_effect": False,
        "worker_admitted": False,
        "w1_verified": False,
    }


def execute(*, name: str, repo: str, token_env: str, timeout_seconds: int) -> dict[str, Any]:
    if os.environ.get(EXECUTE_ENV) != "1":
        raise RuntimeError(f"execute mode requires {EXECUTE_ENV}=1")
    token = os.environ.get(token_env)
    if not token:
        raise RuntimeError(f"execute mode requires token in {token_env}")
    if timeout_seconds < 30 or timeout_seconds > 600:
        raise ValueError("timeout_seconds must be in [30,600]")

    pre = _observation(_call(method="GET", url=_endpoint(name), token=token, timeout=20), kind="pre_get", expected_name=name, expected_repo=repo)
    if pre["selected_snapshot"]["state"] != "Available":
        raise RuntimeError("Codespace must be Available before STOP_RESUME provenance capture")
    stop = _observation(_call(method="POST", url=_endpoint(name, "/stop"), token=token, timeout=30), kind="stop_post", expected_name=name, expected_repo=repo)
    deadline = time.monotonic() + timeout_seconds
    stopped = _poll_state(name=name, repo=repo, token=token, wanted="Shutdown", deadline=deadline)
    start = _observation(_call(method="POST", url=_endpoint(name, "/start"), token=token, timeout=30), kind="start_post", expected_name=name, expected_repo=repo)
    post = _poll_state(name=name, repo=repo, token=token, wanted="Available", deadline=deadline)
    return compose_execute_receipt(name=name, repo=repo, pre=pre, stop=stop, stopped=stopped, start=start, post=post)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--codespace-name", required=True)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--token-env", default="GITHUB_TOKEN")
    parser.add_argument("--timeout-seconds", type=int, default=DEFAULT_TIMEOUT_SECONDS)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    result = (
        execute(name=args.codespace_name, repo=args.repository, token_env=args.token_env, timeout_seconds=args.timeout_seconds)
        if args.execute
        else dry_plan(name=args.codespace_name, repo=args.repository, token_env=args.token_env)
    )
    json.dump(result, sys.stdout, sort_keys=True, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
