import unittest

from coordination.sync import schema_version_policy as p


class SchemaVersionPolicyTests(unittest.TestCase):
    def test_policy_is_stable_non_authority(self):
        first = p.policy_record()
        second = p.policy_record()
        self.assertEqual(first, second)
        self.assertEqual(first["schema"], p.POLICY_SCHEMA)
        self.assertEqual(first["interpretation_policy"], "NO_RETROACTIVE_REINTERPRETATION")
        self.assertTrue(first["historical_completion_is_immutable"])
        self.assertFalse(first["authority_effect"])
        self.assertFalse(first["canonical"])
        neutral = dict(first)
        digest = neutral.pop("policy_sha256")
        self.assertEqual(digest, p.canonical_hash(neutral))

    def test_same_major_keeps_original_validator_binding(self):
        self.assertEqual(
            p.migration_disposition(
                "metaengine.compute.sync-peer-review.h205f22.v2",
                "metaengine.compute.sync-peer-review.h205f22.v2",
            ),
            "SAME_MAJOR__OLD_RECEIPT_REMAINS_BOUND_TO_ORIGINAL_VALIDATOR",
        )

    def test_new_major_requires_new_receipt_without_rewriting_old(self):
        self.assertEqual(
            p.migration_disposition(
                "metaengine.compute.sync-peer-review.h205f22.v2",
                "metaengine.compute.sync-peer-review.h205f22.v3",
            ),
            "NEW_MAJOR__NEW_RECEIPT_REQUIRED__OLD_RECEIPT_UNCHANGED",
        )

    def test_schema_rollback_and_family_change_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "rollback"):
            p.migration_disposition("a.v2", "a.v1")
        with self.assertRaisesRegex(ValueError, "family"):
            p.migration_disposition("a.v1", "b.v2")
        with self.assertRaisesRegex(ValueError, "explicit"):
            p.migration_disposition("a", "a.v2")

    def test_historical_binding_is_exact(self):
        binding = p.HISTORICAL_BINDINGS["SYNC-L4.7-002"]
        self.assertEqual(
            p.validate_historical_binding(
                "SYNC-L4.7-002",
                execution_subject_sha256=binding["execution_subject_sha256"],
                barrier_sha256=binding["barrier_sha256"],
                outcome=binding["outcome"],
            ),
            binding,
        )
        with self.assertRaisesRegex(ValueError, "subject"):
            p.validate_historical_binding(
                "SYNC-L4.7-002",
                execution_subject_sha256="0" * 64,
                barrier_sha256=binding["barrier_sha256"],
                outcome=binding["outcome"],
            )
        with self.assertRaisesRegex(ValueError, "barrier"):
            p.validate_historical_binding(
                "SYNC-L4.7-002",
                execution_subject_sha256=binding["execution_subject_sha256"],
                barrier_sha256="0" * 64,
                outcome=binding["outcome"],
            )


if __name__ == "__main__":
    unittest.main()
