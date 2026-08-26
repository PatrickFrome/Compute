from __future__ import annotations

import os
from pathlib import Path
import tempfile
import unittest

from controller.w1 import s2_runtime_canary_receipt
from worker.native_linux import h1_h13_prereq_probe
from worker.native_linux import w1_lifecycle_evidence_harness as harness

GIT_SHA = "1" * 40
TREE_SHA = "2" * 40
SENTINEL_SHA = "3" * 64
MACHINE_SHA = "4" * 64
PRE_BOOT = "11111111-1111-4111-8111-111111111111"
POST_BOOT = "22222222-2222-4222-8222-222222222222"


def local_capture(phase: str, captured_at: str, boot_id: str) -> dict:
    return {
        "schema": harness.CAPTURE_SCHEMA,
        "phase": phase,
        "captured_at": captured_at,
        "source": {"git_sha": GIT_SHA, "tree_sha": TREE_SHA},
        "linux": True,
        "uname": {"system": "Linux", "node": "worker", "release": "6.8.0", "version": "#1", "machine": "x86_64"},
        "boot_id": boot_id,
        "machine_id_sha256": MACHINE_SHA,
        "sentinel_sha256": SENTINEL_SHA,
        "namespace_inodes": {"mnt": 1, "pid": 2, "net": 3, "user": 4},
        "cgroup_path": "/metaengine",
        "nonclaims": {"canonical": False, "authority_effect": False, "worker_admitted": False, "w1_verified": False},
    }


def provider_snapshot(*, state: str, updated_at: str, environment_id: str) -> dict:
    name = "psychic-goggles-p79456q477c6wvq"
    base = f"https://api.github.com/user/codespaces/{name}"
    return {
        "id": 49833829,
        "name": name,
        "environment_id": environment_id,
        "repository": {"full_name": "PatrickFrome/Compute"},
        "machine": {"operating_system": "linux"},
        "updated_at": updated_at,
        "state": state,
        "location": "WestEurope",
        "url": base,
        "start_url": base + "/start",
        "stop_url": base + "/stop",
    }


def action() -> dict:
    return {
        "schema": harness.ACTION_SCHEMA,
        "provider_kind": "GITHUB_CODESPACES",
        "action_kind": "STOP_RESUME",
        "requested_at": "2026-08-26T05:00:01Z",
        "completed_at": "2026-08-26T05:00:02Z",
        "nonclaims": {"canonical": False, "authority_effect": False, "worker_admitted": False, "w1_verified": False},
    }


def h1_pass() -> dict:
    return {
        "schema": h1_h13_prereq_probe.SCHEMA,
        "checks": {"linux": True, "pidfd_waitid": True, "namespace": True},
        "details": {},
        "ready_for_production_evidence": True,
        "canonical": False,
        "authority_effect": False,
        "worker_admitted": False,
        "w1_verified": False,
    }


def s2_pass() -> dict:
    output = "\n".join(
        [
            "EUID=1001",
            "PID=2",
            "PPID=1",
            "WORKER_IS_NOT_PID1=true",
            "PARENT_IS_NAMESPACE_PID1=true",
            "NO_NEW_PRIVS=1",
            "SECCOMP=2",
            "ROOT_FS=tmpfs",
            "OLDROOT_DETACHED=true",
            "WORKSPACE_RW=true",
            "NETWORK_DEFAULT_DENY=true",
            "RLIMIT_CORE_ZERO=true",
            "PID1_ENVIRON_DENIED=true",
            "CANONICAL=false",
            "AUTHORITY_EFFECT=false",
            "WORKER_ADMITTED=false",
            "W1_VERIFIED=false",
        ]
    ) + "\n"
    return s2_runtime_canary_receipt.compose(
        launcher_rc=0,
        output=output,
        source_sha256=harness.EXPECTED_S2_SOURCE_SHA256,
        runner={
            "run_id": "999",
            "run_attempt": "1",
            "runner_os": "Linux",
            "runner_arch": "X64",
            "head_sha": GIT_SHA,
        },
    )


def s2_unavailable() -> dict:
    return s2_runtime_canary_receipt.compose(
        launcher_rc=78,
        output="W1_S2_SANDBOX_UNAVAILABLE: cannot write /proc/self/setgroups: Permission denied\n",
        source_sha256=harness.EXPECTED_S2_SOURCE_SHA256,
        runner={
            "run_id": "999",
            "run_attempt": "1",
            "runner_os": "Linux",
            "runner_arch": "X64",
            "head_sha": GIT_SHA,
        },
    )


