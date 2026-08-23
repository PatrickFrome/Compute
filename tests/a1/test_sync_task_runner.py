import importlib.util
import json
import unittest
from copy import deepcopy
from pathlib import Path

MODULE_PATH = Path(__file__).parents[2] / "coordination" / "sync" / "sync_task_runner.py"
TASK_PATH = Path(__file__).parents[2] / "coordination" / "sync" / "tasks" / "SYNC-L4.7-001.json"
spec = importlib.util.spec_from_file_location("sync_task_runner", MODULE_PATH)
mod = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(mod)


def task():
    return json.loads(TASK_PATH.read_text())


class SyncTaskRunnerTests(unittest.TestCase):
    def test_bootstrap_task_validates(self):
        mod.validate_task(task())

    def test_epoch_hash_mismatch_fails(self):
        value = task()
        value["sync_epoch"]["main_sha"] = "1" * 40
        with self.assertRaisesRegex(ValueError, "sync_epoch_sha256 mismatch"):
            mod.validate_task(value)

    def test_arbitrary_check_is_rejected(self):
        value = task()
        value["required_checks"] = ["RUN_ARBITRARY_SHELL"]
        with self.assertRaisesRegex(ValueError, "unknown typed checks"):
            mod.validate_task(value)

    def test_mutation_domain_is_rejected(self):
        value = task()
        value["mutation_domains"] = ["worker"]
        with self.assertRaisesRegex(ValueError, "must not mutate"):
            mod.validate_task(value)

    def test_authority_effect_is_rejected(self):
        value = task()
        value["authority_effect"] = True
        with self.assertRaisesRegex(ValueError, "non-authority"):
            mod.validate_task(value)

    def test_extra_key_is_rejected(self):
        value = task()
        value["shell"] = "rm -rf /"
        with self.assertRaisesRegex(ValueError, "task keys mismatch"):
            mod.validate_task(value)


if __name__ == "__main__":
    unittest.main()
