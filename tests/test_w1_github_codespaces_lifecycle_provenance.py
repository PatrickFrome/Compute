from __future__ import annotations

import os
import unittest
from unittest import mock

from controller.w1 import github_codespaces_lifecycle_provenance as provenance
from controller.w1 import github_codespaces_snapshot_guard


NAME = "psychic-goggles-p79456q477c6wvq"
REPO = "PatrickFrome/Compute"


def snapshot(*, state: str, updated_at: str, environment_id: str = "env-1", ident: int = 49833829) -> dict:
    base = f"https://api.github.com/user/codespaces/{NAME}"
    return {
        "id": ident,
        "name": NAME,
        "environment_id": environment_id,
        "repository": {"full_name": REPO},
        "machine": {"operating_system": "linux"},
        "updated_at": updated_at,
        "state": state,
        "location": "WestEurope",
        "url": base,
        "start_url": base + "/start",
        "stop_url": base + "/stop",
    }


def observation(*, kind: str, method: str, url: str, snap: dict, body_sha: str = "a" * 64) -> dict:
    return {
        "kind": kind,
        "method": method,
        "url": url,
        "requested_at": "2026-08-26T06:00:00Z",
        "completed_at": "2026-08-26T06:00:01Z",
        "http_status": 200,
        "response_body_sha256": body_sha,
        "response_headers": {"date": "Wed, 26 Aug 2026 06:00:01 GMT"},
        "selected_snapshot": snap,
        "selected_snapshot_sha256": github_codespaces_snapshot_guard.canonical_hash(snap),
    }


def valid_observations() -> dict:
    pre = snapshot(state="Available", updated_at="2026-08-26T05:59:59Z", environment_id="env-pre")
    stop = snapshot(state="Available", updated_at="2026-08-26T06:00:00Z", environment_id="env-pre")
    stopped = snapshot(state="Shutdown", updated_at="2026-08-26T06:00:02Z", environment_id="env-stop")
    start = snapshot(state="Shutdown", updated_at="2026-08-26T06:00:03Z", environment_id="env-stop")
    post = snapshot(state="Available", updated_at="2026-08-26T06:00:05Z", environment_id="env-post")
    return {
        "pre": observation(kind="pre_get", method="GET", url=provenance._endpoint(NAME), snap=pre),
        "stop": observation(kind="stop_post", method="POST", url=provenance._endpoint(NAME, "/stop"), snap=stop, body_sha="b" * 64),
        "stopped": observation(kind="poll_shutdown", method="GET", url=provenance._endpoint(NAME), snap=stopped, body_sha="c" * 64),
        "start": observation(kind="start_post", method="POST", url=provenance._endpoint(NAME, "/start"), snap=start, body_sha="d" * 64),
        "post": observation(kind="poll_available", method="GET", url=provenance._endpoint(NAME), snap=post, body_sha="e" * 64),
    }


