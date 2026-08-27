from __future__ import annotations

import copy
import unittest

from controller.w1 import github_codespaces_snapshot_guard as guard


FALSE_NONCLAIMS = {
    "canonical": False,
    "authority_effect": False,
    "provider_identity_verified": False,
    "provider_action_verified": False,
    "persistent_worker_proof": False,
    "worker_admitted": False,
    "w1_verified": False,
}


def snapshot(state: str, updated_at: str, environment_id: str = "env-001"):
    name = "psychic-goggles-p79456q477c6wvq"
    base = f"https://api.github.com/user/codespaces/{name}"
    return {
        "id": 49833829,
        "name": name,
        "environment_id": environment_id,
        "repository": {"full_name": "PatrickFrome/Compute"},
        "machine": {"operating_system": "linux", "cpus": 2},
        "updated_at": updated_at,
        "state": state,
        "location": "WestUs2",
        "url": base,
        "start_url": base + "/start",
        "stop_url": base + "/stop",
        "extra_provider_field": "retained-in-full-snapshot-hash",
    }


def fixture():
    return {
        "schema": guard.INPUT_SCHEMA,
        "pre": snapshot("Available", "2026-08-25T02:00:00Z", "env-pre"),
        "stopped": snapshot("Shutdown", "2026-08-25T02:01:00Z", "env-pre"),
        "post": snapshot("Available", "2026-08-25T02:02:00Z", "env-post"),
        "nonclaims": dict(FALSE_NONCLAIMS),
    }


class GithubCodespacesSnapshotGuardTests(unittest.TestCase):
    def test_valid_sequence_is_nonauthority_only(self):
        result = guard.evaluate(fixture())
        self.assertEqual(result["outcome"], "CODESPACES_SNAPSHOTS_STRUCTURALLY_ELIGIBLE_NONAUTHORITY")
        self.assertEqual(result["evidence"]["provider_object_id"], "49833829")
        self.assertTrue(result["evidence"]["checks"]["provider_session_fingerprint_changed"])
        for key in (
            "input_provenance_verified",
            "provider_identity_verified",
            "provider_action_verified",
            "persisted_readback_verified",
            "persistent_worker_proof",
            "worker_admitted",
            "w1_verified",
            "canonical",
            "authority_effect",
        ):
            self.assertFalse(result[key], key)

    def test_environment_id_change_is_not_required_if_provider_session_material_changes(self):
        value = fixture()
        value["post"]["environment_id"] = value["pre"]["environment_id"]
        result = guard.evaluate(value)
        self.assertEqual(result["outcome"], "CODESPACES_SNAPSHOTS_STRUCTURALLY_ELIGIBLE_NONAUTHORITY")
        self.assertTrue(result["evidence"]["checks"]["provider_session_fingerprint_changed"])

    def test_same_session_material_rejected(self):
        value = fixture()
        value["post"]["environment_id"] = value["pre"]["environment_id"]
        value["post"]["updated_at"] = value["pre"]["updated_at"]
        result = guard.evaluate(value)
        self.assertEqual(result["outcome"], "REJECTED_CODESPACES_SNAPSHOTS")
        self.assertIn("provider_session_fingerprint_changed", result["evidence"]["failures"])
        self.assertIn("provider_updated_at_progresses", result["evidence"]["failures"])

    def test_id_drift_rejected(self):
        value = fixture()
        value["post"]["id"] = 99999999
        result = guard.evaluate(value)
        self.assertIn("provider_object_id_stable", result["evidence"]["failures"])

    def test_name_drift_rejected(self):
        value = fixture()
        value["post"]["name"] = "other-codespace"
        value["post"]["url"] = "https://api.github.com/user/codespaces/other-codespace"
        value["post"]["start_url"] = value["post"]["url"] + "/start"
        value["post"]["stop_url"] = value["post"]["url"] + "/stop"
        result = guard.evaluate(value)
        self.assertIn("provider_object_name_stable", result["evidence"]["failures"])

    def test_repo_drift_rejected(self):
        value = fixture()
        value["post"]["repository"]["full_name"] = "PatrickFrome/Other"
        result = guard.evaluate(value)
        self.assertIn("repository_binding_stable", result["evidence"]["failures"])

    def test_non_linux_rejected(self):
        value = fixture()
        value["post"]["machine"]["operating_system"] = "windows"
        result = guard.evaluate(value)
        self.assertIn("provider_reports_linux", result["evidence"]["failures"])

    def test_state_sequence_rejected(self):
        value = fixture()
        value["stopped"]["state"] = "Available"
        result = guard.evaluate(value)
        self.assertIn("provider_state_sequence_available_shutdown_available", result["evidence"]["failures"])

    def test_time_regression_rejected(self):
        value = fixture()
        value["post"]["updated_at"] = "2026-08-25T01:59:00Z"
        result = guard.evaluate(value)
        self.assertIn("provider_updated_at_progresses", result["evidence"]["failures"])

    def test_bad_lifecycle_url_rejected(self):
        value = fixture()
        value["pre"]["stop_url"] = "https://example.invalid/stop"
        with self.assertRaisesRegex(ValueError, "lifecycle URLs"):
            guard.evaluate(value)

    def test_missing_provider_key_rejected(self):
        value = fixture()
        del value["pre"]["environment_id"]
        with self.assertRaisesRegex(ValueError, "missing keys"):
            guard.evaluate(value)

    def test_authority_escalation_rejected(self):
        for key in FALSE_NONCLAIMS:
            with self.subTest(key=key):
                value = fixture()
                value["nonclaims"][key] = True
                with self.assertRaisesRegex(ValueError, f"{key} must be false"):
                    guard.evaluate(value)

    def test_full_snapshot_hash_covers_extra_provider_fields(self):
        a = fixture()
        b = copy.deepcopy(a)
        b["pre"]["extra_provider_field"] = "changed"
        ra = guard.evaluate(a)
        rb = guard.evaluate(b)
        self.assertNotEqual(ra["evidence"]["pre_snapshot_sha256"], rb["evidence"]["pre_snapshot_sha256"])


if __name__ == "__main__":
    unittest.main()
