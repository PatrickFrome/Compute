import importlib.util
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
EDGE = ROOT / "supabase" / "functions" / "a2-chat-bridge-remote" / "index.ts"
MIGRATION = ROOT / "supabase" / "migrations" / "20260825213000_a2_chat_bridge_remote_runtime_v1.sql"
RLS_MIGRATION = ROOT / "supabase" / "migrations" / "20260825215000_a2_chat_bridge_remote_runtime_rls_deny_v1.sql"
BOOTSTRAP = ROOT / "coordination" / "chat-control-plane" / "extension" / "bootstrap-config.js"
AMPLIFIER_POLICY = ROOT / "coordination" / "amplifier-loop" / "AMPLIFIER_LOOP_V1.md"
AMPLIFIER_SEEDS = ROOT / "coordination" / "amplifier-loop" / "seed-amplifiers.json"
AMPLIFIER_LEARNER = ROOT / "coordination" / "amplifier-loop" / "learner.py"


def load_learner():
    spec = importlib.util.spec_from_file_location("metaengine_amplifier_learner", AMPLIFIER_LEARNER)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


class A2ChatBridgeRemoteContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.edge = EDGE.read_text()
        cls.migration = MIGRATION.read_text()
        cls.rls = RLS_MIGRATION.read_text()
        cls.bootstrap = BOOTSTRAP.read_text()
        cls.amplifier_policy = AMPLIFIER_POLICY.read_text()
        cls.amplifier_seeds = json.loads(AMPLIFIER_SEEDS.read_text())
        cls.learner = load_learner()

    def test_edge_requires_scoped_pairing_hash(self):
        self.assertIn("x-a2-chat-bridge-secret", self.edge)
        self.assertIn("const tokenHash = await sha256(token)", self.edge)
        self.assertIn("active=eq.true", self.edge)
        self.assertIn("bridge_pairing_required", self.edge)
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", self.bootstrap)
        self.assertIn('bridgeSecret: ""', self.bootstrap)

    def test_remote_state_is_metadata_only(self):
        for forbidden_column in ["raw_prompt", "prompt text", "chat_text", "dom_text", "messages json", "snapshot json"]:
            self.assertNotIn(forbidden_column, self.migration.lower())
        self.assertIn("prompt_sha256", self.migration)
        self.assertIn("last_assistant_sha256", self.migration)
        self.assertIn("target_url_sha256", self.migration)
        self.assertIn("message_count", self.migration)
        self.assertIn("authority_effect boolean not null default false check (authority_effect = false)", self.migration)
        persisted_command = self.edge.split("await rest(COMMAND_TABLE", 1)[1].split("return command", 1)[0]
        self.assertIn("prompt_sha256: command.prompt_sha256", persisted_command)
        self.assertNotIn("prompt: command.prompt", persisted_command)
        persisted_peer = self.edge.split("const row = {", 1)[1].split("await rest(`${PEER_TABLE}", 1)[0]
        self.assertNotIn("messages:", persisted_peer)
        self.assertNotIn("snapshot:", persisted_peer)

    def test_current_main_never_learns_from_historical_base_sha(self):
        learner = self.edge.split("function findExplicitMainSha", 1)[1].split("function currentMainFromMessages", 1)[0]
        self.assertIn("current_main_sha", learner)
        self.assertIn("main_sha", learner)
        self.assertNotIn("base_github_sha", learner)
        self.assertIn("item?.relay?.base_github_sha", self.edge)

    def test_wake_idempotency_tracks_stable_peer_generation(self):
        self.assertIn("const IDLE_MS = 5_000;", self.edge)
        self.assertIn("state.changed_at || 'no-change'", self.edge)
        self.assertIn("const wakeKey =", self.edge)
        self.assertNotIn("${state.message_count}:${a2.cursor}:${a2.pendingRelay?.relay?.duel_id", self.edge)
        self.assertIn("same.status === 'COMPLETED'", self.edge)

    def test_a2_visibility_and_non_authority_are_preserved(self):
        for rpc in ["h205f22_a2_interactive_read_v1", "h205f22_a2_macroblock_read_v1", "h205f22_duel_list_peer_relay_pending_v4"]:
            self.assertIn(rpc, self.edge)
        self.assertIn("pending_payloads_exposed", self.edge)
        self.assertIn("OTHER PEER CHAT: REDACTED BY A2 VISIBILITY FENCE", self.edge)
        self.assertIn("authority_effect: false", self.edge)
        self.assertIn("WEB_CHAT_INTERACTIVE_REMOTE", self.edge)
        self.assertNotIn("worker_admitted=true", self.edge.lower())
        self.assertNotIn("w1_verified=true", self.edge.lower())

    def test_amplifier_loop_is_in_every_remote_autonomous_wake(self):
        for needle in [
            "AMPLIFIER_LOOP_V1", "meaningful checkpoint, new bottleneck, repeated failure", "bounded deep research",
            "reversible bounded PREP/SHADOW/CANARY scope", "zero monetary cost", "real project or representative CI workload",
            "ACCEPT, KEEP_SHADOW, or ROLLBACK", "non-authority learning data", "Before C5",
            "C6 governs verified duration/scheduler learning", "Do not self-train foundation-model weights",
            "run AMPLIFIER_LOOP_V1 when its trigger conditions apply",
        ]:
            self.assertIn(needle, self.edge)
        self.assertIn("function agentForPlatform", self.edge)
        self.assertIn("CHATGPT", self.edge)
        self.assertIn("GLM_ZAI", self.edge)

    def test_amplifier_policy_preserves_authority_and_requires_measurement(self):
        for needle in [
            "does not change milestone authority", "PAID_RESOURCE_OR_BUDGET_REQUIRED",
            "Before dependent production milestones are satisfied, implementation is PREP/SHADOW/CANARY only",
            "candidate_median <= 0.95 * baseline_median", "automatic rollback", "context_fingerprint", "speedup_ratio",
            "MUST NOT autonomously retrain or replace foundation-model weights",
        ]:
            self.assertIn(needle, self.amplifier_policy)
        candidates = {item["amplifier_id"]: item for item in self.amplifier_seeds["candidates"]}
        required = {"hyperfine", "pytest-xdist", "sccache", "buildkit-cache", "bazel-remote-cache-reapi", "nativelink", "opentelemetry"}
        self.assertTrue(required.issubset(candidates))
        self.assertIn("FSL", candidates["nativelink"]["license"])
        self.assertIn("license/compliance review", candidates["nativelink"]["notes"])

    def test_learner_selects_measured_candidate_and_honors_rollback(self):
        def record(amplifier, version, speedup, reliability=0.0, verdict="ACCEPT", correctness=True):
            return {
                "amplifier_id": amplifier,
                "candidate_version": version,
                "task_class": "bridge-contract",
                "context_fingerprint": "linux-py311-ci",
                "baseline_metrics": {"median_wall_clock": 10.0},
                "candidate_metrics": {"median_wall_clock": 10.0 / speedup},
                "correctness_pass": correctness,
                "security_pass": True,
                "zero_cost_pass": True,
                "sample_count": 5,
                "verdict": verdict,
                "reliability_delta": reliability,
                "evidence_refs": ["ci:test"],
            }
        records = [record("fast-a", "1", 1.40), record("steady-b", "1", 1.15, reliability=0.2), record("unsafe-c", "1", 5.0, correctness=False)]
        hint = self.learner.recommend(records, "bridge-contract", "linux-py311-ci")
        self.assertFalse(hint["authority_effect"])
        self.assertTrue(hint["strategy_hint_only"])
        self.assertEqual(hint["selected"]["amplifier_id"], "fast-a")
        records.append(record("fast-a", "1", 1.40, verdict="ROLLBACK"))
        hint = self.learner.recommend(records, "bridge-contract", "linux-py311-ci")
        self.assertEqual(hint["selected"]["amplifier_id"], "steady-b")
        self.assertEqual(hint["rollback_blocked_candidate_count"], 1)

    def test_public_browser_roles_are_explicitly_denied(self):
        for table in [
            "compute_fabric_a2_chat_bridge_remote_pairing_h205f22",
            "compute_fabric_a2_chat_bridge_remote_peer_h205f22",
            "compute_fabric_a2_chat_bridge_remote_command_h205f22",
        ]:
            self.assertIn(f"alter table public.{table} enable row level security", self.migration.lower())
            self.assertIn(f"revoke all on table public.{table} from public, anon, authenticated", self.migration.lower())
        self.assertEqual(self.rls.count("to anon, authenticated"), 3)
        self.assertEqual(self.rls.count("using (false)"), 3)
        self.assertEqual(self.rls.count("with check (false)"), 3)

    def test_receipt_persistence_is_not_enabled_by_remote_runtime(self):
        combined = self.migration + "\n" + self.rls + "\n" + self.edge
        self.assertNotIn("compute_fabric_a2_chat_bridge_receipt_h205f22", combined)
        self.assertNotIn("A2_BRIDGE_RECEIPTS_MODE", combined)


if __name__ == "__main__":
    unittest.main()
