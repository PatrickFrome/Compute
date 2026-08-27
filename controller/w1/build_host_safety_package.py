#!/usr/bin/env python3
"""Build a deterministic, backend-neutral W1 host-safety runtime package.

This is a supply-chain/build tool only. It has no AWS, database, reboot,
admission, or runtime mutation authority. Source paths and the source revision
are fixed in reviewed code; callers may select only an output directory.

The ZIP is compatible with the file layout expected by AWS Systems Manager
Distributor Advanced packages (Linux install.sh/uninstall.sh at archive root),
but using Distributor is an independent provisioning-plane decision.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import zipfile
from typing import Any


SCHEMA = "metaengine.compute.w1-host-safety-deterministic-package.h205f22.v1"
SOURCE_COMMIT = "73ab09c75b71a6ea40f11e953cbcf9d9b94b9a89"
SOURCE_TREE = "c8ae850c8ce2ab9f688ae0525cbce55d39186d78"
PACKAGE_ID = "w1-safety-envelope-73ab09c7"
PACKAGE_VERSION = "73ab09c7.1"
PACKAGE_FILENAME = f"{PACKAGE_ID}-{PACKAGE_VERSION}-linux-any.zip"
INSTALL_ROOT = f"/opt/metaengine/w1/safety/{SOURCE_COMMIT}"
EXECUTION_USER = "metaengine-w1"
WORKSPACE_ROOT = "/var/lib/metaengine/w1/workspace"
STATIC_MANIFEST_REL = "infra/w1/package/W1_SAFETY_ENVELOPE_73AB09C7_MANIFEST.json"
STATIC_MANIFEST_SHA256 = "71f509fb4f8dd18117f48c8444698ef7127ded4a32beb73de548d3cfa67ee01a"

SOURCE_FILES = {
    "worker/native_linux/host_safety_envelope_probe.py": "778c10804a7e8d8400a8c830f336dc53d1f8b790",
    "controller/w1/host_safety_envelope_validator.py": "c35f1f5cf999badca23f04cd14938a8b885df382",
    "controller/w1/host_safety_evidence_bundle.py": "bb66341c96c75eb7ece18432ead122f8da53df55",
}
ROOT = Path(__file__).resolve().parents[2]
ZIP_EPOCH = (2020, 1, 1, 0, 0, 0)


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def git_blob_sha1(value: bytes) -> str:
    header = b"blob " + str(len(value)).encode("ascii") + b"\0"
    return hashlib.sha1(header + value).hexdigest()


def _load_locked_sources() -> tuple[dict[str, bytes], bytes]:
    sources: dict[str, bytes] = {}
    for rel, expected_git_blob in SOURCE_FILES.items():
        path = ROOT / rel
        if not path.is_file():
            raise RuntimeError(f"source_missing:{rel}")
        raw = path.read_bytes()
        if git_blob_sha1(raw) != expected_git_blob:
            raise RuntimeError(f"source_git_blob_mismatch:{rel}")
        sources[rel] = raw

    manifest_path = ROOT / STATIC_MANIFEST_REL
    if not manifest_path.is_file():
        raise RuntimeError("static_manifest_missing")
    manifest_raw = manifest_path.read_bytes()
    if sha256_bytes(manifest_raw) != STATIC_MANIFEST_SHA256:
        raise RuntimeError("static_manifest_sha256_mismatch")
    manifest = json.loads(manifest_raw)
    if manifest.get("source_commit_sha") != SOURCE_COMMIT or manifest.get("source_tree_sha") != SOURCE_TREE:
        raise RuntimeError("static_manifest_source_identity_mismatch")
    if manifest.get("package_root") != INSTALL_ROOT:
        raise RuntimeError("static_manifest_install_root_mismatch")
    if manifest.get("execution_user") != EXECUTION_USER or manifest.get("workspace_root") != WORKSPACE_ROOT:
        raise RuntimeError("static_manifest_execution_identity_mismatch")
    return sources, manifest_raw


def _payload_lock(sources: dict[str, bytes], manifest_raw: bytes) -> dict[str, Any]:
    files = []
    for rel in sorted(sources):
        raw = sources[rel]
        files.append({
            "path": rel,
            "bytes": len(raw),
            "sha256": sha256_bytes(raw),
            "git_blob_sha1": SOURCE_FILES[rel],
            "install_mode": "0444",
            "install_uid": 0,
            "install_gid": 0,
        })
    neutral = {
        "schema": "metaengine.compute.w1-host-safety-package-lock.h205f22.v1",
        "package_id": PACKAGE_ID,
        "package_version": PACKAGE_VERSION,
        "source_commit_sha": SOURCE_COMMIT,
        "source_tree_sha": SOURCE_TREE,
        "install_root": INSTALL_ROOT,
        "execution_user": EXECUTION_USER,
        "workspace_root": WORKSPACE_ROOT,
        "static_manifest_sha256": sha256_bytes(manifest_raw),
        "files": files,
        "authority": {
            "canonical": False,
            "authority_effect": False,
            "provider_mutation": False,
            "database_mutation": False,
            "reboot_authorized": False,
            "worker_admitted": False,
            "w1_verified": False,
        },
    }
    return {**neutral, "lock_sha256": sha256_bytes(canonical_bytes(neutral))}


def _installer(lock: dict[str, Any]) -> bytes:
    lock_json = json.dumps(lock, sort_keys=True, separators=(",", ":"))
    script = f'''#!/bin/sh
set -eu
umask 077
INSTALL_ROOT='{INSTALL_ROOT}'
EXEC_USER='{EXECUTION_USER}'
WORKSPACE='{WORKSPACE_ROOT}'
LOCK_SHA256='{lock["lock_sha256"]}'

if [ "$(id -u)" -ne 0 ]; then
  echo 'W1_INSTALL_REJECTED:root_required' >&2
  exit 70
fi
command -v python3 >/dev/null 2>&1
command -v install >/dev/null 2>&1
command -v useradd >/dev/null 2>&1 || true

python3 - "$PWD" "$LOCK_SHA256" <<'PY'
import hashlib,json,os,stat,sys
from pathlib import Path,PurePosixPath
EXPECTED=json.loads({lock_json!r})
root=Path(sys.argv[1])
expected_lock=sys.argv[2]
neutral={{k:v for k,v in EXPECTED.items() if k!='lock_sha256'}}
raw=json.dumps(neutral,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
if hashlib.sha256(raw).hexdigest()!=expected_lock or EXPECTED.get('lock_sha256')!=expected_lock:
    raise RuntimeError('package_lock_integrity_invalid')
for item in EXPECTED['files']:
    rel=item['path']
    p=PurePosixPath(rel)
    if p.is_absolute() or '..' in p.parts:
        raise RuntimeError('package_path_forbidden')
    target=root.joinpath(*p.parts)
    st=target.lstat()
    if not stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode):
        raise RuntimeError('package_payload_not_regular_file')
    data=target.read_bytes()
    if len(data)!=item['bytes'] or hashlib.sha256(data).hexdigest()!=item['sha256']:
        raise RuntimeError('package_payload_sha256_mismatch')
    git_blob=hashlib.sha1(b'blob '+str(len(data)).encode('ascii')+b'\\0'+data).hexdigest()
    if git_blob!=item['git_blob_sha1']:
        raise RuntimeError('package_payload_git_blob_mismatch')
manifest=(root/'manifest.json').read_bytes()
if hashlib.sha256(manifest).hexdigest()!=EXPECTED['static_manifest_sha256']:
    raise RuntimeError('package_manifest_sha256_mismatch')
PY

if ! id -u "$EXEC_USER" >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/metaengine/w1 --shell /usr/sbin/nologin "$EXEC_USER"
fi
if [ "$(id -u "$EXEC_USER")" -eq 0 ]; then
  echo 'W1_INSTALL_REJECTED:execution_user_root' >&2
  exit 71
fi

install -d -o root -g root -m 0555 "$INSTALL_ROOT"
install -d -o root -g root -m 0555 "$INSTALL_ROOT/controller" "$INSTALL_ROOT/controller/w1" "$INSTALL_ROOT/worker" "$INSTALL_ROOT/worker/native_linux"
install -o root -g root -m 0444 manifest.json "$INSTALL_ROOT/manifest.json"
install -o root -g root -m 0444 package-lock.json "$INSTALL_ROOT/package-lock.json"
install -o root -g root -m 0444 controller/w1/host_safety_evidence_bundle.py "$INSTALL_ROOT/controller/w1/host_safety_evidence_bundle.py"
install -o root -g root -m 0444 controller/w1/host_safety_envelope_validator.py "$INSTALL_ROOT/controller/w1/host_safety_envelope_validator.py"
install -o root -g root -m 0444 worker/native_linux/host_safety_envelope_probe.py "$INSTALL_ROOT/worker/native_linux/host_safety_envelope_probe.py"
install -d -o "$EXEC_USER" -g "$EXEC_USER" -m 0700 "$WORKSPACE"

python3 - "$INSTALL_ROOT" <<'PY'
import json,os,stat,sys
from pathlib import Path
root=Path(sys.argv[1])
lock=json.loads((root/'package-lock.json').read_text(encoding='utf-8'))
for item in lock['files']:
    p=root/item['path']
    st=p.lstat()
    if st.st_uid!=0 or st.st_gid!=0 or stat.S_IMODE(st.st_mode)!=0o444:
        raise RuntimeError('installed_payload_metadata_invalid')
workspace=Path('{WORKSPACE_ROOT}')
w=workspace.lstat()
if not stat.S_ISDIR(w.st_mode) or stat.S_ISLNK(w.st_mode) or (w.st_mode & (stat.S_IWGRP|stat.S_IWOTH)):
    raise RuntimeError('installed_workspace_metadata_invalid')
PY
'''
    return script.encode("utf-8")


def _uninstaller() -> bytes:
    return f'''#!/bin/sh
set -eu
if [ "$(id -u)" -ne 0 ]; then
  echo 'W1_UNINSTALL_REJECTED:root_required' >&2
  exit 70
fi
rm -rf -- '{INSTALL_ROOT}'
# Deliberately preserve {WORKSPACE_ROOT} and the dedicated account: removal of
# worker state/identity is a separate lifecycle operation, not package uninstall.
'''.encode("utf-8")


def _zip_entry(name: str, raw: bytes, mode: int) -> tuple[zipfile.ZipInfo, bytes]:
    info = zipfile.ZipInfo(filename=name, date_time=ZIP_EPOCH)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.create_system = 3
    info.external_attr = (stat.S_IFREG | mode) << 16
    info.flag_bits = 0
    return info, raw


def build(output_dir: Path) -> dict[str, Any]:
    sources, manifest_raw = _load_locked_sources()
    lock = _payload_lock(sources, manifest_raw)
    lock_raw = canonical_bytes(lock) + b"\n"
    install_raw = _installer(lock)
    uninstall_raw = _uninstaller()

    entries: dict[str, tuple[bytes, int]] = {
        "install.sh": (install_raw, 0o555),
        "uninstall.sh": (uninstall_raw, 0o555),
        "manifest.json": (manifest_raw, 0o444),
        "package-lock.json": (lock_raw, 0o444),
    }
    for rel, raw in sources.items():
        entries[rel] = (raw, 0o444)

    output_dir.mkdir(parents=True, exist_ok=True)
    archive = output_dir / PACKAGE_FILENAME
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9, strict_timestamps=True) as zf:
        for name in sorted(entries):
            raw, mode = entries[name]
            info, payload = _zip_entry(name, raw, mode)
            zf.writestr(info, payload, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)

    archive_raw = archive.read_bytes()
    package = {
        "schema": SCHEMA,
        "package_id": PACKAGE_ID,
        "package_version": PACKAGE_VERSION,
        "filename": PACKAGE_FILENAME,
        "bytes": len(archive_raw),
        "sha256": sha256_bytes(archive_raw),
        "source_commit_sha": SOURCE_COMMIT,
        "source_tree_sha": SOURCE_TREE,
        "static_manifest_sha256": STATIC_MANIFEST_SHA256,
        "payload_lock_sha256": lock["lock_sha256"],
        "entries": [
            {"path": name, "bytes": len(entries[name][0]), "sha256": sha256_bytes(entries[name][0]), "mode": f"{entries[name][1]:04o}"}
            for name in sorted(entries)
        ],
        "backend_neutral": True,
        "distributor_advanced_layout_compatible": True,
        "provisioning_authority": False,
        "runtime_authority": False,
        "canonical": False,
        "authority_effect": False,
    }
    receipt = output_dir / f"{PACKAGE_FILENAME}.receipt.json"
    receipt.write_bytes(canonical_bytes(package) + b"\n")
    return package


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default="dist/w1-host-safety", help="local build-output directory only")
    args = parser.parse_args()
    result = build(Path(args.output_dir))
    json.dump(result, fp=os.sys.stdout, sort_keys=True, indent=2)
    os.sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
