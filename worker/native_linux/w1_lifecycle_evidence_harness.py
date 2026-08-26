#!/usr/bin/env python3
"""W1 provider-neutral lifecycle evidence harness (PREP / non-authority).

The harness deliberately separates local evidence capture from provider mutation.
It NEVER starts, stops, or reboots a provider and NEVER admits a worker. Its two jobs:

1. ``capture`` records fixed Linux/kernel facts plus a persistent sentinel hash.
2. ``compose-codespaces`` combines PRE/POST captures, raw GitHub Codespaces
   snapshots, an externally recorded lifecycle action window, a structurally
   valid S2 runtime PASS receipt, and post-resume H1-H13 prerequisite evidence.

Every output remains non-authority until authenticated provider/S2 provenance,
outer-cgroup evidence, persisted Supabase readback, and supervisor verification
are completed under a fresh aligned W1 claim/directive.
"""
from __future__ import annotations

import argparse
import ctypes
import errno
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import secrets
import stat
import sys
from datetime import datetime, timezone
from typing import Any

from controller.w1 import github_codespaces_snapshot_guard
from controller.w1 import provider_neutral_lifecycle_guard
from controller.w1 import s2_runtime_canary_receipt
from worker.native_linux import h1_h13_prereq_probe

CAPTURE_SCHEMA = "metaengine.compute.w1-lifecycle-local-capture.h205f22.v1"
ACTION_SCHEMA = "metaengine.compute.w1-lifecycle-action-window.h205f22.v1"
COMPOSE_SCHEMA = "metaengine.compute.w1-lifecycle-evidence-harness.h205f22.v1"
EXPECTED_S2_SOURCE_SHA256 = "f262cd5468b5eb51754cf397cdb1879c2e90d0670b74f479d3b28af8cd20f521"
SENTINEL_BYTES = 32
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
BOOT_RE = provider_neutral_lifecycle_guard.BOOT_RE

_OPENAT2_NR = {
    "x86_64": 437,
    "amd64": 437,
    "aarch64": 437,
    "arm64": 437,
    "riscv64": 437,
}
_RESOLVE_NO_MAGICLINKS = 0x02
_RESOLVE_NO_SYMLINKS = 0x04
_RESOLVE_BENEATH = 0x08
_SENTINEL_RESOLVE = _RESOLVE_BENEATH | _RESOLVE_NO_MAGICLINKS | _RESOLVE_NO_SYMLINKS


class _OpenHow(ctypes.Structure):
    _fields_ = [
        ("flags", ctypes.c_uint64),
        ("mode", ctypes.c_uint64),
        ("resolve", ctypes.c_uint64),
    ]


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


def _hash_fd(fd: int) -> str:
    os.lseek(fd, 0, os.SEEK_SET)
    h = hashlib.sha256()
    while True:
        chunk = os.read(fd, 1024 * 1024)
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


def _openat2(dirfd: int, path: str, *, flags: int, mode: int = 0, resolve: int = _SENTINEL_RESOLVE) -> int:
    nr = _OPENAT2_NR.get(os.uname().machine.lower())
    if nr is None:
        raise RuntimeError(f"openat2 unsupported architecture: {os.uname().machine}")
    libc = ctypes.CDLL(None, use_errno=True)
    how = _OpenHow(flags=flags, mode=mode, resolve=resolve)
    fd = libc.syscall(
        ctypes.c_long(nr),
        ctypes.c_int(dirfd),
        ctypes.c_char_p(path.encode("utf-8")),
        ctypes.byref(how),
        ctypes.sizeof(how),
    )
    if fd < 0:
        err = ctypes.get_errno()
        raise OSError(err, os.strerror(err), path)
    return int(fd)


def _sentinel_relative_parts(path: Path) -> tuple[str, str]:
    raw = Path(path)
    if not raw.is_absolute():
        raise RuntimeError("persistent sentinel path must be absolute")
    if ".." in raw.parts:
        raise RuntimeError("persistent sentinel path may not contain '..'")
    if raw == Path("/") or not raw.name:
        raise RuntimeError("persistent sentinel path must name a file below /")
    parent_rel = str(raw.parent).lstrip("/") or "."
    return parent_rel, raw.name


