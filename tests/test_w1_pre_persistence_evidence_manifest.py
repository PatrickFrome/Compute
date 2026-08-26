from __future__ import annotations

import copy
import unittest

from controller.w1 import pre_persistence_evidence_manifest as manifest
from controller.w1 import s2_runtime_canary_receipt
from worker.native_linux import h1_h13_prereq_probe
from worker.native_linux import outer_privileged_cgroup_witness
from worker.native_linux import w1_lifecycle_evidence_harness as harness

GIT_SHA = "1" * 40
TREE_SHA = "2" * 40
SENTINEL_SHA = "3" * 64
MACHINE_SHA = "4" * 64
PRE_BOOT = "11111111-1111-4111-8111-111111111111"
POST_BOOT = "22222222-2222-4222-8222-222222222222"


def s2_pass() -> dict:
    output = "\n".join(f"{k}={v}" for k, v in s2_runtime_canary_receipt.PASS_MARKERS.items()) + "\n"
    return s2_runtime_canary_receipt.compose(
        launcher_rc=0,
        output=output,
        source_sha256=harness.EXPECTED_S2_SOURCE_SHA256,
        runner={"run_id": "9", "run_attempt": "1", "runner_os": "Linux", "runner_arch": "X64", "head_sha": GIT_SHA},
    )


def local_capture(phase: str, captured_at: str, boot_id: str) -> dict:
    return {
        "schema": harness.CAPTURE_SCHEMA,
        "phase": phase,
        "captured_at": captured_at,
        "source": {"git_sha": GIT_SHA, "tree_sha": TREE_SHA},
        "linux": True,
        "uname": {"system": "Linux", "node": "worker", "release": "6.8", "version": "#1", "machine": "x86_64"},
        "boot_id": boot_id,
        "machine_id_sha256": MACHINE_SHA,
        "sentinel_sha256": SENTINEL_SHA,
        "namespace_inodes": {"mnt": 1, "pid": 2, "net": 3, "user": 4},
        "cgroup_path": "/metaengine",
        "nonclaims": {"canonical": False, "authority_effect": False, "worker_admitted": False, "w1_verified": False},
    }


def provider_snapshot(state: str, updated_at: str, env: str) -> dict:
    name = "psychic-goggles-p79456q477c6wvq"
    base = f"https://api.github.com/user/codespaces/{name}"
    return {
        "id": 49833829,
        "name": name,
        "environment_id": env,
        "repository": {"full_name": "PatrickFrome/Compute"},
        "machine": {"operating_system": "linux"},
        "updated_at": updated_at,
        "state": state,
        "location": "WestEurope",
        "url": base,
        "start_url": base + "/start",
        "stop_url": base + "/stop",
    }


def lifecycle_bundle() -> dict:
    h1 = {
        "schema": h1_h13_prereq_probe.SCHEMA,
        "checks": {"linux": True, "pidfd_waitid": True, "namespace": True},
        "details": {},
        "ready_for_production_evidence": True,
        "canonical": False,
        "authority_effect": False,
        "worker_admitted": False,
        "w1_verified": False,
    }
    action = {
        "schema": harness.ACTION_SCHEMA,
        "provider_kind": "GITHUB_CODESPACES",
        "action_kind": "STOP_RESUME",
        "requested_at": "2026-08-26T05:00:01Z",
        "completed_at": "2026-08-26T05:00:02Z",
        "nonclaims": {"canonical": False, "authority_effect": False, "worker_admitted": False, "w1_verified": False},
    }
    return harness.compose_codespaces(
        pre_local=local_capture("PRE", "2026-08-26T05:00:00Z", PRE_BOOT),
        post_local=local_capture("POST", "2026-08-26T05:00:03Z", POST_BOOT),
        pre_provider=provider_snapshot("Available", "2026-08-26T04:59:59Z", "env-pre"),
        stopped_provider=provider_snapshot("Shutdown", "2026-08-26T05:00:01Z", "env-stop"),
        post_provider=provider_snapshot("Available", "2026-08-26T05:00:04Z", "env-post"),
        action=action,
        h1_post=h1,
        s2_runtime=s2_pass(),
    )


