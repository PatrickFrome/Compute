from __future__ import annotations

import hashlib
import json
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile

from controller.w1 import build_host_safety_package as builder


class HostSafetyPackageBuilderTests(unittest.TestCase):
    def test_build_is_byte_for_byte_deterministic(self):
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            first = builder.build(Path(a))
            second = builder.build(Path(b))
            self.assertEqual(first, second)
            one = Path(a) / builder.PACKAGE_FILENAME
            two = Path(b) / builder.PACKAGE_FILENAME
            self.assertEqual(one.read_bytes(), two.read_bytes())
            self.assertEqual(first["sha256"], hashlib.sha256(one.read_bytes()).hexdigest())
            self.assertFalse(first["authority_effect"])
            self.assertFalse(first["provisioning_authority"])
            self.assertFalse(first["runtime_authority"])

    def test_archive_has_only_expected_fixed_entries_and_modes(self):
        with tempfile.TemporaryDirectory() as tmp:
            receipt = builder.build(Path(tmp))
            archive = Path(tmp) / builder.PACKAGE_FILENAME
            expected = {
                "install.sh": 0o555,
                "uninstall.sh": 0o555,
                "manifest.json": 0o444,
                "package-lock.json": 0o444,
                "controller/w1/host_safety_evidence_bundle.py": 0o444,
                "controller/w1/host_safety_envelope_validator.py": 0o444,
                "worker/native_linux/host_safety_envelope_probe.py": 0o444,
            }
            with zipfile.ZipFile(archive) as zf:
                self.assertEqual(sorted(expected), sorted(zf.namelist()))
                for info in zf.infolist():
                    self.assertEqual(builder.ZIP_EPOCH, info.date_time)
                    mode = (info.external_attr >> 16) & 0o7777
                    self.assertEqual(expected[info.filename], mode)
                    self.assertFalse(info.filename.startswith("/"))
                    self.assertNotIn("..", Path(info.filename).parts)
            self.assertEqual(sorted(expected), sorted(entry["path"] for entry in receipt["entries"]))

    def test_payload_lock_contains_sha256_and_exact_git_object_identity(self):
        sources, manifest_raw = builder._load_locked_sources()
        lock = builder._payload_lock(sources, manifest_raw)
        by_path = {item["path"]: item for item in lock["files"]}
        self.assertEqual(set(builder.SOURCE_FILES), set(by_path))
        for rel, expected_blob in builder.SOURCE_FILES.items():
            raw = sources[rel]
            item = by_path[rel]
            self.assertEqual(hashlib.sha256(raw).hexdigest(), item["sha256"])
            self.assertEqual(expected_blob, item["git_blob_sha1"])
            self.assertEqual("0444", item["install_mode"])
            self.assertEqual(0, item["install_uid"])
            self.assertEqual(0, item["install_gid"])
        neutral = {key: value for key, value in lock.items() if key != "lock_sha256"}
        self.assertEqual(hashlib.sha256(builder.canonical_bytes(neutral)).hexdigest(), lock["lock_sha256"])

    def test_static_manifest_is_exact_pinned_source_identity(self):
        sources, manifest_raw = builder._load_locked_sources()
        self.assertTrue(sources)
        self.assertEqual(builder.STATIC_MANIFEST_SHA256, hashlib.sha256(manifest_raw).hexdigest())
        manifest = json.loads(manifest_raw)
        self.assertEqual(builder.SOURCE_COMMIT, manifest["source_commit_sha"])
        self.assertEqual(builder.SOURCE_TREE, manifest["source_tree_sha"])
        self.assertEqual(builder.INSTALL_ROOT, manifest["package_root"])
        self.assertEqual(builder.EXECUTION_USER, manifest["execution_user"])
        self.assertEqual(builder.WORKSPACE_ROOT, manifest["workspace_root"])

    def test_installer_has_fixed_root_owned_install_and_preserves_workspace_on_uninstall(self):
        sources, manifest_raw = builder._load_locked_sources()
        lock = builder._payload_lock(sources, manifest_raw)
        install = builder._installer(lock).decode("utf-8")
        uninstall = builder._uninstaller().decode("utf-8")
        self.assertIn(builder.INSTALL_ROOT, install)
        self.assertIn(builder.EXECUTION_USER, install)
        self.assertIn(builder.WORKSPACE_ROOT, install)
        self.assertIn("install -o root -g root -m 0444", install)
        self.assertIn("install -d -o \"$EXEC_USER\" -g \"$EXEC_USER\" -m 0700", install)
        self.assertIn("package_payload_sha256_mismatch", install)
        self.assertNotIn("curl ", install)
        self.assertNotIn("wget ", install)
        self.assertNotIn("aws ", install)
        self.assertNotIn("sudo ", install)
        self.assertIn("Deliberately preserve", uninstall)
        self.assertNotIn(builder.WORKSPACE_ROOT + "'", uninstall.split("rm -rf", 1)[1].split("\n", 1)[0])


if __name__ == "__main__":
    unittest.main()
