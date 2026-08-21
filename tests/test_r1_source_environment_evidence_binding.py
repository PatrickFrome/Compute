import copy
import hashlib
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[1]
MODULE_PATH = ROOT / "controller" / "r1" / "source_environment_evidence_binding.py"
APPROVAL_PATH = ROOT / "controller" / "r1" / "source_environment_approval_evidence.py"

spec = importlib.util.spec_from_file_location("r1_source_environment_evidence_binding", MODULE_PATH)
mod = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(mod)

aspec = importlib.util.spec_from_file_location("r1_source_environment_approval_evidence_for_binding", APPROVAL_PATH)
a = importlib.util.module_from_spec(aspec)
assert aspec and aspec.loader
aspec.loader.exec_module(a)

READINESS_ID = 456
APPROVAL_ID = 457


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


def approval_history(reviewer_id=22, comment="ship"):
    return [{
        "state": "approved",
        "comment": comment,
        "environments": [{"id": 991, "name": mod.SOURCE_ENVIRONMENT}],
        "user": {"id": reviewer_id, "login": "reviewer-user"},
    }]


def approval():
    return a.build_approval_evidence(approval_history(), 11)


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
    def test_readiness_and_approval_are_both_required_and_nonauthoritative(self):
        r = mod.validate_readiness(readiness())
        ap = mod.validate_approval(approval())
        self.assertEqual(r["environment"], mod.SOURCE_ENVIRONMENT)
        self.assertEqual(ap["approved_review_count"], 1)
        self.assertTrue(ap["self_review_absent"])

        bad = readiness()
        bad["prevent_self_review"] = False
        with self.assertRaisesRegex(mod.EnvironmentBindingError, "prevent_self_review"):
            mod.validate_readiness(bad)

        forged = approval()
        forged["r2_proven"] = True
        core = dict(forged); core.pop("approval_receipt_sha256", None)
        forged["approval_receipt_sha256"] = hashlib.sha256(canon(core)).hexdigest()
        with self.assertRaisesRegex(mod.EnvironmentBindingError, "authority_boundary"):
            mod.validate_approval(forged)

    def test_bind_predicate_adds_exact_artifact_ids_and_hashes(self):
        original = predicate()
        old_sha = original["predicate_sha256"]
        bound = mod.bind_predicate(original, readiness(), approval(), READINESS_ID, APPROVAL_ID)
        self.assertNotEqual(old_sha, bound["predicate_sha256"])
        ev = bound["source_environment_evidence"]
        self.assertEqual(ev["configuration"]["artifact_id"], READINESS_ID)
        self.assertEqual(ev["approval"]["artifact_id"], APPROVAL_ID)
        self.assertEqual(ev["approval"]["approved_review_count"], 1)
        checked = mod.validate_bound_predicate(bound, readiness(), approval(), READINESS_ID, APPROVAL_ID)
        self.assertTrue(checked["source_environment_binding_verified"])

    def test_signer_side_validation_rejects_readiness_or_approval_forgery(self):
        bound = mod.bind_predicate(predicate(), readiness(), approval(), READINESS_ID, APPROVAL_ID)
        forged_readiness = readiness()
        forged_readiness["required_reviewer_count"] = 9
        with self.assertRaisesRegex(mod.EnvironmentBindingError, "environment_evidence_mismatch"):
            mod.validate_bound_predicate(bound, forged_readiness, approval(), READINESS_ID, APPROVAL_ID)

        forged_approval = a.build_approval_evidence(approval_history(reviewer_id=33), 11)
        with self.assertRaisesRegex(mod.EnvironmentBindingError, "environment_evidence_mismatch"):
            mod.validate_bound_predicate(bound, readiness(), forged_approval, READINESS_ID, APPROVAL_ID)

        forged = copy.deepcopy(bound)
        forged["source_environment_evidence"]["approval"]["approved_review_count"] = 99
        self_hash(forged, "predicate_sha256")
        with self.assertRaisesRegex(mod.EnvironmentBindingError, "environment_evidence_mismatch"):
            mod.validate_bound_predicate(forged, readiness(), approval(), READINESS_ID, APPROVAL_ID)

    def test_bind_verification_requires_signed_predicate_and_original_evidence(self):
        bound = mod.bind_predicate(predicate(), readiness(), approval(), READINESS_ID, APPROVAL_ID)
        receipt = source_verification(bound)
        result = mod.bind_verification(
            source_verification=receipt,
            verification=gh_verification(bound),
            readiness=readiness(),
            approval=approval(),
            readiness_artifact_id=READINESS_ID,
            approval_artifact_id=APPROVAL_ID,
        )
        env = result["source_environment_evidence"]
        self.assertEqual(env["configuration"]["artifact_id"], READINESS_ID)
        self.assertEqual(env["approval"]["artifact_id"], APPROVAL_ID)
        self.assertEqual(env["approval"]["approved_review_count"], 1)
        self.assertTrue(env["source_environment_binding_verified"])
        core = dict(result); claimed = core.pop("verification_receipt_sha256")
        self.assertEqual(claimed, hashlib.sha256(canon(core)).hexdigest())

    def test_bind_verification_rejects_mismatched_signed_predicate(self):
        bound = mod.bind_predicate(predicate(), readiness(), approval(), READINESS_ID, APPROVAL_ID)
        other = copy.deepcopy(bound)
        other["source"]["run_id"] = 124
        self_hash(other, "predicate_sha256")
        receipt = source_verification(bound)
        with self.assertRaisesRegex(mod.EnvironmentBindingError, "predicate_binding_mismatch"):
            mod.bind_verification(
                source_verification=receipt,
                verification=gh_verification(other),
                readiness=readiness(),
                approval=approval(),
                readiness_artifact_id=READINESS_ID,
                approval_artifact_id=APPROVAL_ID,
            )

    def test_artifact_id_tamper_is_rejected(self):
        bound = mod.bind_predicate(predicate(), readiness(), approval(), READINESS_ID, APPROVAL_ID)
        with self.assertRaisesRegex(mod.EnvironmentBindingError, "environment_evidence_mismatch"):
            mod.validate_bound_predicate(bound, readiness(), approval(), READINESS_ID + 1, APPROVAL_ID)

    def test_bound_predicate_rejects_double_binding(self):
        bound = mod.bind_predicate(predicate(), readiness(), approval(), READINESS_ID, APPROVAL_ID)
        with self.assertRaisesRegex(mod.EnvironmentBindingError, "already_present"):
            mod.bind_predicate(bound, readiness(), approval(), READINESS_ID, APPROVAL_ID)


if __name__ == "__main__":
    unittest.main()