def eligible_outer_witness() -> dict:
    cgroup_path = "/system.slice/docker-abc.scope"
    return {
        "schema": outer_privileged_cgroup_witness.SCHEMA,
        "mode": "EXECUTE",
        "outcome": "ELIGIBLE_NONAUTHORITY",
        "image_id": "sha256:" + "a" * 64,
        "container_id_sha256": "b" * 64,
        "outer_namespaces": {"pid_ns": 10, "mnt_ns": 11, "net_ns": 12},
        "inner": {"pid_ns": 20, "mnt_ns": 21, "net_ns": 22},
        "inner_checks": {"nonroot": True, "nnp": True, "seccomp": True},
        "two_plane_checks": {"pid_ns_distinct": True, "mnt_ns_distinct": True, "net_ns_distinct": True},
        "security_requests_verified": {"network_none": True, "cap_drop_all": True, "cgroup_private": True},
        "prebound_before_sudo": True,
        "sudo": {"available": True, "uid": "0", "stderr_sha256": None},
        "privilege_scope": "PREBOUND_EXACT_CGROUP_KILL_WRITE_ONLY",
        "sudo_before_exact_binding": False,
        "worker_launch_via_sudo": False,
        "worker_exec_via_sudo": False,
        "cgroup": {
            "path": cgroup_path,
            "path_sha256": manifest._sha256_text(cgroup_path),
            "exact_target_valid": True,
            "target_error": None,
            "limits": {"cpu.max": "100000 100000", "memory.max": "1073741824", "pids.max": "256"},
            "limit_checks": {"cpu_max_limited": True, "memory_max_finite": True, "pids_max_finite": True},
            "pre_events": {"populated": 1},
            "pre_process_count": 2,
            "pre_process_ids_sha256": "c" * 64,
            "sudo_kill_write": {"returncode": 0, "stdout": "1", "stderr_sha256": None, "succeeded": True},
            "post_events": {"populated": 0},
            "post_unpopulated": True,
            "pre_processes_gone": True,
            "docker_running_after": False,
            "tree_kill_proven": True,
        },
        "canonical": False,
        "authority_effect": False,
        "worker_admitted": False,
        "w1_verified": False,
        "requires_persisted_two_plane_composition": True,
    }


class W1PrePersistenceEvidenceManifestTests(unittest.TestCase):
    def test_compose_binds_all_causal_evidence_and_stays_nonauthority(self):
        lifecycle = lifecycle_bundle()
        outer = eligible_outer_witness()
        result = manifest.compose(lifecycle_bundle=lifecycle, outer_cgroup_witness=outer)
        self.assertEqual(result["status"], manifest.STATUS)
        self.assertEqual(result["bindings"]["lifecycle_evidence_sha256"], lifecycle["evidence_sha256"])
        self.assertEqual(result["bindings"]["s2_receipt_sha256"], lifecycle["evidence"]["s2_runtime"]["receipt_sha256"])
        self.assertEqual(result["bindings"]["outer_cgroup_witness_sha256"], manifest.canonical_hash(outer))
        self.assertRegex(result["manifest_sha256"], r"^[0-9a-f]{64}$")
        for key in ("authenticated_provenance_verified", "persisted_readback_verified", "persistent_worker_proof", "worker_admitted", "w1_verified", "canonical", "authority_effect"):
            self.assertFalse(result[key], key)

    def test_manifest_hash_is_deterministic(self):
        first = manifest.compose(lifecycle_bundle=lifecycle_bundle(), outer_cgroup_witness=eligible_outer_witness())
        second = manifest.compose(lifecycle_bundle=lifecycle_bundle(), outer_cgroup_witness=eligible_outer_witness())
        self.assertEqual(first["manifest_sha256"], second["manifest_sha256"])

    def test_lifecycle_evidence_tamper_is_rejected(self):
        lifecycle = lifecycle_bundle()
        lifecycle["evidence"]["local_checks"]["machine_identity_stable"] = False
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            manifest.compose(lifecycle_bundle=lifecycle, outer_cgroup_witness=eligible_outer_witness())

    def test_outer_tree_kill_false_is_rejected(self):
        outer = eligible_outer_witness()
        outer["cgroup"]["tree_kill_proven"] = False
        with self.assertRaisesRegex(ValueError, "tree kill not proven"):
            manifest.compose(lifecycle_bundle=lifecycle_bundle(), outer_cgroup_witness=outer)

    def test_sudo_before_exact_binding_is_rejected(self):
        outer = eligible_outer_witness()
        outer["sudo_before_exact_binding"] = True
        with self.assertRaisesRegex(ValueError, "must be false"):
            manifest.compose(lifecycle_bundle=lifecycle_bundle(), outer_cgroup_witness=outer)

    def test_outer_cgroup_path_hash_rebind_is_rejected(self):
        outer = eligible_outer_witness()
        outer["cgroup"]["path_sha256"] = "d" * 64
        with self.assertRaisesRegex(ValueError, "path hash mismatch"):
            manifest.compose(lifecycle_bundle=lifecycle_bundle(), outer_cgroup_witness=outer)

    def test_outer_witness_claiming_w1_is_rejected(self):
        outer = eligible_outer_witness()
        outer["w1_verified"] = True
        with self.assertRaisesRegex(ValueError, "must be false"):
            manifest.compose(lifecycle_bundle=lifecycle_bundle(), outer_cgroup_witness=outer)


if __name__ == "__main__":
    unittest.main()
