import importlib.util
import pathlib
import unittest

MODULE_PATH = pathlib.Path(__file__).parents[2] / "coordination" / "e2b" / "prepared_smoke.py"
spec = importlib.util.spec_from_file_location("e2b_prepared_smoke", MODULE_PATH)
mod = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(mod)


class E2BPreparedSmokeTests(unittest.TestCase):
    def base_manifest(self, **overrides):
        args = dict(
            sandbox_id="sbx_test_123",
            expected_git_sha="a" * 40,
            source_archive_sha256="b" * 64,
            fingerprint={"os": "linux", "arch": "x86_64", "effective_uid": 1000},
            network_negative_canary_blocked=True,
            schema_check_passed=True,
            compile_smoke_passed=True,
            destroy_confirmed=True,
        )
        args.update(overrides)
        return mod.build_manifest(**args)

    def test_manifest_is_non_authority_and_not_w1(self):
        m = self.base_manifest()
        self.assertEqual(m["mode"], "PREPARE_ONLY")
        self.assertFalse(m["authority"]["execution_authority"])
        self.assertFalse(m["authority"]["canonical"])
        self.assertFalse(m["authority"]["authority_effect"])
        self.assertFalse(m["authority"]["persistent_worker_proof"])
        self.assertFalse(m["authority"]["w1_verified"])
        self.assertEqual(m["backend"]["session_persistence_class"], "EPHEMERAL_MICROVM")

    def test_network_must_be_fail_closed(self):
        with self.assertRaises(ValueError):
            self.base_manifest(network_negative_canary_blocked=False)

    def test_required_smoke_checks_must_pass(self):
        with self.assertRaises(ValueError):
            self.base_manifest(schema_check_passed=False)
        with self.assertRaises(ValueError):
            self.base_manifest(compile_smoke_passed=False)

    def test_destroy_must_be_confirmed(self):
        with self.assertRaises(ValueError):
            self.base_manifest(destroy_confirmed=False)

    def test_secret_like_key_is_rejected(self):
        with self.assertRaises(ValueError):
            mod.assert_no_secrets({"api_key": "not-even-a-real-secret"})

    def test_secret_like_value_is_rejected(self):
        with self.assertRaises(ValueError):
            mod.assert_no_secrets({"note": "e2b_abcdefghijklmnopqrstuvwxyz123456"})

    def test_valid_git_sha(self):
        self.assertEqual(mod.validate_expected_sha("A" * 40), "a" * 40)
        with self.assertRaises(ValueError):
            mod.validate_expected_sha("abc")

    def test_provider_claim_is_not_independent_attestation(self):
        m = self.base_manifest()
        self.assertEqual(m["backend"]["provider_isolation_claim"], "FIRECRACKER_MICROVM")
        self.assertFalse(m["backend"]["independent_hypervisor_attestation"])


if __name__ == "__main__":
    unittest.main()
