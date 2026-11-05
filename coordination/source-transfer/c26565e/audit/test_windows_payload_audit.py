"""Inert synthetic fixture tests. No installed clients, networking, databases, or installers."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

import windows_payload_audit as a


class WindowsPayloadAuditTest(unittest.TestCase):
    def test_transfer_valid_and_reversed(self):
        with tempfile.TemporaryDirectory() as tmp:
            parts = []
            for name, value in (("part0", b"abcdef"), ("part1", b"01234"), ("part2", b"XYZ")):
                p = Path(tmp) / name
                p.write_bytes(value)
                parts.append(p)
            shas = [a.git_blob_sha1(p) for p in parts]
            expected = hashlib.sha256(b"abcdef01234XYZ").hexdigest()
            good = a.verify_parts(parts, shas, expected)
            self.assertEqual([r["status"] for r in good], ["PASS"] * 4)
            swapped = a.verify_parts([parts[1], parts[0], parts[2]], shas, expected)
            self.assertIn("FAIL", [r["status"] for r in swapped])

    def test_transfer_missing_and_corrupted(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "p"
            p.write_bytes(b"original")
            expect = a.git_blob_sha1(p)
            p.write_bytes(b"changed")
            result = a.verify_parts([p], [expect], hashlib.sha256(b"original").hexdigest())
            self.assertEqual([r["status"] for r in result], ["FAIL", "FAIL"])
            p.unlink()
            result = a.verify_parts([p], [expect], "0" * 64)
            self.assertEqual([r["status"] for r in result], ["FAIL", "NOT RUN"])

    def test_tree_applied_only_in_disposable_clone(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "src"
            root.mkdir()
            def g(*args):
                return subprocess.run(["git", "-C", str(root), *args], capture_output=True,
                                      text=True, check=True).stdout.strip()
            g("init", "-q")
            g("config", "user.name", "Fixture")
            g("config", "user.email", "fixture@example.invalid")
            (root / "data.txt").write_text("before\n", encoding="utf-8")
            g("add", "--all")
            g("commit", "-qm", "fixture")
            original_commit, original_tree = g("rev-parse", "HEAD"), g("rev-parse", "HEAD^{tree}")
            (root / "data.txt").write_text("after\n", encoding="utf-8")
            patch = Path(tmp) / "change.patch"
            patch.write_text(g("diff") + "\n", encoding="utf-8")
            g("add", "--all")
            final_tree = g("write-tree")
            g("reset", "--hard", "-q", original_commit)
            success = a.verify_tree(root, patch, original_commit, original_tree, final_tree)
            self.assertEqual([r["status"] for r in success], ["PASS", "PASS"])
            self.assertEqual((root / "data.txt").read_text(), "before\n")
            wrong = a.verify_tree(root, patch, original_commit, original_tree, "0" * 40)
            self.assertEqual([r["status"] for r in wrong], ["PASS", "FAIL"])

    def make_manifest_fixture(self, root):
        source, origins, staging = (Path(root) / name for name in ("checkout", "origins", "staging"))
        for p in (source, origins, staging): p.mkdir()
        catalog = {"source_tree": a.DEFAULT_PATCHED_TREE, "files": []}
        matrix = {"source_tree": a.DEFAULT_PATCHED_TREE, "files": []}
        for c in a.REQUIRED_COMPONENTS:
            pkg = f"tools/{c}/{c}.exe"
            item = {"component": c, "package_path": pkg}
            catalog["files"].append(item)
            content = f"fixture:{c}".encode()
            origin_path = f"download/{c}.bin"
            for dest in (origins / origin_path, staging / pkg):
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(content)
            consumer_path = f"consumers/{c}.txt"
            dest = source / consumer_path
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(f"use {pkg}\n", encoding="utf-8")
            matrix["files"].append({**item, "provenance": f"synthetic-{c}", "origin_path": origin_path,
                "sha256": hashlib.sha256(content).hexdigest(), "consumer_path": consumer_path,
                "consumer_literal": pkg})
        return catalog, matrix, origins, staging, source

    def test_inventory_all_five_inert_fixtures(self):
        with tempfile.TemporaryDirectory() as tmp:
            cat, matrix, orig, stage, src = self.make_manifest_fixture(tmp)
            result = a.audit_inventory(matrix, cat, orig, stage, src)
            self.assertEqual(len(result), 5)
            self.assertTrue(all(r["status"] == "PASS" for r in result), result)

    def test_inventory_missing_required_file_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            cat, matrix, orig, stage, src = self.make_manifest_fixture(tmp)
            (stage / "tools" / "node" / "node.exe").unlink()
            result = a.audit_inventory(matrix, cat, orig, stage, src)
            self.assertIn("FAIL", [r["status"] for r in result])

    def test_inventory_mismatch_sha_or_consumer_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            cat, matrix, orig, stage, src = self.make_manifest_fixture(tmp)
            (stage / "tools" / "git" / "git.exe").write_bytes(b"altered")
            (src / "consumers" / "deno.txt").write_text("nothing\n")
            result = a.audit_inventory(matrix, cat, orig, stage, src)
            failed = {r["check"] for r in result if r["status"] == "FAIL"}
            self.assertEqual(failed, {"git.tools/git/git.exe", "deno.tools/deno/deno.exe"})

    def test_catalog_not_enough_to_prove_completeness(self):
        with tempfile.TemporaryDirectory() as tmp:
            cat, matrix, orig, stage, src = self.make_manifest_fixture(tmp)
            matrix["files"].pop()
            result = a.audit_inventory(matrix, cat, orig, stage, src)
            self.assertIn("FAIL", [r["status"] for r in result])
            self.assertIn("NOT RUN", [r["status"] for r in a.audit_inventory({}, {}, orig, stage, src)])
            cat["files"] = [x for x in cat["files"] if x["component"] != "codex"]
            result = a.audit_inventory(matrix, cat, orig, stage, src)
            self.assertIn("FAIL", [r["status"] for r in result])

    def test_physical_qualification_not_run_without_staging(self):
        with tempfile.TemporaryDirectory() as tmp:
            cat, matrix, orig, stage, src = self.make_manifest_fixture(tmp)
            result = a.audit_inventory(matrix, cat, orig, None, src)
            self.assertEqual(result[0]["status"], "NOT RUN")

    def test_schema_rejects_path_collision(self):
        with tempfile.TemporaryDirectory() as tmp:
            cat, matrix, orig, stage, src = self.make_manifest_fixture(tmp)
            item = dict(matrix["files"][0])
            item["package_path"] = item["package_path"].upper()
            cat["files"].append({"component": "node", "package_path": item["package_path"]})
            matrix["files"].append(item)
            result = a.audit_inventory(matrix, cat, orig, stage, src)
            self.assertIn("FAIL", [r["status"] for r in result])


# Additional exact ZIP-source regressions; no installed software or vendor binaries.
class ZipSnapshotRegression(unittest.TestCase):
    def test_preserves_zip_execute_modes_and_tree(self):
        import zipfile
        import windows_payload_audit as audit
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp);source=path/'source';source.mkdir()
            for name,contents in [('main.txt',b'example\n'),('bin/run.sh',b'run\n')]:
                output=source/name;output.parent.mkdir(parents=True,exist_ok=True);output.write_bytes(contents)
                output.chmod(0o755 if name.endswith('.sh') else 0o644)
            subprocess.run(['git','-C',str(source),'init','-q'],check=True,capture_output=True)
            subprocess.run(['git','-C',str(source),'add','--force','--all'],check=True,capture_output=True)
            tree=subprocess.check_output(['git','-C',str(source),'write-tree'],text=True).strip()
            z=path/'synthetic.zip'
            with zipfile.ZipFile(z,'w') as f:
                for name in ['main.txt','bin/run.sh']:
                    entry=zipfile.ZipInfo('Compute/'+name);entry.create_system=3
                    entry.external_attr=(0o100755 if name.endswith('.sh') else 0o100644)<<16
                    f.writestr(entry,(source/name).read_bytes())
            digest=audit.sha256_file(z)
            good=audit.verify_snapshot_zip(z,digest,tree,2,1)
            self.assertEqual([r['status'] for r in good],['PASS']*3)
            missing=audit.verify_snapshot_zip(z,digest,tree,2,2)
            self.assertEqual([r['status'] for r in missing],['PASS','FAIL'])
            wrong_tree=audit.verify_snapshot_zip(z,digest,'0'*40,2,1)
            self.assertEqual([r['status'] for r in wrong_tree],['PASS','PASS','FAIL'])
            wrong_bytes=audit.verify_snapshot_zip(z,'1'*64,tree,2,1)
            self.assertEqual([r['status'] for r in wrong_bytes],['FAIL'])

if __name__ == "__main__":
    unittest.main(verbosity=2)
