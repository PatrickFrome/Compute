import copy
import hashlib
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[1]
MODULE_PATH = ROOT / "controller" / "r1" / "source_environment_evidence_binding.py"
spec = importlib.util.spec_from_file_location("r1_source_environment_evidence_binding", MODULE_PATH)
mod = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(mod)


def canon(v):
    return json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def self_hash(v, field):
    core = dict(v)
    core.pop(field, None)
    v[field] = hashlib.sha256(canon(core)).hexdigest()
    return v


def readiness():
    return {
        "schema": mod.READINESS_SCHEMA,
        "environment": mod.SOURCE_ENVIRONMENT,
        "required_reviewer_count": 2,
        "prevent_self_review": True,
        "branch_policy": {"protected_branches": True, "custom_branch_policies": False},
        "ready_for_source_generation": True,
        "authority_effect": False,
        "r2_proven": False,
        "persisted_seal_allowed": False,
    }


def predicate():
    value = {
        "schema": mod.PREDICATE_SCHEMA,
        "classification": mod.BOUND_PREDICATE_CLASSIFICATION,
        "source": {
            "repository_id": 1341371143,
            "repository": "PatrickFrome/Compute",
            "workflow_path": ".github/workflows/r1-live-recovery-source.yml",
            "head_sha": "1" * 40,
            "run_id": 123,
            "run_attempt": 1,
            "event": "workflow_dispatch",
            "ref": "refs/heads/main",
            "environment": mod.SOURCE_ENVIRONMENT,
        },
        "database_export": {"semantic_head": "metaengine-h205f22-recovery-dev-20260821-cp072"},
        "ciphertext": {"sha256": "a" * 64, "bytes": 123},
        "coverage": {"storage_api_object_bytes_included": False},
        "authority": {
            "source_attestation_candidate": True,
            "source_attestation_verified_by_consumer": False,
            "authority_effect": False,
            "r2_proven": False,
            "r3_proven": False,
            "persisted_seal_allowed": False,
        },
        "required_next": "CONSUMER_VERIFY_SIGSTORE_BUNDLE_BEFORE_PROVIDER_CREDENTIALS_THEN_TWO_DOMAIN_VERSION_PINNED_READBACK",
    }
    return self_hash(value, "predicate_sha256")


def source_verification(bound_predicate):
    value = {
        "schema": mod.VERIFICATION_SCHEMA,
        "classification": mod.VERIFICATION_CLASSIFICATION,
        "source": {
            "repository_id": 1341371143,
            "repository": "PatrickFrome/Compute",
            "workflow_path": ".github/workflows/r1-live-recovery-source.yml",
            "head_sha": "1" * 40,
            "run_id": 123,
        },
        "predicate_type": "https://github.com/PatrickFrome/Compute/attestations/r1-recovery-source/v1",
        "predicate_sha256": bound_predicate["predicate_sha256"],
        "ciphertext_sha256": "a" * 64,
        "ciphertext_bytes": 123,
        "envelope_receipt_sha256": "b" * 64,
        "semantic_head_at_source": "metaengine-h205f22-recovery-dev-20260821-cp072",
        "canonical_digest_at_source": "c" * 64,
        "migration_ledger_sha256": "d" * 64,
        "verified_timestamp_count": 1,
        "source_attestation_verified": True,
        "authority_effect": False,
        "r2_proven": False,
        "r3_proven": False,
        "persisted_seal_allowed": False,
        "final_r2_evidence_binding_required": True,
    }
    return self_hash(value, "verification_receipt_sha256")


def gh_verification(bound_predicate):
    return [{
        "verificationResult": {
            "verifiedTimestamps": [{"type": "tlog"}],
            "statement": {
                "_type": "https://in-toto.io/Statement/v1",
                "subject": [{"name": "r1-recovery-ciphertext.age", "digest": {"sha256": "a" * 64}}],
                "predicateType": "https://github.com/PatrickFrome/Compute/attestations/r1-recovery-source/v1",
                "predicate": bound_predicate,
            },
        }
    }]


