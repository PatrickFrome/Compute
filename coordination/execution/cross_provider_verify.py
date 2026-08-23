#!/usr/bin/env python3
"""Cross-provider persisted readback verifier for H205F22 A1.

Finds the exact AppVeyor build for the Git commit tested by GitHub, reads its
evidence artifact back over the provider API, compares provider-neutral roots,
and emits a non-authority cross-provider receipt.

The lookup is commit-centric rather than branch-centric so the same verifier
works for AppVeyor PR builds (which may report the PR base branch) and normal
branch builds after merge.

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
    headers = {"Accept": "application/json", "User-Agent": "h205f22-cross-provider-readback/2"}
    token = os.environ.get("APPVEYOR_API_TOKEN", "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def fetch_bytes(url: str, *, timeout: int = 20) -> bytes:
    req = urllib.request.Request(url, headers=_headers(), method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return response.read()


def fetch_json(url: str, *, timeout: int = 20) -> Any:
    return json.loads(fetch_bytes(url, timeout=timeout).decode("utf-8"))


def load_manifest(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"manifest at {path} must be an object")
    return data


def validate_non_authority(manifest: dict[str, Any], *, label: str) -> None:
    authority = manifest.get("authority")
    if not isinstance(authority, dict):
        raise ValueError(f"{label}: authority object missing")
    for key in (
        "execution_authority",
        "canonical",
        "authority_effect",
        "persistent_worker_proof",
        "w1_verified",
    ):
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


def _project_prefix(account: str, project: str) -> str:
    account_q = urllib.parse.quote(account, safe="")
    project_q = urllib.parse.quote(project, safe="")
    return f"{API_ROOT}/projects/{account_q}/{project_q}"


def history_url(account: str, project: str, *, records: int = 100) -> str:
    return f"{_project_prefix(account, project)}/history?recordsNumber={records}"


def build_version_url(account: str, project: str, version: str) -> str:
    return f"{_project_prefix(account, project)}/build/{urllib.parse.quote(version, safe='')}"


def artifact_list_url(job_id: str) -> str:
    return f"{API_ROOT}/buildjobs/{urllib.parse.quote(job_id, safe='')}/artifacts"


def artifact_url(job_id: str, file_name: str) -> str:
    job_q = urllib.parse.quote(job_id, safe="")
    file_q = urllib.parse.quote(file_name, safe="/")
    return f"{API_ROOT}/buildjobs/{job_q}/artifacts/{file_q}"


def _fetch_with_auth_failure_message(url: str) -> Any:
    try:
        return fetch_json(url)
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise RuntimeError(
                "AppVeyor readback denied; fail closed. If account policy requires auth, "
                "configure APPVEYOR_API_TOKEN only in a secret store."
            ) from exc
        raise


def wait_for_exact_success(
    *,
    account: str,
    project: str,
    expected_git_sha: str,
    attempts: int,
    interval_seconds: int,
) -> dict[str, Any]:
    url = history_url(account, project)
    last_summary: dict[str, Any] = {}

    for attempt in range(1, attempts + 1):
        payload = _fetch_with_auth_failure_message(url)
        builds = payload.get("builds") or []
        exact = [
            b for b in builds
            if isinstance(b, dict) and str(b.get("commitId") or "").lower() == expected_git_sha
        ]
        terminal_failures = []
        pending = []
        for build in exact:
            status = str(build.get("status") or "").lower()
            if status == "success":
                version = str(build.get("version") or "")
                if not version:
                    raise RuntimeError("AppVeyor successful history row has no version")
                details = _fetch_with_auth_failure_message(build_version_url(account, project, version))
                full_build = details.get("build") or {}
                if str(full_build.get("commitId") or "").lower() != expected_git_sha:
                    raise RuntimeError("AppVeyor build-detail commit changed during readback")
                if str(full_build.get("status") or "").lower() != "success":
                    pending.append({"version": version, "status": full_build.get("status")})
                    continue
                if not (full_build.get("jobs") or []):
                    raise RuntimeError("AppVeyor exact-success build has no jobs")
                return full_build
            if status in {"failed", "cancelled"}:
                terminal_failures.append({"build_id": build.get("buildId"), "version": build.get("version"), "status": status})
            else:
                pending.append({"build_id": build.get("buildId"), "version": build.get("version"), "status": status})

        last_summary = {
            "attempt": attempt,
            "exact_builds": len(exact),
            "pending": pending,
            "terminal_failures": terminal_failures,
        }

        # If at least one exact build is still queued/running, allow it to finish.
        # If all exact builds are terminal failures, fail immediately instead of
        # waiting for an impossible promotion.
        if exact and not pending and terminal_failures:
            raise RuntimeError(f"all AppVeyor exact builds failed: {json.dumps(terminal_failures, sort_keys=True)}")

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

    artifacts = _fetch_with_auth_failure_message(artifact_list_url(job_id))
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
    parser.add_argument("--branch", required=True, help="source branch recorded for provenance only")
    parser.add_argument("--attempts", type=int, default=36)
    parser.add_argument("--interval-seconds", type=int, default=10)
    args = parser.parse_args()

    if args.attempts < 1 or args.attempts > 90:
        raise ValueError("attempts must be in [1,90]")
    if args.interval_seconds < 1 or args.interval_seconds > 60:
        raise ValueError("interval-seconds must be in [1,60]")

    github = load_manifest(Path(args.github_evidence))
    expected_git_sha = comparable_roots(github)["git_sha"]
    build = wait_for_exact_success(
        account=args.account,
        project=args.project,
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
            "source_branch": args.branch,
            "build_id": build.get("buildId"),
            "build_version": build.get("version"),
            "pull_request_id": build.get("pullRequestId"),
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