class W1LifecycleEvidenceHarnessTests(unittest.TestCase):
    def inputs(self) -> dict:
        return {
            "pre_local": local_capture("PRE", "2026-08-26T05:00:00Z", PRE_BOOT),
            "post_local": local_capture("POST", "2026-08-26T05:00:03Z", POST_BOOT),
            "pre_provider": provider_snapshot(state="Available", updated_at="2026-08-26T04:59:59Z", environment_id="env-pre"),
            "stopped_provider": provider_snapshot(state="Shutdown", updated_at="2026-08-26T05:00:01Z", environment_id="env-stop"),
            "post_provider": provider_snapshot(state="Available", updated_at="2026-08-26T05:00:04Z", environment_id="env-post"),
            "action": action(),
            "h1_post": h1_pass(),
            "s2_runtime": s2_pass(),
        }

    def test_composes_structurally_eligible_evidence_without_authority_claims(self):
        result = harness.compose_codespaces(**self.inputs())
        self.assertEqual(result["outcome"], "W1_LIFECYCLE_EVIDENCE_COMPOSED_NONAUTHORITY")
        self.assertRegex(result["evidence_sha256"], r"^[0-9a-f]{64}$")
        self.assertTrue(result["evidence"]["local_checks"]["s2_runtime_receipt_pass"])
        for key in (
            "provider_identity_verified", "provider_action_verified", "s2_runtime_verified",
            "outer_cgroup_witness_verified", "persisted_readback_verified",
            "persistent_worker_proof", "worker_admitted", "w1_verified", "canonical", "authority_effect",
        ):
            self.assertFalse(result[key], key)
        self.assertIn("authenticated_s2_runtime_receipt_provenance", result["next_required"])
        self.assertIn("prebound_outer_cgroup_witness", result["next_required"])

    def test_unavailable_s2_runtime_is_rejected(self):
        values = self.inputs()
        values["s2_runtime"] = s2_unavailable()
        with self.assertRaisesRegex(ValueError, "PASS required"):
            harness.compose_codespaces(**values)

    def test_s2_source_rebind_is_rejected(self):
        values = self.inputs()
        values["s2_runtime"] = s2_runtime_canary_receipt.compose(
            launcher_rc=0,
            output="\n".join(f"{k}={v}" for k, v in s2_runtime_canary_receipt.PASS_MARKERS.items()) + "\n",
            source_sha256="9" * 64,
            runner={"run_id": "1", "run_attempt": "1", "runner_os": "Linux", "runner_arch": "X64", "head_sha": GIT_SHA},
        )
        with self.assertRaisesRegex(ValueError, "source SHA mismatch"):
            harness.compose_codespaces(**values)

    def test_same_boot_id_is_rejected(self):
        values = self.inputs()
        values["post_local"]["boot_id"] = PRE_BOOT
        with self.assertRaisesRegex(ValueError, "provider-neutral lifecycle evidence rejected"):
            harness.compose_codespaces(**values)

    def test_sentinel_change_is_rejected(self):
        values = self.inputs()
        values["post_local"]["sentinel_sha256"] = "5" * 64
        with self.assertRaisesRegex(ValueError, "provider-neutral lifecycle evidence rejected"):
            harness.compose_codespaces(**values)

    def test_machine_identity_change_is_rejected(self):
        values = self.inputs()
        values["post_local"]["machine_id_sha256"] = "6" * 64
        with self.assertRaisesRegex(ValueError, "machine_identity_stable"):
            harness.compose_codespaces(**values)

    def test_source_change_is_rejected(self):
        values = self.inputs()
        values["post_local"]["source"]["git_sha"] = "7" * 40
        with self.assertRaisesRegex(ValueError, "source identity changed"):
            harness.compose_codespaces(**values)

    def test_h1_failure_is_rejected(self):
        values = self.inputs()
        values["h1_post"]["checks"]["pidfd_waitid"] = False
        values["h1_post"]["ready_for_production_evidence"] = False
        with self.assertRaisesRegex(ValueError, "all H1-H13 prerequisite checks must pass"):
            harness.compose_codespaces(**values)

    def test_action_chronology_is_fail_closed(self):
        values = self.inputs()
        values["action"]["requested_at"] = "2026-08-26T05:00:03Z"
        values["action"]["completed_at"] = "2026-08-26T05:00:02Z"
        with self.assertRaisesRegex(ValueError, "action chronology invalid"):
            harness.compose_codespaces(**values)

    def test_sentinel_creation_is_exclusive_descriptor_bound_and_persistent(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "sentinel.bin"
            first = harness.ensure_persistent_sentinel(path, initialize=True)
            second = harness.ensure_persistent_sentinel(path, initialize=True)
            self.assertEqual(first, second)
            self.assertEqual(path.stat().st_size, harness.SENTINEL_BYTES)
            self.assertEqual(path.stat().st_nlink, 1)
            self.assertEqual(path.stat().st_uid, os.geteuid())

    def test_final_symlink_sentinel_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            real = root / "real"
            real.write_bytes(b"x" * harness.SENTINEL_BYTES)
            link = root / "link"
            link.symlink_to(real)
            with self.assertRaisesRegex(RuntimeError, "open persistent sentinel safely"):
                harness.ensure_persistent_sentinel(link, initialize=False)

    def test_parent_symlink_is_rejected_without_creating_target_file(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            real_parent = root / "real-parent"
            real_parent.mkdir()
            linked_parent = root / "linked-parent"
            linked_parent.symlink_to(real_parent, target_is_directory=True)
            target = real_parent / "sentinel.bin"
            with self.assertRaisesRegex(RuntimeError, "open sentinel parent safely"):
                harness.ensure_persistent_sentinel(linked_parent / "sentinel.bin", initialize=True)
            self.assertFalse(target.exists(), "symlink-parent rejection must happen before creation")

    def test_missing_parent_is_rejected_and_not_created(self):
        with tempfile.TemporaryDirectory() as td:
            missing_parent = Path(td) / "missing"
            with self.assertRaisesRegex(RuntimeError, "open sentinel parent safely"):
                harness.ensure_persistent_sentinel(missing_parent / "sentinel.bin", initialize=True)
            self.assertFalse(missing_parent.exists())

    def test_directory_sentinel_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            directory = Path(td) / "sentinel-dir"
            directory.mkdir()
            with self.assertRaisesRegex(RuntimeError, "regular file"):
                harness.ensure_persistent_sentinel(directory, initialize=False)

    def test_hardlinked_sentinel_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            first = root / "sentinel.bin"
            first.write_bytes(b"x" * harness.SENTINEL_BYTES)
            second = root / "alias.bin"
            os.link(first, second)
            with self.assertRaisesRegex(RuntimeError, "exactly one hard link"):
                harness.ensure_persistent_sentinel(first, initialize=False)

    def test_relative_sentinel_path_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError, "must be absolute"):
            harness.ensure_persistent_sentinel(Path("relative/sentinel.bin"), initialize=True)


if __name__ == "__main__":
    unittest.main()
