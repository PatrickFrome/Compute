import importlib.util
import json
import tarfile
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).parents[1] / "controller" / "r1" / "recovery_artifact_packager.py"
spec = importlib.util.spec_from_file_location("r1_recovery_artifact_packager", MODULE_PATH)
mod = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(mod)

PROJECT_REF = "xpeibufgzjknrhbhpffp"
SEMANTIC_HEAD = "metaengine-h205f22-recovery-dev-20260821-cp072"
GIT_SHA = "a" * 40
SNAPSHOT_AT = "2026-08-21T15:00:00+00:00"


def make_inputs(root: Path):
    schema = root / "schema.sql"
    data = root / "data.sql"
    roles = root / "roles.sql"
    ledger = root / "migration-ledger.json"
    meta = root / "export-metadata.json"
    schema.write_text("create schema destruktion_meta;\n")
    data.write_text("insert into destruktion_meta.example values (1);\n")
    roles.write_text("-- roles export\n")
    ledger.write_text(json.dumps({"schema": "metaengine.compute.migration-ledger.v1", "row_count": 7}, sort_keys=True))
    meta.write_text(json.dumps({"schema": "metaengine.compute.logical-export.v1", "tool": "supabase-cli", "project_owned_schema": "destruktion_meta"}, sort_keys=True))
    return {
        "database/schema.sql": schema,
        "database/data.sql": data,
        "database/roles.sql": roles,
        "control/migration-ledger.json": ledger,
        "control/export-metadata.json": meta,
    }


def build(root: Path, inputs, *, storage=False, suffix="a"):
    storage_inventory = None
    storage_archive = None
    if storage:
        storage_inventory = root / f"storage-inventory-{suffix}.json"
        storage_archive = root / f"storage-objects-{suffix}.tar"
        storage_inventory.write_text(json.dumps({"schema": "metaengine.compute.storage-inventory.v1", "object_count": 2}, sort_keys=True))
        storage_archive.write_bytes(b"storage-object-archive-bytes")
    output_tar = root / f"bundle-{suffix}.tar"
    output_receipt = root / f"receipt-{suffix}.json"
    receipt = mod.build_bundle(
        project_ref=PROJECT_REF,
        semantic_head=SEMANTIC_HEAD,
        source_git_sha=GIT_SHA,
        snapshot_at=SNAPSHOT_AT,
        inputs=inputs,
        output_tar=output_tar,
        output_receipt=output_receipt,
        storage_inventory=storage_inventory,
        storage_archive=storage_archive,
    )
    return output_tar, output_receipt, receipt


