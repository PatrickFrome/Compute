from __future__ import annotations

import copy
import hashlib
import unittest

from controller.w1 import codespaces_persistent_storage_guard as guard
from controller.w1 import github_codespaces_snapshot_guard


GIT_SHA = "1" * 40
TREE_SHA = "2" * 40
SENTINEL_SHA = "3" * 64
PRE_BOOT = "11111111-1111-4111-8111-111111111111"
POST_BOOT = "22222222-2222-4222-8222-222222222222"
PATH = "/workspaces/.metaengine-w1/persistent-sentinel.bin"


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


def provider_oracle() -> dict:
    payload = {
        "schema": github_codespaces_snapshot_guard.INPUT_SCHEMA,
        "pre": provider_snapshot(state="Available", updated_at="2026-08-26T05:00:00Z", environment_id="env-pre"),
        "stopped": provider_snapshot(state="Shutdown", updated_at="2026-08-26T05:00:01Z", environment_id="env-stop"),
        "post": provider_snapshot(state="Available", updated_at="2026-08-26T05:00:03Z", environment_id="env-post"),
        "nonclaims": {
            "canonical": False,
            "authority_effect": False,
            "provider_identity_verified": False,
            "provider_action_verified": False,
            "persistent_worker_proof": False,
            "worker_admitted": False,
            "w1_verified": False,
        },
    }
    return github_codespaces_snapshot_guard.evaluate(payload)


def storage_capture(phase: str, boot: str, *, path: str = PATH, sentinel_sha: str = SENTINEL_SHA) -> dict:
    return {
        "schema": guard.CAPTURE_SCHEMA,
        "phase": phase,
        "provider_kind": "GITHUB_CODESPACES",
        "persistent_root": "/workspaces",
        "sentinel_path": path,
        "sentinel_path_sha256": hashlib.sha256(path.encode()).hexdigest(),
        "sentinel_sha256": sentinel_sha,
        "boot_id": boot,
        "source": {"git_sha": GIT_SHA, "tree_sha": TREE_SHA},
        "lifecycle_capture_sha256": "4" * 64,
        "nonclaims": dict(guard.NONCLAIMS),
    }


class CodespacesPersistentStorageGuardTests(unittest.TestCase):
    def test_valid_workspaces_storage_receipt_is_nonauthority(self):
        result = guard.compose(
            pre_storage=storage_capture("PRE", PRE_BOOT),
            post_storage=storage_capture("POST", POST_BOOT),
            provider_oracle=provider_oracle(),
        )
        self.assertEqual(result["outcome"], "CODESPACES_PERSISTENT_STORAGE_BOUND_NONAUTHORITY")
        self.assertEqual(result["evidence"]["persistent_root"], "/workspaces")
        self.assertEqual(result["evidence"]["sentinel_path"], PATH)
        self.assertRegex(result["receipt_sha256"], r"^[0-9a-f]{64}$")
        self.assertFalse(result["provider_storage_contract_verified"])
        self.assertFalse(result["persistent_worker_proof"])
        self.assertFalse(result["w1_verified"])

    def test_path_outside_workspaces_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "strictly below /workspaces"):
            guard.validate_capture(storage_capture("PRE", PRE_BOOT, path="/home/codespace/sentinel.bin"), expected_phase="PRE")

    def test_workspaces_root_itself_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "strictly below /workspaces"):
            guard._persistent_path("/workspaces")

    def test_path_traversal_is_rejected(self):
        with self.assertRaises(ValueError):
            guard._persistent_path("/workspaces/project/../sentinel.bin")

    def test_path_change_across_restart_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "sentinel_path_stable"):
            guard.compose(
                pre_storage=storage_capture("PRE", PRE_BOOT),
                post_storage=storage_capture("POST", POST_BOOT, path="/workspaces/.metaengine-w1/other.bin"),
                provider_oracle=provider_oracle(),
            )

    def test_sentinel_content_change_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "sentinel_content_stable"):
            guard.compose(
                pre_storage=storage_capture("PRE", PRE_BOOT),
                post_storage=storage_capture("POST", POST_BOOT, sentinel_sha="5" * 64),
                provider_oracle=provider_oracle(),
            )

    def test_same_boot_id_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "kernel_boot_id_changed"):
            guard.compose(
                pre_storage=storage_capture("PRE", PRE_BOOT),
                post_storage=storage_capture("POST", PRE_BOOT),
                provider_oracle=provider_oracle(),
            )

    def test_source_rebind_is_rejected(self):
        post = storage_capture("POST", POST_BOOT)
        post["source"]["git_sha"] = "6" * 40
        with self.assertRaisesRegex(ValueError, "source_identity_stable"):
            guard.compose(
                pre_storage=storage_capture("PRE", PRE_BOOT),
                post_storage=post,
                provider_oracle=provider_oracle(),
            )

    def test_provider_oracle_hash_tamper_is_rejected(self):
        provider = provider_oracle()
        provider["evidence"]["provider_object_name"] = "tampered"
        with self.assertRaisesRegex(ValueError, "oracle hash mismatch"):
            guard.compose(
                pre_storage=storage_capture("PRE", PRE_BOOT),
                post_storage=storage_capture("POST", POST_BOOT),
                provider_oracle=provider,
            )

    def test_provider_check_tamper_with_rehashed_oracle_is_rejected(self):
        provider = provider_oracle()
        provider["evidence"]["checks"]["provider_object_id_stable"] = False
        provider["oracle_sha256"] = github_codespaces_snapshot_guard.canonical_hash(provider["evidence"])
        with self.assertRaisesRegex(ValueError, "checks must all pass"):
            guard.compose(
                pre_storage=storage_capture("PRE", PRE_BOOT),
                post_storage=storage_capture("POST", POST_BOOT),
                provider_oracle=provider,
            )

    def test_storage_capture_nonclaim_tamper_is_rejected(self):
        pre = storage_capture("PRE", PRE_BOOT)
        pre["nonclaims"]["w1_verified"] = True
        with self.assertRaisesRegex(ValueError, "nonclaims mismatch"):
            guard.compose(
                pre_storage=pre,
                post_storage=storage_capture("POST", POST_BOOT),
                provider_oracle=provider_oracle(),
            )

    def test_path_hash_tamper_is_rejected(self):
        pre = storage_capture("PRE", PRE_BOOT)
        pre["sentinel_path_sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "path hash mismatch"):
            guard.validate_capture(pre, expected_phase="PRE")


if __name__ == "__main__":
    unittest.main()
