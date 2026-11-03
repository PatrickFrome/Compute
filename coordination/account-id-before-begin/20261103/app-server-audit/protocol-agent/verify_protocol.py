#!/usr/bin/env python3
"""Reproduce the seven pinned protocol checks using local files and Git only.

No installation, network access, authentication, or live app-server calls occur.
Run beside protocol-evidence.json; repository paths can be relocated with flags.
"""

import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


PINNED_COMMIT = "6ff1e1ca3b30fc8b914720681fcf5fe62e95f856"
PINNED_TAG = "rust-v0.166.0"
EXPECTED_SOURCE_COUNT = 21
LOCK_PATH = Path("apps/metaengine-browser/build/private-native-tools.lock.json")
SCHEMA_PATH = "codex-rs/app-server-protocol/schema/json/v2/GetAccountRateLimitsResponse.json"
TS_PATH = "codex-rs/app-server-protocol/schema/typescript/v2/GetAccountRateLimitsResponse.ts"
RUST_PATH = "codex-rs/app-server-protocol/src/protocol/v2/account.rs"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def main():
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--codex-repo", type=Path, default=Path("/workspace/codex-pinned-source"))
    parser.add_argument(
        "--metaengine-repo", type=Path,
        default=Path("/workspace/metaengine-account-source/Compute"),
    )
    parser.add_argument("--evidence", type=Path, default=here / "protocol-evidence.json")
    parser.add_argument("--output", type=Path, default=here / "verification.json")
    args = parser.parse_args()
    codex_repo = args.codex_repo.resolve()
    metaengine_repo = args.metaengine_repo.resolve()
    checks = []
    details = []
    context = {}

    # Disable optional index writes, filesystem hooks, and partial-clone fetching.
    git_env = os.environ.copy()
    git_env.update({
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_CONFIG_COUNT": "0",
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_NO_LAZY_FETCH": "1",
        "GIT_OPTIONAL_LOCKS": "0",
    })

    def git_read(*git_args):
        command = [
            "git", "--no-optional-locks", "-c", "core.fsmonitor=false",
            "-c", "core.untrackedCache=false", "-C", str(codex_repo), *git_args,
        ]
        result = subprocess.run(command, env=git_env, capture_output=True, check=False)
        require(result.returncode == 0, f"Local git {git_args[0]} failed with exit code {result.returncode}")
        return result.stdout

    def read_source(path):
        return (codex_repo / path).read_text(encoding="utf-8")

    def run_check(name, operation):
        checks.append(name)
        try:
            observation = operation()
            details.append({"name": name, "passed": True, "observation": observation})
        except (OSError, ValueError, KeyError, TypeError) as error:
            details.append({"name": name, "passed": False, "error": str(error)})

    def check_pin():
        evidence = json.loads(args.evidence.read_text(encoding="utf-8"))
        require(evidence["upstream_commit"] == PINNED_COMMIT, "Evidence commit differs from verifier pin")
        require(evidence["upstream_tag"] == PINNED_TAG, "Evidence tag differs from verifier pin")
        head = git_read("rev-parse", "--verify", "HEAD").decode().strip()
        require(head == PINNED_COMMIT, f"Checkout HEAD is {head}; expected {PINNED_COMMIT}")
        status = git_read("status", "--porcelain=v1", "--untracked-files=normal").decode().strip()
        require(not status, "Codex checkout has tracked or untracked changes")
        lock_bytes = (metaengine_repo / LOCK_PATH).read_bytes()
        lock_hash = hashlib.sha256(lock_bytes).hexdigest()
        require(lock_hash == evidence["metaengine_lock_sha256"], "METAENGINE lock SHA-256 differs from recorded snapshot")
        lock = json.loads(lock_bytes)
        components = [item for item in lock["components"] if item.get("id") == "codex"]
        require(len(components) == 1, "METAENGINE lock must contain exactly one Codex component")
        codex = components[0]
        require(codex["version"] == "0.166.0", "METAENGINE Codex version differs")
        require(codex["tag"] == PINNED_TAG, "METAENGINE Codex tag differs")
        require(codex["repository"] == "openai/codex", "METAENGINE Codex repository differs")
        context["evidence"] = evidence
        return {"head": head, "clean": True, "lock_sha256": lock_hash, "tag": PINNED_TAG}

    def check_nullable():
        schema = json.loads(read_source(SCHEMA_PATH))
        require(schema["properties"]["accountId"]["type"] == ["string", "null"], "accountId JSON type differs")
        return {"accountId_types": schema["properties"]["accountId"]["type"]}

    def check_required():
        schema = json.loads(read_source(SCHEMA_PATH))
        require("accountId" not in schema["required"], "JSON accountId unexpectedly required")
        require(schema["required"] == ["rateLimits"], "JSON required fields differ")
        return {"required": schema["required"]}

    def check_typescript():
        require("accountId: string | null" in read_source(TS_PATH), "TypeScript nullable ID declaration missing")
        return {"declaration": "accountId: string | null"}

    def rust_struct(name):
        match = re.search(r"pub struct " + re.escape(name) + r"\s*\{(.*?)\n\}", read_source(RUST_PATH), re.S)
        require(match is not None, f"Rust struct {name} missing")
        return match.group(1)

    def check_rust_id():
        require("pub account_id: Option<String>" in rust_struct("GetAccountRateLimitsResponse"), "Rust optional usage ID missing")
        return {"declaration": "GetAccountRateLimitsResponse.account_id: Option<String>"}

    def check_workspace_routing():
        response = rust_struct("GetAccountResponse")
        require('#[experimental("account/read.workspaceRouting")]' in response, "Experimental routing marker missing")
        require("pub workspace_routing: Option<WorkspaceRouting>" in response, "Optional workspace routing missing")
        require("pub chatgpt_account_id: String" in rust_struct("WorkspaceRouting"), "Workspace routing account ID missing")
        return {"field": "account/read.workspaceRouting", "identity": "chatgptAccountId"}

    def check_hashes():
        evidence = context.get("evidence")
        if evidence is None:
            evidence = json.loads(args.evidence.read_text(encoding="utf-8"))
        sources = evidence["source_files"]
        require(len(sources) == EXPECTED_SOURCE_COUNT, "Recorded source file count differs from 21")
        checked = []
        for path, recorded in sorted(sources.items()):
            relative = Path(path)
            require(not relative.is_absolute() and ".." not in relative.parts, "Invalid source manifest path")
            content = (codex_repo / relative).read_bytes()
            actual = hashlib.sha256(content).hexdigest()
            require(actual == recorded["sha256"], f"Source SHA-256 mismatch: {path}")
            require(len(content) == recorded["bytes"], f"Source byte count mismatch: {path}")
            committed = git_read("cat-file", "blob", f"{PINNED_COMMIT}:{path}")
            require(content == committed, f"Source differs from pinned Git blob: {path}")
            checked.append({"path": path, "sha256": actual, "bytes": len(content)})
        return {"source_file_count": len(checked), "matches_pinned_git_blobs": True, "files": checked}

    run_check("Pinned source HEAD and clean checkout; METAENGINE lock pin and SHA-256 match", check_pin)
    run_check("JSON accountId permits string/null", check_nullable)
    run_check("JSON accountId is not required; only rateLimits required", check_required)
    run_check("TypeScript declares accountId: string | null", check_typescript)
    run_check("Rust response uses account_id: Option<String>", check_rust_id)
    run_check("Experimental account/read.workspaceRouting exists in Rust", check_workspace_routing)
    run_check("All 21 recorded full-source hashes and pinned Git blobs match", check_hashes)

    passed = all(item["passed"] for item in details)
    result = {
        "passed": passed,
        "recorded_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "verifier": str(Path(__file__).resolve()),
        "verifier_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "codex_repo": str(codex_repo),
        "metaengine_repo": str(metaengine_repo),
        "pinned_commit": PINNED_COMMIT,
        "pinned_tag": PINNED_TAG,
        "check_count": len(checks),
        "passed_count": sum(item["passed"] for item in details),
        "source_file_count": EXPECTED_SOURCE_COUNT,
        "checks": checks,
        "check_details": details,
        "validation_kind": "Read-only protocol/source assertions, not compiled or runtime integration tests",
        "compiled_tests_run": False,
        "live_authenticated_calls_run": False,
        "model_calls_run": False,
        "network_calls_run": False,
        "remaining_blockers": [item["error"] for item in details if not item["passed"]],
    }
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "passed": passed,
        "passed_count": result["passed_count"],
        "check_count": result["check_count"],
        "source_file_count": EXPECTED_SOURCE_COUNT,
        "output": str(args.output.resolve()),
    }, indent=2))
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
