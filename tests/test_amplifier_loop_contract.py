import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
POLICY = ROOT / "coordination" / "amplifier-loop" / "AMPLIFIER_LOOP_V1.md"
SEEDS = ROOT / "coordination" / "amplifier-loop" / "seed-amplifiers.json"
REMOTE = ROOT / "supabase" / "functions" / "a2-chat-bridge-remote" / "index.ts"


class AmplifierLoopContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.policy = POLICY.read_text()
        cls.seeds = json.loads(SEEDS.read_text())
        cls.remote = REMOTE.read_text()

    def test_remote_wake_injects_amplifier_loop_for_both_agents(self):
        for needle in [
            "AMPLIFIER_LOOP_V1",
            "meaningful checkpoint, new bottleneck, repeated failure",
            "bounded deep research",
            "reversible bounded PREP/SHADOW/CANARY scope",
            "zero monetary cost",
            "real project or representative CI workload",
            "ACCEPT, KEEP_SHADOW, or ROLLBACK",
            "non-authority learning data",
            "Before C5",
            "C6 governs verified duration/scheduler learning",
            "Do not self-train foundation-model weights",
        ]:
            self.assertIn(needle, self.remote)
        self.assertIn("run AMPLIFIER_LOOP_V1 when its trigger conditions apply", self.remote)
        self.assertIn("function agentForPlatform", self.remote)
        self.assertIn("CHATGPT", self.remote)
        self.assertIn("GLM_ZAI", self.remote)

    def test_policy_preserves_roadmap_authority_and_budget_gates(self):
        self.assertIn("does not change milestone authority", self.policy)
        self.assertIn("PAID_RESOURCE_OR_BUDGET_REQUIRED", self.policy)
        self.assertIn("Before dependent production milestones are satisfied, implementation is PREP/SHADOW/CANARY only", self.policy)
        self.assertIn("not ungoverned model-weight training", self.policy)
        self.assertIn("MUST NOT autonomously retrain or replace foundation-model weights", self.policy)
        self.assertIn("must not be mislabeled as production acceptance", self.policy)

    def test_seed_registry_is_zero_cost_staged_and_license_explicit(self):
        candidates = {item["amplifier_id"]: item for item in self.seeds["candidates"]}
        required = {
            "hyperfine", "pytest-xdist", "sccache", "buildkit-cache",
            "bazel-remote-cache-reapi", "nativelink", "opentelemetry",
        }
        self.assertTrue(required.issubset(candidates))
        for item in candidates.values():
            self.assertTrue(item["zero_cost_mode"])
            self.assertTrue(item["stage"])
            self.assertTrue(item["source"].startswith("https://"))
        self.assertIn("FSL", candidates["nativelink"]["license"])
        self.assertIn("license/compliance review", candidates["nativelink"]["notes"])

    def test_real_use_requires_measurement_and_rollback(self):
        for needle in [
            "median wall-clock duration",
            "cache hit/miss or reuse metrics",
            "external monetary cost",
            "candidate_median <= 0.95 * baseline_median",
            "automatic rollback",
            "context_fingerprint",
            "speedup_ratio",
        ]:
            self.assertIn(needle, self.policy)


if __name__ == "__main__":
    unittest.main()
