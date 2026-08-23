#!/usr/bin/env python3
"""Cross-provider persisted readback verifier for H205F22 A1.

Fetches the AppVeyor build that corresponds to the exact GitHub-tested branch,
reads the AppVeyor evidence artifact back over the provider API, compares the
provider-neutral roots against a local GitHub evidence manifest, and emits a
non-authority cross-provider receipt.

This verifier never grants project authority and never satisfies W1.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
API_ROOT = "https://ci.appveyor.com/api"


def _headers() -> dict[str, str]:
    # Public AppVeyor projects can expose build/artifact reads without a token.
    # If a future account policy requires auth, the token may be supplied only
    # through a secret store. It is never written to output or logs here.
    headers = {"Accept": "application/json", "User-Agent": "h205f22-cross-provider-readback/1"}
    token = os.environ.get("APPVEYOR_API_TOKEN", "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def fetch_bytes(url: str, *, timeout: int = 20) -> bytes:
    req = urllib.request.Request(url, headers=_headers(), method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return response.read()


def fetch_json(url: str, *, timeout: int = 20) -> Any:
    raw = fetch_bytes(url, timeout=timeout)
    return json.loads(raw.decode("utf-8"))


def load_manifest(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"manifest at {path} must be an object")
    return data


def validate_non_authority(manifest: dict[str, Any], *, label: str) -> None:
    authority = manifest.get("authority")
    if not isinstance(authority, dict):
        raise ValueError(f"{label}: authority object missing")
    expected_false = [
        "execution_authority",
        "canonical",
        "authority_effect",
        "persistent_worker_proof",
        "w1_verified",
    ]
    for key in expected_false:
        if authority.get(key) is not False:
            raise ValueError(f"{label}: authority.{key} must be false")


def comparable_roots(manifest: dict[str, Any]) -> dict[str, str]:
    source = manifest.get("source") or {}
    contract = manifest.get("contract") or {}
    roots = {
        "git_sha": str(source.get("git_sha") or "").lower(),
        "tree_sha": str(source.get("tree_sha") or "").lower(),
        "contract_sha256": str(contract.get("sha256") or "").lower(),
        "provider_neutral_result_sha256": str(contract.get("provider_neutral_result_sha256") or "").lower(),
    }
    if not SHA40_RE.fullmatch(roots["git_sha"]):
        raise ValueError("invalid git_sha")
    if not SHA40_RE.fullmatch(roots["tree_sha"]):
        raise ValueError("invalid tree_sha")
    if not SHA256_RE.fullmatch(roots["contract_sha256"]):
        raise ValueError("invalid contract_sha256")
    if not SHA256_RE.fullmatch(roots["provider_neutral_result_sha256"]):
        raise ValueError("invalid provider_neutral_result_sha256")
    return roots


def compare_manifests(github: dict[str, Any], appveyor: dict[str, Any]) -> dict[str, str]:
    validate_non_authority(github, label="github")
    validate_non_authority(appveyor, label="appveyor")

    if github.get("provider", {}).get("kind") != "github-actions":
        raise ValueError("github manifest provider.kind mismatch")
    if appveyor.get("provider", {}).get("kind") != "appveyor":
        raise ValueError("appveyor manifest provider.kind mismatch")

    github_roots = comparable_roots(github)
    appveyor_roots = comparable_roots(appveyor)
    if github_roots != appveyor_roots:
        diff = {
            key: {"github": github_roots[key], "appveyor": appveyor_roots[key]}
            for key in github_roots
            if github_roots[key] != appveyor_roots[key]
        }
        raise ValueError(f"cross-provider root mismatch: {json.dumps(diff, sort_keys=True)}")
    return github_roots


def branch_build_url(account: str, project: str, branch: str) -> str:
    account_q = urllib.parse.quote(account, safe="")
    project_q = urllib.parse.quote(project, safe="")
    branch_q = urllib.parse.quote(branch, safe="")
    return f"{API_ROOT}/projects/{account_q}/{project_q}/branch/{branch_q}"


def artifact_list_url(job_id: str) -> str:
    return f"{API_ROOT}/buildjobs/{urllib.parse.quote(job_id, safe='')}/artifacts"


def artifact_url(job_id: str, file_name: str) -> str:
    job_q = urllib.parse.quote(job_id, safe="")
    file_q = urllib.parse.quote(file_name, safe="/")
    return f"{API_ROOT}/buildjobs/{job_q}/artifacts/{file_q}"


def wait_for_exact_success(
    *,
    account: str,
    project: str,
    branch: str,
    expected_git_sha: str,
    attempts: int,
    interval_seconds: int,
) -> dict[str, Any]:
    url = branch_build_url(account, project, branch)
    last_summary: dict[str, Any] = {}
    for attempt in range(1, attempts + 1):
        try:
            payload = fetch_json(url)
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403):
                raise RuntimeError(
                    "AppVeyor public readback denied; fail closed. "
                    "If account policy requires it, configure APPVEYOR_API_TOKEN only in a secret store."
                ) from exc
            raise

        build = payload.get("build") or {}
        commit_id = str(build.get("commitId") or "").lower()
        status = str(build.get("status") or "").lower()
        build_id = build.get("buildId")
        jobs = build.get("jobs") or []
        last_summary = {
            "attempt": attempt,
            "build_id": build_id,
            "commit_id": commit_id,
            "status": status,
        }

        if commit_id == expected_git_sha:
            if status == "success":
                if not jobs:
                    raise RuntimeError("AppVeyor exact-success build has no jobs")
                return build
            if status in {"failed", "cancelled"}:
                raise RuntimeError(f"AppVeyor exact build ended with status={status}")

        if attempt < attempts:
            time.sleep(interval_seconds)

    raise TimeoutError(f"AppVeyor exact-success build not observed: {json.dumps(last_summary, sort_keys=True)}")


def fetch_appveyor_manifest(build: dict[str, Any], expected_suffix: str) -> tuple[dict[str, Any], str, str]:
    jobs = build.get("jobs") or []
    if len(jobs) != 1:
        raise RuntimeError(f"expected exactly one AppVeyor job, found {len(jobs)}")
    job_id = str(jobs[0].get("jobId") or "")
    if not job_id:
        raise RuntimeError("AppVeyor jobId missing")

    artifacts = fetch_json(artifact_list_url(job_id))
    if not isinstance(artifacts, list):
        raise RuntimeError("AppVeyor artifact list is not an array")
    candidates = [
        item for item in artifacts
        if isinstance(item, dict) and str(item.get("fileName") or "").endswith(expected_suffix)
    ]
    if len(candidates) != 1:
        names = [str(item.get("fileName")) for item in artifacts if isinstance(item, dict)]
        raise RuntimeError(f"expected one {expected_suffix} artifact, found {len(candidates)}; names={names}")

    file_name = str(candidates[0]["fileName"])
    raw = fetch_bytes(artifact_url(job_id, file_name))
    data = json.loads(raw.decode("utf-8"))
    if not isinstance(data, dict):
        raise RuntimeError("AppVeyor evidence artifact is not a JSON object")
    return data, job_id, file_name


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--github-evidence", required=True)
    parser.add_argument("--output", default="evidence/cross-provider-readback.json")
    parser.add_argument("--account", default="PatrickFrome")
    parser.add_argument("--project", default="compute")
    parser.add_argument("--branch", required=True)
    parser.add_argument("--attempts", type=int, default=36)
    parser.add_argument("--interval-seconds", type=int, default=10)
    args = parser.parse_args()

    if args.attempts < 1 or args.attempts > 90:
        raise ValueError("attempts must be in [1,90]")
    if args.interval_seconds < 1 or args.interval_seconds > 60:
        raise ValueError("interval-seconds must be in [1,60]")

    github_path = Path(args.github_evidence)
    github = load_manifest(github_path)
    github_roots = comparable_roots(github)
    expected_git_sha = github_roots["git_sha"]

    build = wait_for_exact_success(
        account=args.account,
        project=args.project,
        branch=args.branch,
        expected_git_sha=expected_git_sha,
        attempts=args.attempts,
        interval_seconds=args.interval_seconds,
    )
    appveyor, job_id, file_name = fetch_appveyor_manifest(build, "appveyor-zero-spend.json")
    roots = compare_manifests(github, appveyor)

    receipt = {
        "schema": "metaengine.compute.a1.cross-provider-readback.h205f22.v1",
        "evidence_class": "CROSS_PROVIDER_REPRODUCED_VERIFIED",
        "verification_scope": "EPHEMERAL_CI_EXECUTION_ONLY",
        "providers": ["github-actions", "appveyor"],
        "roots": roots,
        "appveyor_readback": {
            "account": args.account,
            "project": args.project,
            "branch": args.branch,
            "build_id": build.get("buildId"),
            "build_version": build.get("version"),
            "job_id": job_id,
            "artifact_file": file_name,
            "build_status": build.get("status"),
        },
        "authority": {
            "execution_authority": False,
            "canonical": False,
            "authority_effect": False,
            "persistent_worker_proof": False,
            "w1_verified": False,
        },
    }

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(receipt, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": "PASS",
        "evidence_class": receipt["evidence_class"],
        "git_sha": roots["git_sha"],
        "provider_neutral_result_sha256": roots["provider_neutral_result_sha256"],
        "authority_effect": False,
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