class SourceEnvironmentEvidenceBindingTests(unittest.TestCase):
    def test_readiness_requires_real_protection_shape_and_nonauthority(self):
        result = mod.validate_readiness(readiness())
        self.assertEqual(result["environment"], mod.SOURCE_ENVIRONMENT)
        self.assertEqual(result["required_reviewer_count"], 2)
        self.assertRegex(result["readiness_sha256"], r"^[0-9a-f]{64}$")

        bad = readiness()
        bad["prevent_self_review"] = False
        with self.assertRaisesRegex(mod.EnvironmentBindingError, "prevent_self_review"):
            mod.validate_readiness(bad)

        bad = readiness()
        bad["authority_effect"] = True
        with self.assertRaisesRegex(mod.EnvironmentBindingError, "authority_boundary"):
            mod.validate_readiness(bad)

    def test_bind_predicate_adds_exact_readiness_hash_and_rehashes(self):
        original = predicate()
        old_sha = original["predicate_sha256"]
        bound = mod.bind_predicate(original, readiness())
        self.assertNotEqual(old_sha, bound["predicate_sha256"])
        self.assertEqual(
            bound["source_environment_evidence"]["readiness_sha256"],
            hashlib.sha256(canon(readiness())).hexdigest(),
        )
        checked = mod.validate_bound_predicate(bound, readiness())
        self.assertTrue(checked["source_environment_binding_verified"])

    def test_signer_side_validation_rejects_source_build_forgery(self):
        bound = mod.bind_predicate(predicate(), readiness())
        forged_readiness = readiness()
        forged_readiness["required_reviewer_count"] = 9
        with self.assertRaisesRegex(mod.EnvironmentBindingError, "environment_evidence_mismatch"):
            mod.validate_bound_predicate(bound, forged_readiness)

        forged = copy.deepcopy(bound)
        forged["source_environment_evidence"]["required_reviewer_count"] = 99
        self_hash(forged, "predicate_sha256")
        with self.assertRaisesRegex(mod.EnvironmentBindingError, "environment_evidence_mismatch"):
            mod.validate_bound_predicate(forged, readiness())

    def test_bind_verification_requires_signed_predicate_and_original_readiness(self):
        bound = mod.bind_predicate(predicate(), readiness())
        receipt = source_verification(bound)
        result = mod.bind_verification(
            source_verification=receipt,
            verification=gh_verification(bound),
            readiness=readiness(),
            readiness_artifact_id=456,
        )
        env = result["source_environment_evidence"]
        self.assertEqual(env["artifact_id"], 456)
        self.assertEqual(env["artifact_name"], mod.READINESS_ARTIFACT_NAME)
        self.assertTrue(env["source_environment_binding_verified"])
        self.assertRegex(result["verification_receipt_sha256"], r"^[0-9a-f]{64}$")
        core = dict(result)
        claimed = core.pop("verification_receipt_sha256")
        self.assertEqual(claimed, hashlib.sha256(canon(core)).hexdigest())

    def test_bind_verification_rejects_mismatched_signed_predicate(self):
        bound = mod.bind_predicate(predicate(), readiness())
        other = copy.deepcopy(bound)
        other["source"]["run_id"] = 124
        self_hash(other, "predicate_sha256")
        receipt = source_verification(bound)
        with self.assertRaisesRegex(mod.EnvironmentBindingError, "predicate_binding_mismatch"):
            mod.bind_verification(
                source_verification=receipt,
                verification=gh_verification(other),
                readiness=readiness(),
                readiness_artifact_id=456,
            )

    def test_bind_verification_rejects_authority_escalation(self):
        bound = mod.bind_predicate(predicate(), readiness())
        receipt = source_verification(bound)
        receipt["r2_proven"] = True
        self_hash(receipt, "verification_receipt_sha256")
        with self.assertRaisesRegex(mod.EnvironmentBindingError, "authority_boundary"):
            mod.bind_verification(
                source_verification=receipt,
                verification=gh_verification(bound),
                readiness=readiness(),
                readiness_artifact_id=456,
            )

    def test_bound_predicate_rejects_double_binding(self):
        bound = mod.bind_predicate(predicate(), readiness())
        with self.assertRaisesRegex(mod.EnvironmentBindingError, "already_present"):
            mod.bind_predicate(bound, readiness())


if __name__ == "__main__":
    unittest.main()
