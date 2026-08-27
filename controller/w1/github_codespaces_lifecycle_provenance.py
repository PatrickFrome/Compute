#!/usr/bin/env python3
"""GitHub Codespaces lifecycle provenance contract for W1.

This module is PREP-only. It can build a deterministic lifecycle plan and
validate already-captured authenticated observations, but it deliberately does
not perform Codespaces start/stop provider mutations itself.

Historically EXECUTE could be armed with --execute plus the local environment
flag METAENGINE_W1_PROVIDER_MUTATION_AUTHORIZED=1. That was only a caller
assertion and was not equivalent to a fresh DB-authoritative W1 claim/directive
receipt. The local network mutation path is therefore fail-closed until a
Codespaces-specific external dispatch receipt is implemented and independently
verified. A receipt composed from observations remains NON-AUTHORITY.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from typing import Any

from controller.w1 import github_codespaces_snapshot_guard

SCHEMA = "metaengine.compute.w1-github-codespaces-lifecycle-provenance.h205f22.v1"
API_BASE = "https://api.github.com"
API_VERSION = "2026-03-10"
ACCEPT = "application/vnd.github+json"
EXECUTE_ENV = "METAENGINE_W1_PROVIDER_MUTATION_AUTHORIZED"
EXECUTE_BLOCK = "CODESPACES_EXTERNAL_W1_DISPATCH_RECEIPT_REQUIRED"
NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,240}$")
REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")


def canonical_hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _endpoint(name: str, suffix: str = "") -> str:
    if not NAME_RE.fullmatch(name):
        raise ValueError("invalid codespace name")
    if suffix not in {"", "/stop", "/start"}:
        raise ValueError("unsupported Codespaces lifecycle suffix")
    return f"{API_BASE}/user/codespaces/{name}{suffix}"


def _selected_snapshot(body: Any, *, expected_name: str, expected_repo: str) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise ValueError("GitHub Codespaces response must be an object")
    if not NAME_RE.fullmatch(expected_name) or not REPO_RE.fullmatch(expected_repo):
        raise ValueError("invalid expected Codespace identity")
    required = (
        "id", "name", "environment_id", "repository", "machine", "updated_at",
        "state", "location", "url", "start_url", "stop_url",
    )
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
    if selected["name"] != expected_name or selected["repository"]["full_name"] != expected_repo:
        raise ValueError("GitHub Codespaces response identity mismatch")
    if selected["machine"]["operating_system"] != "linux":
        raise ValueError("GitHub Codespace must report Linux")
    expected = _endpoint(expected_name)
    if selected["url"] != expected or selected["start_url"] != expected + "/start" or selected["stop_url"] != expected + "/stop":
        raise ValueError("GitHub Codespaces lifecycle URLs mismatch")
    return selected


def compose_execute_receipt(
    *, name: str, repo: str, pre: dict[str, Any], stop: dict[str, Any],
    stopped: dict[str, Any], start: dict[str, Any], post: dict[str, Any],
) -> dict[str, Any]:
    """Validate externally captured lifecycle observations as NON-AUTHORITY evidence."""
    if not NAME_RE.fullmatch(name) or not REPO_RE.fullmatch(repo):
        raise ValueError("invalid Codespace identity")
    observations = {
        "pre_get": pre,
        "stop_post": stop,
        "stopped_get": stopped,
        "start_post": start,
        "post_get": post,
    }
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

    snapshots = [
        pre["selected_snapshot"], stop["selected_snapshot"], stopped["selected_snapshot"],
        start["selected_snapshot"], post["selected_snapshot"],
    ]
    if snapshots[0]["state"] != "Available" or snapshots[2]["state"] != "Shutdown" or snapshots[4]["state"] != "Available":
        raise ValueError("provider state sequence must be Available->Shutdown->Available")
    if len({item["id"] for item in snapshots}) != 1 or len({item["name"] for item in snapshots}) != 1:
        raise ValueError("Codespace provider identity changed across lifecycle")

    snapshot_input = {
        "schema": github_codespaces_snapshot_guard.INPUT_SCHEMA,
        "pre": snapshots[0],
        "stopped": snapshots[2],
        "post": snapshots[4],
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
        },
    }
    return {
        "schema": SCHEMA,
        "mode": "EXTERNAL_CAPTURE_READBACK",
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
        "local_execute_available": False,
        "execute_block": EXECUTE_BLOCK,
        "execute_requires": [
            "external Codespaces lifecycle mutator",
            "fresh externally verified W1 dispatch receipt bound to Codespace/action/claim/directive",
            "persisted readback before W1 acceptance",
        ],
        "provider_mutation_performed": False,
        "canonical": False,
        "authority_effect": False,
        "worker_admitted": False,
        "w1_verified": False,
    }


def execute(*, name: str, repo: str, token_env: str, timeout_seconds: int) -> dict[str, Any]:
    """Fail closed before token access or network activity.

    EXECUTE_ENV is retained only so old callers receive an explicit semantic
    break rather than silently falling through. It is never sufficient to
    authorize mutation.
    """
    del name, repo, token_env, timeout_seconds
    raise RuntimeError(EXECUTE_BLOCK)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--codespace-name", required=True)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--token-env", default="GITHUB_TOKEN")
    parser.add_argument("--timeout-seconds", type=int, default=120)
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
