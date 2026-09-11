#!/usr/bin/env python3
"""Deterministic, fail-closed builder for the canonical A2 Browser Operator runtime."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import time
import zipfile

VERSIONED_NAME = re.compile(r"-v\d{3}(?:\.|$)", re.I)
IMPORT_SCRIPT = re.compile(r"importScripts\(\s*['\"]\./([^'\"]+)['\"]\s*\)")
HTML_REF = re.compile(r"(?:src|href)=['\"]([^'\"]+)['\"]", re.I)
PRIVATE_JWK = re.compile(r"['\"]d['\"]\s*:\s*['\"][A-Za-z0-9_-]{20,}['\"]")
SERVICE_ROLE = re.compile(r"SUPABASE_SERVICE_ROLE_KEY\s*[=:]\s*['\"]", re.I)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def local_html_refs(text: str) -> set[str]:
    refs: set[str] = set()
    for value in HTML_REF.findall(text):
        value = value.strip()
        if not value or value.startswith(("http://", "https://", "data:", "#")):
            continue
        refs.add(value.split("?", 1)[0].split("#", 1)[0])
    return refs


def validate(source: Path, package_manifest: Path) -> tuple[dict, list[str], set[str]]:
    spec = json.loads(package_manifest.read_text(encoding="utf-8"))
    if spec.get("schema") != "metaengine.a2-browser-operator.runtime-package.v1":
        raise SystemExit("runtime_package_schema_invalid")
    files = spec.get("files")
    if not isinstance(files, list) or not files or any(not isinstance(x, str) or not x for x in files):
        raise SystemExit("runtime_package_files_invalid")
    if len(files) != len(set(files)):
        raise SystemExit("runtime_package_duplicate_file")

    normalized: list[str] = []
    for raw in files:
        p = Path(raw)
        if p.is_absolute() or ".." in p.parts or str(p).replace("\\", "/") != raw:
            raise SystemExit(f"runtime_package_path_invalid:{raw}")
        if VERSIONED_NAME.search(raw):
            raise SystemExit(f"runtime_package_versioned_filename:{raw}")
        if not (source / p).is_file():
            raise SystemExit(f"runtime_package_file_missing:{raw}")
        normalized.append(raw)

    listed = set(normalized)
    manifest = json.loads((source / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("version") != spec.get("package_version"):
        raise SystemExit("runtime_package_manifest_version_mismatch")

    required: set[str] = {str(manifest["background"]["service_worker"])}
    required.add(str(manifest["side_panel"]["default_path"]))
    required.add(str(manifest["options_page"]))
    for row in manifest.get("content_scripts", []):
        required.update(str(x) for x in row.get("js", []))

    background = (source / manifest["background"]["service_worker"]).read_text(encoding="utf-8")
    imports = IMPORT_SCRIPT.findall(background)
    if len(imports) != len(set(imports)):
        raise SystemExit("runtime_package_duplicate_import")
    required.update(imports)

    for html_name in [manifest["side_panel"]["default_path"], manifest["options_page"]]:
        required.update(local_html_refs((source / html_name).read_text(encoding="utf-8")))

    missing = sorted(required - listed)
    if missing:
        raise SystemExit("runtime_package_reference_not_listed:" + ",".join(missing))
    versioned_refs = sorted(x for x in required if VERSIONED_NAME.search(x))
    if versioned_refs:
        raise SystemExit("runtime_package_active_versioned_reference:" + ",".join(versioned_refs))

    bootstrap = (source / "bootstrap-config.js").read_text(encoding="utf-8")
    if spec.get("policy", {}).get("generic_bootstrap_must_be_empty") is True:
        for marker in ['bridgeSecret: ""', 'supervisorBootstrapSecret: ""', 'pairingEpoch: ""']:
            if marker not in bootstrap:
                raise SystemExit(f"runtime_package_generic_bootstrap_not_empty:{marker}")

    for rel in normalized:
        path = source / rel
        if path.suffix.lower() not in {".js", ".json", ".html", ".css"}:
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        if SERVICE_ROLE.search(text):
            raise SystemExit(f"runtime_package_service_role_material:{rel}")
        if PRIVATE_JWK.search(text):
            raise SystemExit(f"runtime_package_private_jwk_material:{rel}")

    runtime_marker = (source / "runtime-marker.js").read_text(encoding="utf-8")
    runtime = str(spec.get("operator_runtime") or "")
    if not runtime or runtime not in runtime_marker:
        raise SystemExit("runtime_package_runtime_marker_mismatch")
    return spec, normalized, required


def stage_files(source: Path, stage: Path, files: list[str]) -> dict[str, str]:
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir(parents=True)
    hashes: dict[str, str] = {}
    for rel in files:
        src = source / rel
        dst = stage / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        hashes[rel] = sha256_file(dst)
    actual = sorted(p.relative_to(stage).as_posix() for p in stage.rglob("*") if p.is_file())
    if actual != sorted(files):
        raise SystemExit("runtime_package_stage_closure_mismatch")
    return hashes


def deterministic_zip(stage: Path, out: Path, epoch: int) -> str:
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        out.unlink()
    epoch = max(315532800, min(epoch, 4354819199))
    stamp = time.gmtime(epoch)[:6]
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for path in sorted(p for p in stage.rglob("*") if p.is_file()):
            rel = path.relative_to(stage).as_posix()
            if VERSIONED_NAME.search(rel):
                raise SystemExit(f"runtime_package_zip_versioned_filename:{rel}")
            info = zipfile.ZipInfo(rel, stamp)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (0o644 & 0xFFFF) << 16
            zf.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    with zipfile.ZipFile(out) as zf:
        if zf.testzip() is not None:
            raise SystemExit("runtime_package_zip_integrity_failed")
    return sha256_file(out)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, type=Path)
    ap.add_argument("--package-manifest", required=True, type=Path)
    ap.add_argument("--stage", required=True, type=Path)
    ap.add_argument("--zip", dest="zip_path", required=True, type=Path)
    ap.add_argument("--evidence-dir", required=True, type=Path)
    ap.add_argument("--source-commit", default=os.environ.get("GITHUB_SHA", "UNKNOWN"))
    ap.add_argument("--source-date-epoch", type=int, default=int(os.environ.get("SOURCE_DATE_EPOCH", "315532800")))
    args = ap.parse_args()

    spec, files, required = validate(args.source, args.package_manifest)
    hashes = stage_files(args.source, args.stage, files)
    zip_sha = deterministic_zip(args.stage, args.zip_path, args.source_date_epoch)

    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    evidence = {
        "schema": "metaengine.a2-browser-operator.runtime-build.v1",
        "package_schema": spec["schema"],
        "package_version": spec["package_version"],
        "operator_runtime": spec["operator_runtime"],
        "source_commit": args.source_commit,
        "source_date_epoch": args.source_date_epoch,
        "file_count": len(files),
        "required_reference_count": len(required),
        "zip_sha256": zip_sha,
        "canonical_only": True,
        "source_files_sha256": hashes,
    }
    (args.evidence_dir / "BUILD_MANIFEST.json").write_text(json.dumps(evidence, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    (args.evidence_dir / "SHA256SUMS").write_text(f"{zip_sha}  {args.zip_path.name}\n", encoding="utf-8")
    print(json.dumps({"ok": True, "zip_sha256": zip_sha, "files": len(files)}, sort_keys=True))


if __name__ == "__main__":
    main()
