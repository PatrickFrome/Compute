#!/usr/bin/env python3
import hashlib
import json
import os
import time
import uuid
from pathlib import Path
from typing import Any

SCHEMA = "metaengine.compute.w1-persistence-witness.h205f22.v1"
DEFAULT_STATE_PATH = Path("/var/lib/metaengine-worker/persistence-witness.json")
DEFAULT_MACHINE_ID_PATH = Path("/etc/machine-id")
DEFAULT_BOOT_ID_PATH = Path("/proc/sys/kernel/random/boot_id")


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _read_identity(path: Path, label: str) -> str:
    try:
        value = path.read_text().strip()
    except OSError as exc:
        raise RuntimeError(f"{label}_unreadable") from exc
    if not value or len(value) > 4096:
        raise RuntimeError(f"{label}_invalid")
    return value


def _read_state(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    if path.is_symlink():
        raise RuntimeError("persistence_witness_symlink_forbidden")
    try:
        raw = path.read_text()
        state = json.loads(raw)
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError("persistence_witness_corrupt") from exc
    if not isinstance(state, dict):
        raise RuntimeError("persistence_witness_not_object")
    return state


def _atomic_write(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp")
    payload = json.dumps(state, sort_keys=True, separators=(",", ":")) + "\n"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC, 0o600)
    try:
        os.write(fd, payload.encode())
        os.fsync(fd)
    finally:
        os.close(fd)
    os.replace(tmp, path)
    os.chmod(path, 0o600)


def refresh_persistence_witness(
    *,
    state_path: Path = DEFAULT_STATE_PATH,
    machine_id_path: Path = DEFAULT_MACHINE_ID_PATH,
    boot_id_path: Path = DEFAULT_BOOT_ID_PATH,
    min_window_seconds: int = 600,
    now_unix_ns: int | None = None,
) -> dict[str, Any]:
    if min_window_seconds < 60 or min_window_seconds > 86400:
        raise RuntimeError("persistence_window_out_of_bounds")

    now_ns = time.time_ns() if now_unix_ns is None else int(now_unix_ns)
    if now_ns <= 0:
        raise RuntimeError("persistence_time_invalid")

    machine_id_sha256 = _sha256(_read_identity(machine_id_path, "machine_id"))
    boot_id_sha256 = _sha256(_read_identity(boot_id_path, "boot_id"))
    state = _read_state(state_path)

    if state is None:
        state = {
            "schema": SCHEMA,
            "witness_id": uuid.uuid4().hex,
            "machine_id_sha256": machine_id_sha256,
            "first_boot_id_sha256": boot_id_sha256,
            "first_observed_unix_ns": now_ns,
            "last_observed_unix_ns": now_ns,
            "observations": 1,
            "boot_ids_sha256": [boot_id_sha256],
        }
    else:
        if state.get("schema") != SCHEMA:
            raise RuntimeError("persistence_witness_schema_mismatch")
        witness_id = state.get("witness_id")
        try:
            if not isinstance(witness_id, str) or uuid.UUID(hex=witness_id).hex != witness_id:
                raise ValueError
        except ValueError as exc:
            raise RuntimeError("persistence_witness_id_invalid") from exc
        if state.get("machine_id_sha256") != machine_id_sha256:
            raise RuntimeError("persistence_witness_machine_mismatch")
        first_ns = state.get("first_observed_unix_ns")
        last_ns = state.get("last_observed_unix_ns")
        observations = state.get("observations")
        boots = state.get("boot_ids_sha256")
        if not isinstance(first_ns, int) or not isinstance(last_ns, int) or not isinstance(observations, int):
            raise RuntimeError("persistence_witness_timeline_invalid")
        if first_ns <= 0 or last_ns < first_ns or now_ns < last_ns or observations < 1:
            raise RuntimeError("persistence_witness_timeline_invalid")
        if not isinstance(boots, list) or not boots or any(not isinstance(x, str) or len(x) != 64 for x in boots):
            raise RuntimeError("persistence_witness_boot_history_invalid")
        state["last_observed_unix_ns"] = now_ns
        state["observations"] = observations + 1
        if boot_id_sha256 not in boots:
            state["boot_ids_sha256"] = (boots + [boot_id_sha256])[-8:]

    _atomic_write(state_path, state)

    age_seconds = max(0.0, (now_ns - int(state["first_observed_unix_ns"])) / 1_000_000_000)
    distinct_boots = len(set(state["boot_ids_sha256"]))
    local_window_satisfied = age_seconds >= min_window_seconds and int(state["observations"]) >= 3
    return {
        "schema": SCHEMA,
        "witness_id_sha256": _sha256(str(state["witness_id"])),
        "machine_id_sha256": machine_id_sha256,
        "first_boot_id_sha256": state["first_boot_id_sha256"],
        "boot_id_sha256": boot_id_sha256,
        "first_observed_unix_ns": state["first_observed_unix_ns"],
        "last_observed_unix_ns": state["last_observed_unix_ns"],
        "witness_age_seconds": round(age_seconds, 3),
        "observations": state["observations"],
        "distinct_boot_ids": distinct_boots,
        "reboot_observed": distinct_boots >= 2,
        "minimum_window_seconds": min_window_seconds,
        "local_persistence_window_satisfied": local_window_satisfied,
        "classification": "PERSISTENT_HOST_WINDOW_OBSERVED" if local_window_satisfied else "PERSISTENCE_WINDOW_PENDING",
        "authority_effect": False,
    }


if __name__ == "__main__":
    print(json.dumps(refresh_persistence_witness(), sort_keys=True, separators=(",", ":")))
