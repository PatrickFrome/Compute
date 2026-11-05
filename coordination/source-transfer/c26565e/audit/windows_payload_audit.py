#!/usr/bin/env python3
"""Read-only Windows payload evidence checker for a disposable METAENGINE source copy.

No network downloads, installers, services, sockets or live database connections.
Only 'tree' creates a disposable *local* Git clone. All result checks fail closed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import sys
import tempfile

REQUIRED_COMPONENTS = ("node", "deno", "postgresql", "git", "codex")
DEFAULT_PART_HASHES = (
    "485ca6ce2d467f9e577aaf263626af52154425ab",
    "a02e1d8217d878fdabbf01ff7f7c04b883158407",
    "b0b280633fff1e794d6b6079e313412b6e2ca04e",
)
DEFAULT_ARCHIVE_SHA256 = "4200e492828dbb857aaa737a7ce56d0aeda3c97c84f7743b1501ef2f229d3636"
DEFAULT_SOURCE_COMMIT = "c26565e58ab92dcbcda9663c4d231bdf4a9a7ee6"
DEFAULT_SOURCE_TREE = "2dbe253e97379532f6f4b52ef7edf26109a9266d"
DEFAULT_PATCHED_TREE = "90fa5633d7926dd71a7303266073e0625325e740"


def row(name: str, status: str, detail: str) -> dict:
    return {"check": name, "status": status, "detail": detail}


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def git_blob_sha1(path: Path) -> str:
    h = hashlib.sha1(b"blob " + str(path.stat().st_size).encode("ascii") + b"\0")
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def verify_parts(parts: list[Path], expected_part_shas: list[str], expected_archive: str) -> list[dict]:
    results: list[dict] = []
    if len(parts) != len(expected_part_shas) or not parts:
        return [row("transfer.parts", "FAIL", "part count differs from pinned manifest")]
    combined = hashlib.sha256()
    all_valid = True
    for i, (part, expected) in enumerate(zip(parts, expected_part_shas)):
        if not part.is_file():
            results.append(row(f"part.{i:02d}", "FAIL", f"missing: {part}"))
            all_valid = False
            continue
        actual = git_blob_sha1(part)
        match = actual == expected.lower()
        results.append(row(f"part.{i:02d}", "PASS" if match else "FAIL", f"blob SHA1={actual}; expected={expected}"))
        all_valid &= match
        with part.open("rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                combined.update(chunk)
    if all(p.is_file() for p in parts):
        actual_archive = combined.hexdigest()
        results.append(row("archive.sha256", "PASS" if actual_archive == expected_archive.lower() and all_valid else "FAIL",
                           f"SHA256={actual_archive}; expected={expected_archive}"))
    else:
        results.append(row("archive.sha256", "NOT RUN", "some source parts are not available"))
    return results


def git(cwd: Path, *args: str) -> str:
    # Runs only local Git commands in a caller-selected disposable checkout.
    proc = subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True, check=False)
    if proc.returncode:
        raise RuntimeError(f"git {args[0]} failed ({proc.returncode}): {proc.stderr.strip()[:700]}")
    return proc.stdout.strip()


def verify_tree(source: Path, patch: Path, original_commit: str, original_tree: str, patched_tree: str) -> list[dict]:
    results: list[dict] = []
    if not source.is_dir() or not patch.is_file():
        return [row("tree.inputs", "NOT RUN", "local source checkout or integrated patch is unavailable")]
    with tempfile.TemporaryDirectory(prefix="metaengine-source-tree-") as td:
        clone = Path(td) / "clone"
        try:
            # --local and explicit source directory prevent remote repository resolution.
            subprocess.run(["git", "clone", "--local", "--no-hardlinks", "--no-checkout", "--quiet", str(source), str(clone)],
                           capture_output=True, text=True, check=True)
            git(clone, "checkout", "--detach", "--quiet", original_commit)
            source_commit = git(clone, "rev-parse", "HEAD")
            base_tree = git(clone, "rev-parse", "HEAD^{tree}")
            base_ok = (source_commit == original_commit and base_tree == original_tree)
            results.append(row("source.commit-tree", "PASS" if base_ok else "FAIL",
                               f"commit={source_commit}, tree={base_tree}; expected={original_commit}/{original_tree}"))
            if not base_ok:
                results.append(row("integrated.patch", "NOT RUN", "source identity mismatch"))
                return results
            git(clone, "apply", "--check", str(patch.resolve()))
            git(clone, "apply", str(patch.resolve()))
            git(clone, "add", "--all")
            result_tree = git(clone, "write-tree")
            results.append(row("integrated.patch-tree", "PASS" if result_tree == patched_tree else "FAIL",
                               f"tree={result_tree}; expected={patched_tree}"))
        except (RuntimeError, OSError, subprocess.CalledProcessError) as exc:
            results.append(row("integrated.patch-tree", "FAIL", str(exc)[:900]))
    return results


def relative_path(text: str) -> Path:
    # Interpret manifest paths as repository-style, case-sensitive relative paths.
    if not isinstance(text, str) or not text or "\\" in text or ":" in text:
        raise ValueError("expected a nonempty POSIX relative path")
    p = PurePosixPath(text)
    if p.is_absolute() or any(part in ("..", "") for part in p.parts) or str(p) != text:
        raise ValueError("noncanonical or nonrelative path")
    return Path(*p.parts)


def audit_inventory(matrix: dict, catalog: dict, origins: Path | None, staging: Path | None,
                    checkout: Path | None, expected_tree: str = DEFAULT_PATCHED_TREE) -> list[dict]:
    """Catalog and matrix MUST come from independently reviewed exact-source evidence.

    No catalog -> cannot infer complete file inventory. Calling code must not
    report a component as PASS based only on a few existing executables.
    """
    results: list[dict] = []
    if not matrix or not catalog:
        return [row("inventory.source-catalog", "NOT RUN", "missing exact-source catalog or item-to-consumer matrix")]
    if matrix.get("source_tree") != expected_tree or catalog.get("source_tree") != expected_tree:
        return [row("inventory.source-tree", "FAIL", "both inputs must bind to the exact expected source tree")]
    if checkout is None or not checkout.is_dir():
        return [row("inventory.source-checkout", "NOT RUN", "exact source checkout was not supplied")]
    catalog_entries = catalog.get("files")
    matrix_entries = matrix.get("files")
    if not isinstance(catalog_entries, list) or not isinstance(matrix_entries, list):
        return [row("inventory.schema", "FAIL", "catalog.files and matrix.files must be arrays")]
    try:
        expected = {(x["component"], x["package_path"]) for x in catalog_entries}
        actual = {(x["component"], x["package_path"]) for x in matrix_entries}
        if len(expected) != len(catalog_entries) or len(actual) != len(matrix_entries):
            raise ValueError("duplicate component/path pair")
        for x in catalog_entries + matrix_entries:
            if x["component"] not in REQUIRED_COMPONENTS:
                raise ValueError(f"unrecognized component: {x['component']}")
            relative_path(x["package_path"])
    except (KeyError, TypeError, ValueError) as exc:
        return [row("inventory.schema", "FAIL", str(exc))]
    missing_components = set(REQUIRED_COMPONENTS) - {c for c, _ in expected}
    for c in sorted(missing_components):
        results.append(row(f"{c}.catalog", "FAIL", "no required files enumerated in catalog"))
    for comp, path in sorted(expected - actual):
        results.append(row(f"{comp}.{path}", "FAIL", "catalog-required package file lacks matrix evidence"))
    for comp, path in sorted(actual - expected):
        results.append(row(f"{comp}.{path}", "FAIL", "unproven matrix entry not in authoritative package catalog"))
    if not expected:
        return results or [row("inventory.catalog", "FAIL", "empty catalog cannot prove closure")]
    if origins is None or staging is None or not origins.is_dir() or not staging.is_dir():
        results.append(row("inventory.physical-bytes", "NOT RUN", "origin and staged file roots were not both supplied"))
        return results
    for item in matrix_entries:
        comp, package_path = item["component"], item["package_path"]
        if (comp, package_path) not in expected:
            continue
        try:
            origin_path = relative_path(item["origin_path"])
            stage_path = relative_path(package_path)
            consumer_path = relative_path(item["consumer_path"])
            sha = item["sha256"].lower()
            probe = item["consumer_literal"]
            provenance = item["provenance"]
            if not isinstance(probe, str) or not probe or not isinstance(provenance, str) or not provenance:
                raise ValueError("nonempty provenance and consumer_literal are required")
            if len(sha) != 64 or any(ch not in "0123456789abcdef" for ch in sha):
                raise ValueError("invalid pinned SHA256")
            origin = origins / origin_path
            staged = staging / stage_path
            consumer = checkout / consumer_path
            if not origin.is_file() or not staged.is_file():
                raise ValueError("missing origin or staged file bytes")
            if not consumer.is_file() or probe not in consumer.read_text(encoding="utf-8"):
                raise ValueError("consumer evidence path/probe absent")
            origin_hash, staged_hash = sha256_file(origin), sha256_file(staged)
            if origin_hash != sha or staged_hash != sha:
                raise ValueError(f"SHA mismatch origin={origin_hash} staged={staged_hash} expected={sha}")
            results.append(row(f"{comp}.{package_path}", "PASS", f"origin={origin_path}, staged={stage_path}, consumer={consumer_path}"))
        except (KeyError, OSError, ValueError, UnicodeError, TypeError) as exc:
            results.append(row(f"{comp}.{package_path}", "FAIL", str(exc)[:700]))
    # Two Windows paths differing only in case would collide in a Windows package.
    paths = [p for _, p in expected]
    if len(set(p.casefold() for p in paths)) != len(paths):
        results.append(row("inventory.windows-case-collision", "FAIL", "case-insensitive target path collision"))
    return results


def print_results(results: list[dict]) -> int:
    print(json.dumps({"results": results, "summary": {
        "PASS": sum(r["status"] == "PASS" for r in results),
        "FAIL": sum(r["status"] == "FAIL" for r in results),
        "NOT RUN": sum(r["status"] == "NOT RUN" for r in results),
    }}, ensure_ascii=False, indent=2))
    return 1 if any(r["status"] == "FAIL" for r in results) else 2 if any(r["status"] == "NOT RUN" for r in results) else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sp = parser.add_subparsers(dest="cmd", required=True)
    transfer = sp.add_parser("transfer", help="verify reconstructed parts in original order")
    transfer.add_argument("parts", nargs="+", type=Path)
    transfer.add_argument("--part-sha1", nargs="+", default=list(DEFAULT_PART_HASHES))
    transfer.add_argument("--archive-sha256", default=DEFAULT_ARCHIVE_SHA256)
    tree = sp.add_parser("tree", help="apply published patch in disposable clone and verify Git tree")
    tree.add_argument("--checkout", type=Path, required=True)
    tree.add_argument("--patch", type=Path, required=True)
    tree.add_argument("--commit", default=DEFAULT_SOURCE_COMMIT)
    tree.add_argument("--source-tree", default=DEFAULT_SOURCE_TREE)
    tree.add_argument("--final-tree", default=DEFAULT_PATCHED_TREE)
    inventory = sp.add_parser("inventory", help="compare independent catalog, matrix, physical bytes and consumers")
    inventory.add_argument("--catalog", type=Path, required=True)
    inventory.add_argument("--matrix", type=Path, required=True)
    inventory.add_argument("--checkout", type=Path)
    inventory.add_argument("--origin-root", type=Path)
    inventory.add_argument("--staging-root", type=Path)
    inventory.add_argument("--final-tree", default=DEFAULT_PATCHED_TREE)
    args = parser.parse_args()
    if args.cmd == "transfer":
        return print_results(verify_parts(args.parts, args.part_sha1, args.archive_sha256))
    if args.cmd == "tree":
        return print_results(verify_tree(args.checkout, args.patch, args.commit, args.source_tree, args.final_tree))
    try:
        catalog = json.loads(args.catalog.read_text(encoding="utf-8")) if args.catalog.is_file() else {}
        matrix = json.loads(args.matrix.read_text(encoding="utf-8")) if args.matrix.is_file() else {}
    except (OSError, json.JSONDecodeError) as exc:
        return print_results([row("inventory.inputs", "FAIL", str(exc))])
    return print_results(audit_inventory(matrix, catalog, args.origin_root, args.staging_root, args.checkout, args.final_tree))


if __name__ == "__main__":
    sys.exit(main())
