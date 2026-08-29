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
MODULE_IMPORT = re.compile(r"^\s*import\s", re.M)
MODULE_EXPORT = re.compile(r"\bexport\s")


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


def normalize_repo_relative(raw: str) -> str:
    p = Path(raw)
    if p.is_absolute() or ".." in p.parts or str(p).replace("\\", "/") != raw:
        raise SystemExit(f"runtime_package_generated_source_invalid:{raw}")
    return raw


def generate_classic_semantic_compiler(source_text: str, source_rel: str) -> bytes:
    if MODULE_IMPORT.search(source_text):
        raise SystemExit("semantic_compiler_shared_import_forbidden")
    if source_text.count("export function compileSemanticFrame") != 1:
        raise SystemExit("semantic_compiler_compile_export_contract_changed")
    if source_text.count("export const SEMANTIC_PERCEPTION_LIMITS") != 1:
        raise SystemExit("semantic_compiler_limits_export_contract_changed")
    transformed = source_text.replace("export function compileSemanticFrame", "function compileSemanticFrame", 1)
    transformed = transformed.replace("export const SEMANTIC_PERCEPTION_LIMITS", "const SEMANTIC_PERCEPTION_LIMITS", 1)
    if MODULE_EXPORT.search(transformed):
        raise SystemExit("semantic_compiler_unhandled_export")
    source_sha = sha256_bytes(source_text.encode("utf-8"))
    wrapped = (
        '(() => {\n'
        '  "use strict";\n'
        f'  // GENERATED from {source_rel}; sha256={source_sha}. Do not edit by hand.\n'
        + "\n".join("  " + line if line else "" for line in transformed.splitlines())
        + '\n  globalThis.A2_SEMANTIC_PERCEPTION = Object.freeze({\n'
        '    schema: "metaengine.a2-browser-operator.semantic-compiler.v1",\n'
        f'    source_sha256: "{source_sha}",\n'
        '    compileSemanticFrame,\n'
        '    limits: SEMANTIC_PERCEPTION_LIMITS\n'
        '  });\n'
        '})();\n'
    )
    return wrapped.encode("utf-8")


def generated_bytes(repo_root: Path, rel: str, generated: dict) -> tuple[bytes, dict]:
    spec = generated.get(rel)
    if not isinstance(spec, dict):
        raise SystemExit(f"runtime_package_generated_spec_invalid:{rel}")
    kind = spec.get("kind")
    source_rel = normalize_repo_relative(str(spec.get("source") or ""))
    source_path = repo_root / source_rel
    if not source_path.is_file():
        raise SystemExit(f"runtime_package_generated_source_missing:{source_rel}")
    source_bytes = source_path.read_bytes()
    source_text = source_bytes.decode("utf-8")
    if kind == "classic_semantic_perception_v1":
        data = generate_classic_semantic_compiler(source_text, source_rel)
    else:
        raise SystemExit(f"runtime_package_generated_kind_unknown:{kind}")
    return data, {
        "kind": kind,
        "source": source_rel,
        "source_sha256": sha256_bytes(source_bytes),
        "output_sha256": sha256_bytes(data),
    }


def validate(source: Path, package_manifest: Path, repo_root: Path) -> tuple[dict, list[str], set[str], dict]:
    spec = json.loads(package_manifest.read_text(encoding="utf-8"))
    if spec.get("schema") != "metaengine.a2-browser-operator.runtime-package.v1":
        raise SystemExit("runtime_package_schema_invalid")
    files = spec.get("files")
    if not isinstance(files, list) or not files or any(not isinstance(x, str) or not x for x in files):
        raise SystemExit("runtime_package_files_invalid")
    if len(files) != len(set(files)):
        raise SystemExit("runtime_package_duplicate_file")
    generated = spec.get("generated_files") or {}
    if not isinstance(generated, dict):
        raise SystemExit("runtime_package_generated_files_invalid")
    if set(generated) - set(files):
        raise SystemExit("runtime_package_generated_file_not_listed")

    normalized: list[str] = []
    for raw in files:
        p = Path(raw)
        if p.is_absolute() or ".." in p.parts or str(p).replace("\\", "/") != raw:
            raise SystemExit(f"runtime_package_path_invalid:{raw}")
        if VERSIONED_NAME.search(raw):
            raise SystemExit(f"runtime_package_versioned_filename:{raw}")
        if raw not in generated and not (source / p).is_file():
            raise SystemExit(f"runtime_package_file_missing:{raw}")
        if raw in generated:
            generated_bytes(repo_root, raw, generated)
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
        if rel in generated:
            data, _ = generated_bytes(repo_root, rel, generated)
            text = data.decode("utf-8", errors="replace")
        else:
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
    return spec, normalized, required, generated


def stage_files(source: Path, stage: Path, files: list[str], generated: dict, repo_root: Path) -> tuple[dict[str, str], dict[str, dict]]:
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir(parents=True)
    hashes: dict[str, str] = {}
    generated_evidence: dict[str, dict] = {}
    for rel in files:
        dst = stage / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        if rel in generated:
            data, evidence = generated_bytes(repo_root, rel, generated)
            dst.write_bytes(data)
            generated_evidence[rel] = evidence
        else:
            shutil.copyfile(source / rel, dst)
        hashes[rel] = sha256_file(dst)
    actual = sorted(p.relative_to(stage).as_posix() for p in stage.rglob("*") if p.is_file())
    if actual != sorted(files):
        raise SystemExit("runtime_package_stage_closure_mismatch")
    return hashes, generated_evidence


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

    repo_root = Path(__file__).resolve().parent.parent
    spec, files, required, generated = validate(args.source, args.package_manifest, repo_root)
    hashes, generated_evidence = stage_files(args.source, args.stage, files, generated, repo_root)
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
        "generated_files": generated_evidence,
    }
    (args.evidence_dir / "BUILD_MANIFEST.json").write_text(json.dumps(evidence, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    (args.evidence_dir / "SHA256SUMS").write_text(f"{zip_sha}  {args.zip_path.name}\n", encoding="utf-8")
    print(json.dumps({"ok": True, "zip_sha256": zip_sha, "files": len(files), "generated_files": sorted(generated)}, sort_keys=True))


if __name__ == "__main__":
    main()