class GitHubCodespacesLifecycleProvenanceTests(unittest.TestCase):
    def test_dry_plan_is_exact_nonmutating_and_explicitly_blocked(self):
        plan = provenance.dry_plan(name=NAME, repo=REPO, token_env="GITHUB_TOKEN")
        self.assertEqual(plan["mode"], "DRY_RUN")
        self.assertEqual(plan["api_version"], "2026-03-10")
        self.assertEqual(plan["sequence"][0]["url"], provenance._endpoint(NAME))
        self.assertEqual(plan["sequence"][1]["url"], provenance._endpoint(NAME, "/stop"))
        self.assertEqual(plan["sequence"][3]["url"], provenance._endpoint(NAME, "/start"))
        self.assertFalse(plan["provider_mutation_performed"])
        self.assertFalse(plan["authority_effect"])
        self.assertFalse(plan["w1_verified"])
        self.assertFalse(plan["local_execute_available"])
        self.assertEqual(plan["execute_block"], provenance.EXECUTE_BLOCK)
        self.assertIn("externally verified W1 dispatch receipt", " ".join(plan["execute_requires"]))
        self.assertEqual(plan["token_source"]["kind"], "ENVIRONMENT_VARIABLE")
        self.assertEqual(plan["token_source"]["name"], "GITHUB_TOKEN")
        self.assertFalse(plan["token_source"]["material_persisted"])
        self.assertNotIn("value", plan["token_source"])
        self.assertNotIn("material", plan["token_source"])

    def test_valid_external_observations_compose_nonauthority_receipt(self):
        obs = valid_observations()
        result = provenance.compose_execute_receipt(name=NAME, repo=REPO, **obs)
        self.assertEqual(result["mode"], "EXTERNAL_CAPTURE_READBACK")
        self.assertEqual(result["outcome"], "CAPTURED_NONAUTHORITY")
        self.assertTrue(result["api_authentication_observed"])
        self.assertFalse(result["provider_action_verified"])
        self.assertFalse(result["authenticated_provider_provenance_verified"])
        self.assertFalse(result["persistent_worker_proof"])
        self.assertFalse(result["w1_verified"])
        self.assertRegex(result["receipt_sha256"], r"^[0-9a-f]{64}$")
        self.assertEqual(result["evidence"]["api_version"], "2026-03-10")
        self.assertTrue(result["evidence"]["checks"]["token_not_persisted"])

    def test_wrong_state_sequence_is_rejected(self):
        obs = valid_observations()
        obs["stopped"]["selected_snapshot"]["state"] = "Available"
        obs["stopped"]["selected_snapshot_sha256"] = github_codespaces_snapshot_guard.canonical_hash(obs["stopped"]["selected_snapshot"])
        with self.assertRaisesRegex(ValueError, "state sequence"):
            provenance.compose_execute_receipt(name=NAME, repo=REPO, **obs)

    def test_provider_id_drift_is_rejected(self):
        obs = valid_observations()
        obs["post"]["selected_snapshot"]["id"] = 999
        obs["post"]["selected_snapshot_sha256"] = github_codespaces_snapshot_guard.canonical_hash(obs["post"]["selected_snapshot"])
        with self.assertRaisesRegex(ValueError, "identity changed"):
            provenance.compose_execute_receipt(name=NAME, repo=REPO, **obs)

    def test_stop_endpoint_substitution_is_rejected(self):
        obs = valid_observations()
        obs["stop"]["url"] = provenance._endpoint(NAME, "/start")
        with self.assertRaisesRegex(ValueError, "stop action endpoint mismatch"):
            provenance.compose_execute_receipt(name=NAME, repo=REPO, **obs)

    def test_start_method_substitution_is_rejected(self):
        obs = valid_observations()
        obs["start"]["method"] = "GET"
        with self.assertRaisesRegex(ValueError, "start action endpoint mismatch"):
            provenance.compose_execute_receipt(name=NAME, repo=REPO, **obs)

    def test_selected_snapshot_hash_tamper_is_rejected(self):
        obs = valid_observations()
        obs["pre"]["selected_snapshot_sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "selected snapshot hash mismatch"):
            provenance.compose_execute_receipt(name=NAME, repo=REPO, **obs)

    def test_body_hash_shape_is_required(self):
        obs = valid_observations()
        obs["pre"]["response_body_sha256"] = "not-a-hash"
        with self.assertRaisesRegex(ValueError, "body hash invalid"):
            provenance.compose_execute_receipt(name=NAME, repo=REPO, **obs)

    def test_wrong_repo_is_rejected(self):
        obs = valid_observations()
        with self.assertRaisesRegex(ValueError, "identity mismatch"):
            provenance.compose_execute_receipt(name=NAME, repo="PatrickFrome/Other", **obs)

    def test_invalid_codespace_suffix_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "unsupported Codespaces lifecycle suffix"):
            provenance._endpoint(NAME, "/delete")

    def test_execute_is_blocked_even_with_legacy_flag_and_token(self):
        env = {provenance.EXECUTE_ENV: "1", "GITHUB_TOKEN": "synthetic-not-used"}
        with mock.patch.dict(os.environ, env, clear=True):
            with self.assertRaisesRegex(RuntimeError, provenance.EXECUTE_BLOCK):
                provenance.execute(name=NAME, repo=REPO, token_env="GITHUB_TOKEN", timeout_seconds=120)

    def test_execute_block_precedes_token_or_network_semantics(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, provenance.EXECUTE_BLOCK):
                provenance.execute(name=NAME, repo=REPO, token_env="MISSING_TOKEN", timeout_seconds=1)
        self.assertFalse(hasattr(provenance, "_call"), "local network mutator must not exist in PREP collector")
        self.assertFalse(hasattr(provenance, "_poll_state"), "local lifecycle poller must not exist in PREP collector")


if __name__ == "__main__":
    unittest.main()