def _validate_sentinel_fd(fd: int) -> os.stat_result:
    st = os.fstat(fd)
    if not stat.S_ISREG(st.st_mode):
        raise RuntimeError("persistent sentinel must be a regular file")
    if st.st_uid != os.geteuid():
        raise RuntimeError("persistent sentinel must be owned by the current user")
    if st.st_nlink != 1:
        raise RuntimeError("persistent sentinel must have exactly one hard link")
    if st.st_mode & 0o022:
        raise RuntimeError("persistent sentinel must not be group/world writable")
    if st.st_size < SENTINEL_BYTES:
        raise RuntimeError("persistent sentinel is unexpectedly short")
    return st


def ensure_persistent_sentinel(path: Path, *, initialize: bool) -> str:
    """Open/create the sentinel without pathname fallback or symlink traversal.

    The durable parent directory must already exist. Both the parent walk and the
    final component are resolved by openat2 with BENEATH + NO_SYMLINKS +
    NO_MAGICLINKS. Creation is exclusive; a concurrent creator is rejected.
    Hashing is performed from the already-validated file descriptor.
    """
    if not sys.platform.startswith("linux"):
        raise RuntimeError("Linux openat2 sentinel capture required")
    parent_rel, name = _sentinel_relative_parts(Path(path))
    root_fd = -1
    parent_fd = -1
    sentinel_fd = -1
    created = False
    try:
        root_fd = os.open("/", os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_CLOEXEC", 0))
        try:
            parent_fd = _openat2(
                root_fd,
                parent_rel,
                flags=os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_CLOEXEC", 0),
            )
        except OSError as exc:
            raise RuntimeError(f"unable to open sentinel parent safely: {exc}") from exc

        try:
            sentinel_fd = _openat2(
                parent_fd,
                name,
                flags=os.O_RDONLY | getattr(os, "O_CLOEXEC", 0),
            )
        except OSError as exc:
            if exc.errno != errno.ENOENT or not initialize:
                raise RuntimeError(f"unable to open persistent sentinel safely: {exc}") from exc
            try:
                sentinel_fd = _openat2(
                    parent_fd,
                    name,
                    flags=(
                        os.O_RDWR
                        | os.O_CREAT
                        | os.O_EXCL
                        | getattr(os, "O_CLOEXEC", 0)
                    ),
                    mode=0o600,
                )
            except OSError as create_exc:
                if create_exc.errno == errno.EEXIST:
                    raise RuntimeError("persistent sentinel creation raced with another creator") from create_exc
                raise RuntimeError(f"unable to create persistent sentinel safely: {create_exc}") from create_exc
            os.write(sentinel_fd, secrets.token_bytes(SENTINEL_BYTES))
            os.fsync(sentinel_fd)
            os.fsync(parent_fd)
            created = True

        _validate_sentinel_fd(sentinel_fd)
        if created:
            os.lseek(sentinel_fd, 0, os.SEEK_SET)
        return _hash_fd(sentinel_fd)
    finally:
        for fd in (sentinel_fd, parent_fd, root_fd):
            if fd >= 0:
                os.close(fd)


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
    s2_runtime: dict[str, Any],
) -> dict[str, Any]:
    pre = validate_capture(pre_local, expected_phase="PRE")
    post = validate_capture(post_local, expected_phase="POST")
    action_obj = validate_action(action)
    h1 = validate_h1(h1_post)
    s2 = s2_runtime_canary_receipt.validate(
        s2_runtime,
        require_pass=True,
        expected_source_sha256=EXPECTED_S2_SOURCE_SHA256,
    )
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
        "s2_runtime_receipt_pass": s2["status"] == "PASS_NONAUTHORITY",
        "post_h1_h13_prerequisites_pass": h1["ready_for_production_evidence"] is True,
    }
    failures = sorted(key for key, passed in local_checks.items() if not passed)
    if failures:
        raise ValueError(f"local lifecycle checks failed: {failures}")

    evidence = {
        "source": pre["source"],
        "s2_runtime": s2,
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
            "authenticated_s2_runtime_receipt_provenance",
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
    for name in ("pre-local", "post-local", "pre-provider", "stopped-provider", "post-provider", "action", "h1-post", "s2-runtime"):
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
        s2_runtime=_load(ns.s2_runtime),
    )
    _dump(result, ns.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
