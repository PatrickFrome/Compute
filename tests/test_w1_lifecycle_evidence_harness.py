from __future__ import annotations

import copy
from pathlib import Path
import tempfile
import unittest

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
        }

    def test_composes_structurally_eligible_evidence_without_authority_claims(self):
        result = harness.compose_codespaces(**self.inputs())
        self.assertEqual(result["outcome"], "W1_LIFECYCLE_EVIDENCE_COMPOSED_NONAUTHORITY")
        self.assertRegex(result["evidence_sha256"], r"^[0-9a-f]{64}$")
        for key in (
            "provider_identity_verified", "provider_action_verified", "s2_runtime_verified",
            "outer_cgroup_witness_verified", "persisted_readback_verified",
            "persistent_worker_proof", "worker_admitted", "w1_verified", "canonical", "authority_effect",
        ):
            self.assertFalse(result[key], key)
        self.assertIn("live_s2_runtime_canaries", result["next_required"])
        self.assertIn("prebound_outer_cgroup_witness", result["next_required"])

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

    def test_sentinel_creation_is_exclusive_and_persistent(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "sentinel.bin"
            first = harness.ensure_persistent_sentinel(path, initialize=True)
            second = harness.ensure_persistent_sentinel(path, initialize=True)
            self.assertEqual(first, second)
            self.assertEqual(path.stat().st_size, harness.SENTINEL_BYTES)

    def test_symlink_sentinel_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            real = root / "real"
            real.write_bytes(b"x" * harness.SENTINEL_BYTES)
            link = root / "link"
            link.symlink_to(real)
            with self.assertRaisesRegex(RuntimeError, "non-symlink"):
                harness.ensure_persistent_sentinel(link, initialize=False)


if __name__ == "__main__":
    unittest.main()