class RecoveryArtifactPackagerTests(unittest.TestCase):
    def test_same_inputs_build_identical_bundle_in_different_directories(self):
        with tempfile.TemporaryDirectory() as ta, tempfile.TemporaryDirectory() as tb:
            ra, rb = Path(ta), Path(tb)
            a = build(ra, make_inputs(ra))[2]
            b = build(rb, make_inputs(rb))[2]
            self.assertEqual(a["bundle_sha256"], b["bundle_sha256"])
            self.assertEqual(a["bundle_bytes"], b["bundle_bytes"])
            self.assertEqual(a["manifest_sha256"], b["manifest_sha256"])

    def test_tar_metadata_and_member_order_are_deterministic(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            tar_path, _, _ = build(root, make_inputs(root))
            with tarfile.open(tar_path, "r") as tf:
                members = tf.getmembers()
                names = [m.name for m in members]
                self.assertEqual(names, [
                    "MANIFEST.json",
                    "control/export-metadata.json",
                    "control/migration-ledger.json",
                    "database/data.sql",
                    "database/roles.sql",
                    "database/schema.sql",
                ])
                for member in members:
                    self.assertEqual(member.mtime, 0)
                    self.assertEqual(member.mode, 0o600)
                    self.assertEqual(member.uid, 0)
                    self.assertEqual(member.gid, 0)
                    self.assertEqual(member.uname, "")
                    self.assertEqual(member.gname, "")

    def test_manifest_is_plaintext_local_only_and_nonauthoritative(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            tar_path, _, receipt = build(root, make_inputs(root))
            with tarfile.open(tar_path, "r") as tf:
                manifest = json.load(tf.extractfile("MANIFEST.json"))
            self.assertEqual(manifest["classification"], "SENSITIVE_RECOVERY_BUNDLE_PLAINTEXT_LOCAL_ONLY")
            self.assertTrue(manifest["security"]["plaintext"])
            self.assertFalse(manifest["security"]["external_storage_ready"])
            self.assertEqual(manifest["security"]["required_next"], "ENCRYPT_ONCE_TO_RECOVERY_RECIPIENTS_THEN_REPLICATE_IDENTICAL_CIPHERTEXT")
            self.assertFalse(manifest["authority"]["r2_proven"])
            self.assertFalse(manifest["authority"]["persisted_seal_allowed"])
            self.assertFalse(receipt["external_storage_ready"])
            self.assertFalse(receipt["authority_effect"])

    def test_without_storage_inputs_manifest_explicitly_warns_storage_objects_absent(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            tar_path, _, receipt = build(root, make_inputs(root))
            with tarfile.open(tar_path, "r") as tf:
                manifest = json.load(tf.extractfile("MANIFEST.json"))
            self.assertFalse(manifest["storage"]["storage_api_objects_included"])
            self.assertEqual(manifest["storage"]["coverage"], "NOT_INCLUDED")
            self.assertEqual(manifest["storage"]["warning"], "SUPABASE_DATABASE_BACKUP_DOES_NOT_INCLUDE_STORAGE_API_OBJECT_BYTES")
            self.assertFalse(receipt["storage_api_objects_included"])

    def test_storage_inventory_and_archive_must_be_supplied_together(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            inputs = make_inputs(root)
            inventory = root / "storage-inventory.json"
            inventory.write_text('{}')
            with self.assertRaisesRegex(mod.BundleError, "storage_inventory_and_archive_must_be_supplied_together"):
                mod.build_bundle(
                    project_ref=PROJECT_REF,
                    semantic_head=SEMANTIC_HEAD,
                    source_git_sha=GIT_SHA,
                    snapshot_at=SNAPSHOT_AT,
                    inputs=inputs,
                    output_tar=root / "bundle.tar",
                    output_receipt=root / "receipt.json",
                    storage_inventory=inventory,
                    storage_archive=None,
                )

    def test_storage_pair_is_included_and_hashed(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            tar_path, _, receipt = build(root, make_inputs(root), storage=True)
            self.assertTrue(receipt["storage_api_objects_included"])
            with tarfile.open(tar_path, "r") as tf:
                manifest = json.load(tf.extractfile("MANIFEST.json"))
                names = {m.name for m in tf.getmembers()}
            self.assertTrue(manifest["storage"]["storage_api_objects_included"])
            self.assertEqual(manifest["storage"]["declared_object_count"], 2)
            self.assertIn("storage/storage-inventory.json", names)
            self.assertIn("storage/storage-objects.tar", names)
            entry_paths = {entry["path"] for entry in manifest["entries"]}
            self.assertIn("storage/storage-inventory.json", entry_paths)
            self.assertIn("storage/storage-objects.tar", entry_paths)

    def test_malformed_migration_ledger_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            inputs = make_inputs(root)
            inputs["control/migration-ledger.json"].write_text("not-json")
            with self.assertRaisesRegex(mod.BundleError, "migration_ledger_invalid_json"):
                build(root, inputs)

    def test_invalid_identity_fields_are_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            inputs = make_inputs(root)
            with self.assertRaisesRegex(mod.BundleError, "project_ref_invalid"):
                mod.build_bundle(project_ref="BAD", semantic_head=SEMANTIC_HEAD, source_git_sha=GIT_SHA, snapshot_at=SNAPSHOT_AT, inputs=inputs, output_tar=root/"a.tar", output_receipt=root/"a.json")
            with self.assertRaisesRegex(mod.BundleError, "source_git_sha_invalid"):
                mod.build_bundle(project_ref=PROJECT_REF, semantic_head=SEMANTIC_HEAD, source_git_sha="deadbeef", snapshot_at=SNAPSHOT_AT, inputs=inputs, output_tar=root/"b.tar", output_receipt=root/"b.json")
            with self.assertRaisesRegex(mod.BundleError, "snapshot_at_timezone_required"):
                mod.build_bundle(project_ref=PROJECT_REF, semantic_head=SEMANTIC_HEAD, source_git_sha=GIT_SHA, snapshot_at="2026-08-21T15:00:00", inputs=inputs, output_tar=root/"c.tar", output_receipt=root/"c.json")

    def test_modifying_one_input_changes_bundle_sha(self):
        with tempfile.TemporaryDirectory() as ta, tempfile.TemporaryDirectory() as tb:
            ra, rb = Path(ta), Path(tb)
            ia, ib = make_inputs(ra), make_inputs(rb)
            a = build(ra, ia)[2]
            ib["database/data.sql"].write_text("insert into destruktion_meta.example values (2);\n")
            b = build(rb, ib)[2]
            self.assertNotEqual(a["bundle_sha256"], b["bundle_sha256"])


if __name__ == "__main__":
    unittest.main()
