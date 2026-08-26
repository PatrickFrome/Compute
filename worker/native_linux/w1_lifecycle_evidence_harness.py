#!/usr/bin/env python3
"""W1 provider-neutral lifecycle evidence harness (PREP / non-authority).

The harness deliberately separates local evidence capture from provider mutation.
It NEVER starts, stops, or reboots a provider and NEVER admits a worker. Its two jobs:

1. ``capture`` records fixed Linux/kernel facts plus a persistent sentinel hash.
2. ``compose-codespaces`` combines PRE/POST captures, raw GitHub Codespaces
   snapshots, an externally recorded lifecycle action window, and post-resume
   H1-H13 prerequisite evidence through the existing fail-closed W1 oracles.

Every output remains non-authority until authenticated provider provenance,
live S2/outer-cgroup canaries, persisted Supabase readback, and supervisor
verification are completed under a fresh aligned W1 claim/directive.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import secrets
import sys
from datetime import datetime, timezone
from typing import Any

from controller.w1 import github_codespaces_snapshot_guard
from controller.w1 import provider_neutral_lifecycle_guard
from worker.native_linux import h1_h13_prereq_probe

CAPTURE_SCHEMA = "metaengine.compute.w1-lifecycle-local-capture.h205f22.v1"
ACTION_SCHEMA = "metaengine.compute.w1-lifecycle-action-window.h205f22.v1"
COMPOSE_SCHEMA = "metaengine.compute.w1-lifecycle-evidence-harness.h205f22.v1"
SENTINEL_BYTES = 32
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
BOOT_RE = provider_neutral_lifecycle_guard.BOOT_RE

CAPTURE_KEYS = {
    "schema", "phase", "captured_at", "source", "linux", "uname",
    "boot_id", "machine_id_sha256", "sentinel_sha256", "namespace_inodes",
    "cgroup_path", "nonclaims",
}
SOURCE_KEYS = {"git_sha", "tree_sha"}
NONCLAIM_KEYS = {"canonical", "authority_effect", "worker_admitted", "w1_verified"}
ACTION_KEYS = {"schema", "provider_kind", "action_kind", "requested_at", "completed_at", "nonclaims"}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        while True:
            chunk = fh.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def _exact_object(value: Any, keys: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    diff = set(value) ^ keys
    if diff:
        raise ValueError(f"{label} keys mismatch: {sorted(diff)}")
    return value


def _nonclaims(value: Any, label: str = "nonclaims") -> dict[str, bool]:
    obj = _exact_object(value, NONCLAIM_KEYS, label)
    for key in NONCLAIM_KEYS:
        if obj[key] is not False:
            raise ValueError(f"{label}.{key} must be false")
    return {key: False for key in sorted(NONCLAIM_KEYS)}


def _source(value: Any) -> dict[str, str]:
    obj = _exact_object(value, SOURCE_KEYS, "source")
    out: dict[str, str] = {}
    for key in SOURCE_KEYS:
        raw = obj[key]
        if not isinstance(raw, str) or not SHA40_RE.fullmatch(raw):
            raise ValueError(f"invalid source.{key}")
        out[key] = raw
    return out


def _parse_timestamp(value: Any, label: str) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise ValueError(f"{label} must be canonical UTC ending Z")
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as exc:
        raise ValueError(f"invalid {label}") from exc
    return parsed.astimezone(timezone.utc)


def _read_required(path: Path, label: str) -> str:
    try:
        value = path.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise RuntimeError(f"unable to read {label}: {exc}") from exc
    if not value:
        raise RuntimeError(f"empty {label}")
    return value


def _current_cgroup_path() -> str:
    try:
        for line in Path("/proc/self/cgroup").read_text(encoding="utf-8").splitlines():
            if line.startswith("0::"):
                return line[3:] or "/"
    except OSError:
        pass
    return "UNAVAILABLE"


def _namespace_inodes() -> dict[str, int]:
    result: dict[str, int] = {}
    for key in ("mnt", "pid", "net", "user"):
        try:
            result[key] = Path(f"/proc/self/ns/{key}").stat().st_ino
        except OSError:
            result[key] = 0
    return result


def ensure_persistent_sentinel(path: Path, *, initialize: bool) -> str:
    raw_path = Path(path)
    try:
        if raw_path.is_symlink():
            raise RuntimeError("persistent sentinel must be an existing regular non-symlink file")
    except OSError as exc:
        raise RuntimeError(f"unable to inspect persistent sentinel: {exc}") from exc

    if initialize:
        raw_path.parent.mkdir(parents=True, exist_ok=True)
        if not raw_path.exists():
            fd = os.open(raw_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
            try:
                os.write(fd, secrets.token_bytes(SENTINEL_BYTES))
                os.fsync(fd)
            finally:
                os.close(fd)

    try:
        if raw_path.is_symlink() or not raw_path.is_file():
            raise RuntimeError("persistent sentinel must be an existing regular non-symlink file")
        resolved = raw_path.resolve(strict=True)
    except OSError as exc:
        raise RuntimeError(f"unable to resolve persistent sentinel: {exc}") from exc

    if resolved != raw_path.absolute():
        raise RuntimeError("persistent sentinel path must not traverse symlinks")
    if resolved.stat().st_size < SENTINEL_BYTES:
        raise RuntimeError("persistent sentinel is unexpectedly short")
    return _sha256_file(resolved)


def capture_local(*, phase: str, source: dict[str, str], sentinel: Path, initialize_sentinel: bool) -> dict[str, Any]:
    if phase not in {"PRE", "POST"}:
        raise ValueError("phase must be PRE or POST")
    if initialize_sentinel and phase != "PRE":
        raise ValueError("sentinel initialization is PRE-only")
    if not sys.platform.startswith("linux"):
        raise RuntimeError("Linux capture required")
    boot_id = _read_required(Path("/proc/sys/kernel/random/boot_id"), "boot_id")
    if not BOOT_RE.fullmatch(boot_id):
        raise RuntimeError("kernel boot_id is not canonical UUID")
    machine_id = _read_required(Path("/etc/machine-id"), "machine-id")
    sentinel_sha = ensure_persistent_sentinel(sentinel, initialize=initialize_sentinel)
    uname = platform.uname()
    result = {
        "schema": CAPTURE_SCHEMA,
        "phase": phase,
        "captured_at": _utc_now(),
        "source": _source(source),
        "linux": True,
        "uname": {
            "system": uname.system,
            "node": uname.node,
            "release": uname.release,
            "version": uname.version,
            "machine": uname.machine,
        },
        "boot_id": boot_id,
        "machine_id_sha256": _sha256_bytes(machine_id.encode("utf-8")),
        "sentinel_sha256": sentinel_sha,
        "namespace_inodes": _namespace_inodes(),
        "cgroup_path": _current_cgroup_path(),
        "nonclaims": {key: False for key in sorted(NONCLAIM_KEYS)},
    }
    validate_capture(result, expected_phase=phase)
    return result


def validate_capture(value: Any, *, expected_phase: str) -> dict[str, Any]:
    obj = _exact_object(value, CAPTURE_KEYS, f"{expected_phase.lower()} capture")
    if obj["schema"] != CAPTURE_SCHEMA or obj["phase"] != expected_phase:
        raise ValueError(f"invalid {expected_phase} capture schema/phase")
    _parse_timestamp(obj["captured_at"], f"{expected_phase} captured_at")
    _source(obj["source"])
    _nonclaims(obj["nonclaims"], f"{expected_phase}.nonclaims")
    if obj["linux"] is not True:
        raise ValueError(f"{expected_phase} must be Linux")
    if not isinstance(obj["uname"], dict) or obj["uname"].get("system") != "Linux":
        raise ValueError(f"{expected_phase} uname must report Linux")
    if not isinstance(obj["boot_id"], str) or not BOOT_RE.fullmatch(obj["boot_id"]):
        raise ValueError(f"invalid {expected_phase} boot_id")
    for key in ("machine_id_sha256", "sentinel_sha256"):
        if not isinstance(obj[key], str) or not SHA256_RE.fullmatch(obj[key]):
            raise ValueError(f"invalid {expected_phase} {key}")
    ns = obj["namespace_inodes"]
    if not isinstance(ns, dict) or set(ns) != {"mnt", "pid", "net", "user"}:
        raise ValueError(f"invalid {expected_phase} namespace_inodes")
    if any(not isinstance(v, int) or isinstance(v, bool) or v < 0 for v in ns.values()):
        raise ValueError(f"invalid {expected_phase} namespace inode")
    if not isinstance(obj["cgroup_path"], str) or not obj["cgroup_path"]:
        raise ValueError(f"invalid {expected_phase} cgroup_path")
    return obj


def validate_action(value: Any) -> dict[str, Any]:
    obj = _exact_object(value, ACTION_KEYS, "action")
    if obj["schema"] != ACTION_SCHEMA:
        raise ValueError("invalid action schema")
    if obj["provider_kind"] != "GITHUB_CODESPACES" or obj["action_kind"] != "STOP_RESUME":
        raise ValueError("only GitHub Codespaces STOP_RESUME is accepted by this composer")
    requested = _parse_timestamp(obj["requested_at"], "requested_at")
    completed = _parse_timestamp(obj["completed_at"], "completed_at")
    if requested > completed:
        raise ValueError("action chronology invalid")
    _nonclaims(obj["nonclaims"], "action.nonclaims")
    return obj


def validate_h1(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schema") != h1_h13_prereq_probe.SCHEMA:
        raise ValueError("invalid H1-H13 prerequisite result")
    for key in ("canonical", "authority_effect", "worker_admitted", "w1_verified"):
        if value.get(key) is not False:
            raise ValueError(f"H1-H13 {key} must be false")
    checks = value.get("checks")
    if not isinstance(checks, dict) or not checks or any(v is not True for v in checks.values()):
        raise ValueError("all H1-H13 prerequisite checks must pass")
    if value.get("ready_for_production_evidence") is not True:
        raise ValueError("H1-H13 prerequisite result is not ready")
    return value


def compose_codespaces(
    *,
    pre_local: dict[str, Any],
    post_local: dict[str, Any],
    pre_provider: dict[str, Any],
    stopped_provider: dict[str, Any],
    post_provider: dict[str, Any],
    action: dict[str, Any],
    h1_post: dict[str, Any],
) -> dict[str, Any]:
    pre = validate_capture(pre_local, expected_phase="PRE")
    post = validate_capture(post_local, expected_phase="POST")
    action_obj = validate_action(action)
    h1 = validate_h1(h1_post)
    if pre["source"] != post["source"]:
        raise ValueError("PRE/POST source identity changed")

    codespaces_input = {
        "schema": github_codespaces_snapshot_guard.INPUT_SCHEMA,
        "pre": pre_provider,
        "stopped": stopped_provider,
        "post": post_provider,
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
    codespaces = github_codespaces_snapshot_guard.evaluate(codespaces_input)
    if not codespaces["outcome"].startswith("CODESPACES_SNAPSHOTS_STRUCTURALLY_ELIGIBLE"):
        raise ValueError("Codespaces provider snapshot sequence rejected")

    provider_ev = codespaces["evidence"]
    provider_bundle_sha = github_codespaces_snapshot_guard.canonical_hash(codespaces_input)
    lifecycle_input = {
        "schema": provider_neutral_lifecycle_guard.INPUT_SCHEMA,
        "provider": {
            "provider_kind": "GITHUB_CODESPACES",
            "pre_object_id": str(provider_ev["provider_object_id"]),
            "post_object_id": str(provider_ev["provider_object_id"]),
            "pre_session_id": provider_ev["pre_session_fingerprint_sha256"],
            "post_session_id": provider_ev["post_session_fingerprint_sha256"],
            "action_kind": "STOP_RESUME",
            "requested_at": action_obj["requested_at"],
            "completed_at": action_obj["completed_at"],
            "provider_readback_sha256": provider_bundle_sha,
        },
        "pre": {
            "captured_at": pre["captured_at"],
            "os": "linux",
            "boot_id": pre["boot_id"],
            "sentinel_sha256": pre["sentinel_sha256"],
        },
        "post": {
            "captured_at": post["captured_at"],
            "os": "linux",
            "boot_id": post["boot_id"],
            "sentinel_sha256": post["sentinel_sha256"],
        },
        "nonclaims": {
            "canonical": False,
            "authority_effect": False,
            "persistent_worker_proof": False,
            "worker_admitted": False,
            "w1_verified": False,
        },
    }
    lifecycle = provider_neutral_lifecycle_guard.evaluate(lifecycle_input)
    if not lifecycle["outcome"].startswith("LIFECYCLE_EVIDENCE_STRUCTURALLY_ELIGIBLE"):
        raise ValueError("provider-neutral lifecycle evidence rejected")

    local_checks = {
        "source_identity_stable": pre["source"] == post["source"],
        "machine_identity_stable": pre["machine_id_sha256"] == post["machine_id_sha256"],
        "kernel_boot_id_changed": pre["boot_id"] != post["boot_id"],
        "persistent_sentinel_stable": pre["sentinel_sha256"] == post["sentinel_sha256"],
        "post_h1_h13_prerequisites_pass": h1["ready_for_production_evidence"] is True,
    }
    failures = sorted(key for key, passed in local_checks.items() if not passed)
    if failures:
        raise ValueError(f"local lifecycle checks failed: {failures}")

    evidence = {
        "source": pre["source"],
        "provider": codespaces,
        "lifecycle": lifecycle,
        "local_checks": local_checks,
        "post_h1_h13": h1,
    }
    evidence_sha = provider_neutral_lifecycle_guard.canonical_hash(evidence)
    return {
        "schema": COMPOSE_SCHEMA,
        "outcome": "W1_LIFECYCLE_EVIDENCE_COMPOSED_NONAUTHORITY",
        "evidence": evidence,
        "evidence_sha256": evidence_sha,
        "provider_identity_verified": False,
        "provider_action_verified": False,
        "s2_runtime_verified": False,
        "outer_cgroup_witness_verified": False,
        "persisted_readback_verified": False,
        "persistent_worker_proof": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
        "next_required": [
            "authenticated_provider_provenance",
            "live_s2_runtime_canaries",
            "prebound_outer_cgroup_witness",
            "persisted_supabase_readback",
            "supervisor_verification",
        ],
    }


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _dump(value: Any, path: Path | None) -> None:
    text = json.dumps(value, sort_keys=True, indent=2) + "\n"
    if path is None:
        sys.stdout.write(text)
    else:
        path.write_text(text, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    cap = sub.add_parser("capture")
    cap.add_argument("--phase", choices=("PRE", "POST"), required=True)
    cap.add_argument("--git-sha", required=True)
    cap.add_argument("--tree-sha", required=True)
    cap.add_argument("--sentinel", type=Path, required=True)
    cap.add_argument("--initialize-sentinel", action="store_true")
    cap.add_argument("--output", type=Path)

    comp = sub.add_parser("compose-codespaces")
    for name in ("pre-local", "post-local", "pre-provider", "stopped-provider", "post-provider", "action", "h1-post"):
        comp.add_argument(f"--{name}", type=Path, required=True)
    comp.add_argument("--output", type=Path)
    ns = parser.parse_args()

    if ns.command == "capture":
        result = capture_local(
            phase=ns.phase,
            source={"git_sha": ns.git_sha, "tree_sha": ns.tree_sha},
            sentinel=ns.sentinel,
            initialize_sentinel=ns.initialize_sentinel,
        )
        _dump(result, ns.output)
        return 0

    result = compose_codespaces(
        pre_local=_load(ns.pre_local),
        post_local=_load(ns.post_local),
        pre_provider=_load(ns.pre_provider),
        stopped_provider=_load(ns.stopped_provider),
        post_provider=_load(ns.post_provider),
        action=_load(ns.action),
        h1_post=_load(ns.h1_post),
    )
    _dump(result, ns.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
