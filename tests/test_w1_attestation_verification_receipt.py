from __future__ import annotations

import copy
import hashlib
import unittest

from controller.w1 import build_w1_prep_attestation_manifest as prep
from controller.w1 import w1_attestation_verification_receipt as receipt


GIT_SHA = "1" * 40
TREE_SHA = "2" * 40
REF = "refs/heads/work/w1-sandbox-launcher-prep"


def manifest() -> dict:
    evidence = {
        "source": {"git_sha": GIT_SHA, "tree_sha": TREE_SHA, "ref": REF},
        "selection_globs": list(prep.INCLUDE_GLOBS),
        "files": [{"path": "controller/w1/a.py", "size_bytes": 1, "sha256": "3" * 64}],
        "file_count": 1,
        "files_sha256": prep.sha256_bytes(prep.canonical_bytes([{"path": "controller/w1/a.py", "size_bytes": 1, "sha256": "3" * 64}])),
    }
    return {
        "schema": prep.SCHEMA,
        "evidence": evidence,
        "evidence_sha256": prep.sha256_bytes(prep.canonical_bytes(evidence)),
        "artifact_attestation_verified": False,
        **prep.NONCLAIMS,
        "next_required": ["github_oidc_sigstore_attestation"],
    }


def verification() -> list[dict]:
    m = manifest()
    subject_sha = hashlib.sha256(receipt.manifest_file_bytes(m)).hexdigest()
    san = f"https://github.com/{receipt.EXPECTED_REPOSITORY}/{receipt.EXPECTED_WORKFLOW_PATH}@{REF}"
    source_uri = f"https://github.com/{receipt.EXPECTED_REPOSITORY}"
    dep_uri = f"git+https://github.com/{receipt.EXPECTED_REPOSITORY}@{REF}"
    cert = {
        "issuer": receipt.OIDC_ISSUER,
        "subjectAlternativeName": san,
        "githubWorkflowRepository": receipt.EXPECTED_REPOSITORY,
        "githubWorkflowSHA": GIT_SHA,
        "githubWorkflowRef": REF,
        "buildSignerURI": san,
        "buildSignerDigest": GIT_SHA,
        "runnerEnvironment": "github-hosted",
        "sourceRepositoryURI": source_uri,
        "sourceRepositoryDigest": GIT_SHA,
        "sourceRepositoryRef": REF,
        "sourceRepositoryVisibilityAtSigning": "public",
        "buildConfigDigest": GIT_SHA,
    }
    statement = {
        "_type": "https://in-toto.io/Statement/v1",
        "subject": [{"name": "w1-prep-attestation-manifest.json", "digest": {"sha256": subject_sha}}],
        "predicateType": receipt.PREDICATE,
        "predicate": {
            "buildDefinition": {
                "externalParameters": {"workflow": {
                    "repository": source_uri,
                    "path": receipt.EXPECTED_WORKFLOW_PATH,
                    "ref": REF,
                }},
                "resolvedDependencies": [{"uri": dep_uri, "digest": {"gitCommit": GIT_SHA}}],
            }
        },
    }
    return [{"verificationResult": {
        "signature": {"certificate": cert},
        "verifiedTimestamps": [{"type": "Tlog", "uri": receipt.REKOR_URI, "timestamp": "2026-08-26T07:05:38Z"}],
        "verifiedIdentity": {"runnerEnvironment": "github-hosted"},
        "statement": statement,
    }}]


class W1AttestationVerificationReceiptTests(unittest.TestCase):
    def test_valid_verified_attestation_yields_nonauthority_receipt(self):
        result = receipt.compose(manifest=manifest(), verification=verification())
        self.assertEqual(result["status"], receipt.STATUS)
        self.assertTrue(result["artifact_attestation_verified"])
        self.assertTrue(result["cryptographic_source_provenance_verified"])
        self.assertFalse(result["runtime_safety_verified"])
        self.assertFalse(result["provider_lifecycle_verified"])
        self.assertFalse(result["persistent_worker_proof"])
        self.assertFalse(result["w1_verified"])
        self.assertFalse(result["authority_effect"])
        self.assertRegex(result["receipt_sha256"], r"^[0-9a-f]{64}$")

    def test_wrong_oidc_issuer_is_rejected(self):
        v = verification()
        v[0]["verificationResult"]["signature"]["certificate"]["issuer"] = "https://evil.example"
        with self.assertRaisesRegex(ValueError, "certificate identity mismatch"):
            receipt.compose(manifest=manifest(), verification=v)

    def test_wrong_signer_workflow_is_rejected(self):
        v = verification()
        v[0]["verificationResult"]["signature"]["certificate"]["subjectAlternativeName"] = "https://github.com/PatrickFrome/Compute/.github/workflows/evil.yml@" + REF
        with self.assertRaisesRegex(ValueError, "certificate identity mismatch"):
            receipt.compose(manifest=manifest(), verification=v)

    def test_self_hosted_runner_is_rejected(self):
        v = verification()
        v[0]["verificationResult"]["signature"]["certificate"]["runnerEnvironment"] = "self-hosted"
        with self.assertRaisesRegex(ValueError, "certificate identity mismatch"):
            receipt.compose(manifest=manifest(), verification=v)

    def test_wrong_source_commit_is_rejected(self):
        v = verification()
        v[0]["verificationResult"]["signature"]["certificate"]["sourceRepositoryDigest"] = "9" * 40
        with self.assertRaisesRegex(ValueError, "certificate identity mismatch"):
            receipt.compose(manifest=manifest(), verification=v)

    def test_missing_rekor_timestamp_is_rejected(self):
        v = verification()
        v[0]["verificationResult"]["verifiedTimestamps"] = []
        with self.assertRaisesRegex(ValueError, "timestamp evidence"):
            receipt.compose(manifest=manifest(), verification=v)

    def test_wrong_subject_digest_is_rejected(self):
        v = verification()
        v[0]["verificationResult"]["statement"]["subject"][0]["digest"]["sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "subject digest"):
            receipt.compose(manifest=manifest(), verification=v)

    def test_wrong_predicate_is_rejected(self):
        v = verification()
        v[0]["verificationResult"]["statement"]["predicateType"] = "https://example.invalid/predicate"
        with self.assertRaisesRegex(ValueError, "SLSA provenance"):
            receipt.compose(manifest=manifest(), verification=v)

    def test_dependency_rebind_is_rejected(self):
        v = verification()
        v[0]["verificationResult"]["statement"]["predicate"]["buildDefinition"]["resolvedDependencies"][0]["digest"]["gitCommit"] = "9" * 40
        with self.assertRaisesRegex(ValueError, "source dependency"):
            receipt.compose(manifest=manifest(), verification=v)

    def test_multiple_verified_attestations_are_rejected(self):
        v = verification()
        with self.assertRaisesRegex(ValueError, "exactly one"):
            receipt.compose(manifest=manifest(), verification=v + copy.deepcopy(v))


if __name__ == "__main__":
    unittest.main()
