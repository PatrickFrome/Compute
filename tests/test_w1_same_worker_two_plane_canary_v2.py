from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "worker/native_linux/same_worker_two_plane_canary_v2.py"
spec = importlib.util.spec_from_file_location("same_worker_v2", PATH)
assert spec and spec.loader
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class SameWorkerV2Tests(unittest.TestCase):
    def test_dry_plan_is_non_authority_and_hardened(self):
        result = m.dry_plan("python:3.12-alpine", "a" * 40, "b" * 40)
        argv = result["worker_run_argv"]
        flat = " ".join(argv)
        self.assertIn("--network=none", flat)
        self.assertIn("--cap-drop=ALL", flat)
        self.assertIn("no-new-privileges=true", flat)
        self.assertIn("seccomp=builtin", flat)
        self.assertIn("--cgroupns=private", flat)
        self.assertIn("cpu=300:300", flat)
        self.assertIn("as=2147483648:2147483648", flat)
        self.assertIn("dst=/repo,readonly", flat)
        for forbidden in ("--privileged", "--pid=host", "--network=host", "seccomp=unconfined", "--cap-add"):
            self.assertNotIn(forbidden, flat)
        for key in ("canonical", "authority_effect", "safety_verified", "worker_admitted", "w1_verified"):
            self.assertFalse(result[key])

    def test_source_validation_is_strict(self):
        with self.assertRaises(ValueError):
            m.dry_plan("python:3.12-alpine", "bad", "b" * 40)

    def test_code_orders_same_worker_bundle_before_outer_privilege(self):
        text = PATH.read_text()
        bundle = text.index("bundle_cp = subprocess.run")
        prebound = text.index("prebound_ready = bool")
        sudo = text.index("sudo = outer_v2._sudo_root_probe()")
        kill = text.index("kill_result = outer_v2._sudo_write_one(kill_file)")
        self.assertLess(bundle, prebound)
        self.assertLess(prebound, sudo)
        self.assertLess(sudo, kill)
        self.assertIn("bundle_collected_before_outer_privilege", text)

    def test_cleanup_is_not_docker_kill_evidence(self):
        text = PATH.read_text()
        self.assertNotIn('["docker", "kill"', text)
        self.assertIn('["docker", "rm", "-f", name]', text)


if __name__ == "__main__":
    unittest.main()
