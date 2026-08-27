#!/usr/bin/env python3
"""Generate an immutable parameterless SSM document for W1 package provisioning.

The document embeds exactly one deterministic host-safety ZIP. It performs no
network fetch and accepts no runtime parameters. This generator is local and
non-authoritative; it neither calls AWS nor installs anything itself.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
from pathlib import Path
import tempfile
from typing import Any

from controller.w1 import build_host_safety_package as package_builder


SCHEMA = "metaengine.compute.w1-ssm-safety-provision-document-build.h205f22.v1"
DOCUMENT_NAME = "Metaengine-W1-Safety-Provision-H205F22"
DOCUMENT_VERSION_REQUIRED = "1"
MAX_SSM_DOCUMENT_BYTES = 64 * 1024


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _run_command(*, archive_b64: str, archive_sha256: str, archive_bytes: int, payload_lock_sha256: str) -> str:
    return f'''set -eu
umask 077
EXPECTED_ZIP_SHA256='{archive_sha256}'
EXPECTED_ZIP_BYTES='{archive_bytes}'
EXPECTED_PACKAGE_ID='{package_builder.PACKAGE_ID}'
EXPECTED_PACKAGE_VERSION='{package_builder.PACKAGE_VERSION}'
EXPECTED_SOURCE_COMMIT='{package_builder.SOURCE_COMMIT}'
EXPECTED_SOURCE_TREE='{package_builder.SOURCE_TREE}'
EXPECTED_PAYLOAD_LOCK_SHA256='{payload_lock_sha256}'
EXPECTED_INSTALL_ROOT='{package_builder.INSTALL_ROOT}'
TMPDIR_W1="$(mktemp -d /tmp/metaengine-w1-provision.XXXXXX)"
trap 'rm -rf "$TMPDIR_W1"' EXIT HUP INT TERM
python3 - "$TMPDIR_W1/package.zip" <<'PY'
import base64,hashlib,sys
raw=base64.b64decode({archive_b64!r},validate=True)
if len(raw)!={archive_bytes}:
    raise RuntimeError('embedded_package_size_mismatch')
if hashlib.sha256(raw).hexdigest()!={archive_sha256!r}:
    raise RuntimeError('embedded_package_sha256_mismatch')
with open(sys.argv[1],'wb') as h:
    h.write(raw)
PY
python3 - "$TMPDIR_W1/package.zip" "$TMPDIR_W1/package" <<'PY'
import os,stat,sys,zipfile
from pathlib import Path,PurePosixPath
archive=Path(sys.argv[1]); target=Path(sys.argv[2]); target.mkdir(mode=0o700)
expected={{
 'install.sh':0o555,
 'uninstall.sh':0o555,
 'manifest.json':0o444,
 'package-lock.json':0o444,
 'controller/w1/host_safety_evidence_bundle.py':0o444,
 'controller/w1/host_safety_envelope_validator.py':0o444,
 'worker/native_linux/host_safety_envelope_probe.py':0o444,
}}
with zipfile.ZipFile(archive) as zf:
    infos=zf.infolist()
    if [i.filename for i in infos]!=sorted(expected):
        raise RuntimeError('embedded_package_entry_set_invalid')
    for info in infos:
        p=PurePosixPath(info.filename)
        if p.is_absolute() or '..' in p.parts or info.filename not in expected:
            raise RuntimeError('embedded_package_path_forbidden')
        mode=(info.external_attr>>16)&0o7777
        if mode!=expected[info.filename]:
            raise RuntimeError('embedded_package_mode_mismatch')
        dest=target.joinpath(*p.parts)
        dest.parent.mkdir(parents=True,exist_ok=True)
        data=zf.read(info)
        fd=os.open(dest,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
        try:
            os.write(fd,data)
        finally:
            os.close(fd)
        os.chmod(dest,mode,follow_symlinks=False)
PY
cd "$TMPDIR_W1/package"
./install.sh
python3 - <<'PY'
import hashlib,json,os,stat
from pathlib import Path
root=Path({package_builder.INSTALL_ROOT!r})
if not root.is_dir() or root.is_symlink():
    raise RuntimeError('installed_root_invalid')
for rel in ('manifest.json','package-lock.json','controller/w1/host_safety_evidence_bundle.py','controller/w1/host_safety_envelope_validator.py','worker/native_linux/host_safety_envelope_probe.py'):
    p=root/rel; st=p.lstat()
    if not stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode) or st.st_uid!=0 or st.st_gid!=0 or stat.S_IMODE(st.st_mode)!=0o444:
        raise RuntimeError('installed_runtime_metadata_invalid')
lock=json.loads((root/'package-lock.json').read_text(encoding='utf-8'))
if lock.get('lock_sha256')!={payload_lock_sha256!r}:
    raise RuntimeError('installed_payload_lock_mismatch')
workspace=Path({package_builder.WORKSPACE_ROOT!r}); w=workspace.lstat()
if not stat.S_ISDIR(w.st_mode) or stat.S_ISLNK(w.st_mode) or w.st_mode&(stat.S_IWGRP|stat.S_IWOTH):
    raise RuntimeError('installed_workspace_invalid')
receipt={{
 'schema':'metaengine.compute.w1-aws-ssm-safety-provision-courier.h205f22.v1',
 'source':'HOST_UNTRUSTED_TRANSPORT',
 'transport':'AWS_SSM_RUN_COMMAND_FIXED_EMBEDDED_PACKAGE',
 'package_id':{package_builder.PACKAGE_ID!r},
 'package_version':{package_builder.PACKAGE_VERSION!r},
 'package_zip_sha256':{archive_sha256!r},
 'package_zip_bytes':{archive_bytes},
 'payload_lock_sha256':{payload_lock_sha256!r},
 'source_commit_sha':{package_builder.SOURCE_COMMIT!r},
 'source_tree_sha':{package_builder.SOURCE_TREE!r},
 'install_root':{package_builder.INSTALL_ROOT!r},
 'execution_user':{package_builder.EXECUTION_USER!r},
 'workspace_root':{package_builder.WORKSPACE_ROOT!r},
 'package_install_observed':True,
 'package_provisioning_verified':False,
 'host_safety_verified':False,
 'capture_executed':False,
 'provider_identity_verified':False,
 'reboot_completion_proven':False,
 'persistent_worker_proof':False,
 'w1_verified':False,
 'canonical':False,
 'authority_effect':False,
}}
print(json.dumps(receipt,sort_keys=True,separators=(',',':')))
PY'''


def build_document() -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="w1-ssm-provision-build-") as tmp:
        package = package_builder.build(Path(tmp))
        archive = Path(tmp) / package["filename"]
        raw = archive.read_bytes()
    if sha256_bytes(raw) != package["sha256"]:
        raise RuntimeError("package_receipt_sha256_mismatch")
    archive_b64 = base64.b64encode(raw).decode("ascii")
    command = _run_command(
        archive_b64=archive_b64,
        archive_sha256=package["sha256"],
        archive_bytes=package["bytes"],
        payload_lock_sha256=package["payload_lock_sha256"],
    )
    document = {
        "schemaVersion": "2.2",
        "description": "H205F22 W1 parameterless install of one embedded deterministic safety runtime package. Separate provisioning plane; no capture, reboot, persistence or canonical authority.",
        "parameters": {},
        "mainSteps": [
            {
                "action": "aws:runShellScript",
                "name": "installPinnedSafetyPackage",
                "inputs": {"timeoutSeconds": "90", "runCommand": [command]},
            }
        ],
    }
    document_raw = canonical_bytes(document)
    if len(document_raw) > MAX_SSM_DOCUMENT_BYTES:
        raise RuntimeError(f"ssm_document_size_limit_exceeded:{len(document_raw)}")
    neutral = {
        "schema": SCHEMA,
        "document_name": DOCUMENT_NAME,
        "required_document_version": DOCUMENT_VERSION_REQUIRED,
        "document_sha256": sha256_bytes(document_raw),
        "document_bytes": len(document_raw),
        "document": document,
        "package_filename": package["filename"],
        "package_sha256": package["sha256"],
        "package_bytes": package["bytes"],
        "payload_lock_sha256": package["payload_lock_sha256"],
        "source_commit_sha": package_builder.SOURCE_COMMIT,
        "source_tree_sha": package_builder.SOURCE_TREE,
        "parameterless": True,
        "network_fetch_allowed": False,
        "generic_package_document_allowed": False,
        "capture_authority": False,
        "reboot_authority": False,
        "admission_authority": False,
        "canonical": False,
        "authority_effect": False,
    }
    return {**neutral, "build_receipt_sha256": sha256_bytes(canonical_bytes(neutral))}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--document-out", help="optional local JSON output path")
    args = parser.parse_args()
    result = build_document()
    if args.document_out:
        path = Path(args.document_out)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(canonical_bytes(result["document"]) + b"\n")
    print(json.dumps(result, sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
