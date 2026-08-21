import copy
import hashlib
import json
import unittest
from datetime import datetime, timedelta, timezone

from controller.r1.provider_configuration_readiness import (
    AWS_DESTRUCTIVE_DENY_ACTIONS,
    AWS_OBJECT_ACTIONS,
    B2_REQUIRED_CAPABILITIES,
    RECOVERY_PREFIX,
    ReadinessError,
    build_aws_session_policy,
    validate_aws_readiness,
    validate_b2_readiness,
)

NOW = datetime(2026, 8, 21, 18, 40, tzinfo=timezone.utc)
AWS_BUCKET = "metaengine-r1-proof-a"
AWS_ACCOUNT = "123456789012"
B2_BUCKET = "metaengine-r1-proof-b"
B2_ACCOUNT = "b2-account-h205f22"
B2_ACCOUNT_HASH = hashlib.sha256(B2_ACCOUNT.encode()).hexdigest()
B2_ENDPOINT = "s3.us-west-004.backblazeb2.com"


class ProviderConfigurationReadinessTests(unittest.TestCase):
    def aws_versioning(self):
        return {"Status": "Enabled", "MFADelete": "Disabled"}

    def aws_lock(self):
        return {
            "ObjectLockEnabled": "Enabled",
            "Rule": {"DefaultRetention": {"Mode": "COMPLIANCE", "Days": 30}},
        }

    def aws_lifecycle(self):
        return {"Rules": []}

    def b2_authorization(self, *, extra=None, missing=None, hours=2):
        caps = set(B2_REQUIRED_CAPABILITIES)
        if extra:
            caps.update(extra)
        if missing:
            caps.difference_update(missing)
        return {
            "accountId": B2_ACCOUNT,
            "apiInfo": {
                "storageApi": {
                    "apiUrl": "https://api004.backblazeb2.com",
                    "s3ApiUrl": f"https://{B2_ENDPOINT}",
                    "allowed": {
                        "buckets": [{"id": "bucket-id", "name": B2_BUCKET}],
                        "capabilities": sorted(caps),
                        "namePrefix": RECOVERY_PREFIX,
                    },
                }
            },
            "applicationKeyExpirationTimestamp": int((NOW + timedelta(hours=hours)).timestamp() * 1000),
            "authorizationToken": "never-persist-this",
        }

    def b2_buckets(self):
        return {
            "buckets": [
                {
                    "accountId": B2_ACCOUNT,
                    "bucketId": "bucket-id",
                    "bucketName": B2_BUCKET,
                    "bucketType": "allPrivate",
                    "fileLockConfiguration": {
                        "isClientAuthorizedToRead": True,
                        "value": {
                            "defaultRetention": {"mode": None, "period": None},
                            "isFileLockEnabled": True,
                        },
                    },
                    "lifecycleRules": [],
                    "options": ["s3"],
                    "revision": 7,
                }
            ]
        }

    def test_aws_exact_session_policy_is_prefix_scoped_and_destructive_denied(self):
        policy = build_aws_session_policy(AWS_BUCKET)
        text = json.dumps(policy, sort_keys=True)
        self.assertNotIn('"Action": "*"', text)
        self.assertNotIn('"Resource": "*"', text)
        statements = {s["Sid"]: s for s in policy["Statement"]}
        obj = statements["ReadWriteExactRecoveryPrefix"]
        self.assertEqual(set(obj["Action"]), set(AWS_OBJECT_ACTIONS))
        self.assertEqual(obj["Resource"], f"arn:aws:s3:::{AWS_BUCKET}/{RECOVERY_PREFIX}*")
        deny = statements["DenyDestructiveRecoveryMutations"]
        self.assertEqual(set(deny["Action"]), set(AWS_DESTRUCTIVE_DENY_ACTIONS))
        self.assertEqual(deny["Effect"], "Deny")

    def test_aws_ready_with_no_conflicting_lifecycle(self):
        result = validate_aws_readiness(
            versioning=self.aws_versioning(),
            object_lock=self.aws_lock(),
            lifecycle=self.aws_lifecycle(),
            bucket=AWS_BUCKET,
            account_id=AWS_ACCOUNT,
            session_policy=build_aws_session_policy(AWS_BUCKET),
        )
        self.assertTrue(result["ready_for_step05a_candidate_generation"])
        self.assertTrue(result["session_policy_destructive_actions_denied"])
        self.assertFalse(result["r2_proven"])
        self.assertFalse(result["persisted_seal_allowed"])

    def test_aws_suspended_versioning_and_disabled_object_lock_rejected(self):
        with self.assertRaisesRegex(ReadinessError, "versioning_not_enabled"):
            validate_aws_readiness(
                versioning={"Status": "Suspended"},
                object_lock=self.aws_lock(),
                lifecycle=self.aws_lifecycle(),
                bucket=AWS_BUCKET,
                account_id=AWS_ACCOUNT,
                session_policy=build_aws_session_policy(AWS_BUCKET),
            )
        with self.assertRaisesRegex(ReadinessError, "object_lock_not_enabled"):
            validate_aws_readiness(
                versioning=self.aws_versioning(),
                object_lock={},
                lifecycle=self.aws_lifecycle(),
                bucket=AWS_BUCKET,
                account_id=AWS_ACCOUNT,
                session_policy=build_aws_session_policy(AWS_BUCKET),
            )

    def test_aws_lifecycle_overlap_rejected_but_unrelated_prefix_allowed(self):
        bad = {
            "Rules": [
                {
                    "ID": "expire-recovery",
                    "Status": "Enabled",
                    "Filter": {"Prefix": RECOVERY_PREFIX},
                    "Expiration": {"Days": 30},
                }
            ]
        }
        with self.assertRaisesRegex(ReadinessError, "lifecycle_conflict:expire-recovery"):
            validate_aws_readiness(
                versioning=self.aws_versioning(),
                object_lock=self.aws_lock(),
                lifecycle=bad,
                bucket=AWS_BUCKET,
                account_id=AWS_ACCOUNT,
                session_policy=build_aws_session_policy(AWS_BUCKET),
            )
        safe = copy.deepcopy(bad)
        safe["Rules"][0]["Filter"]["Prefix"] = "unrelated/"
        result = validate_aws_readiness(
            versioning=self.aws_versioning(),
            object_lock=self.aws_lock(),
            lifecycle=safe,
            bucket=AWS_BUCKET,
            account_id=AWS_ACCOUNT,
            session_policy=build_aws_session_policy(AWS_BUCKET),
        )
        self.assertTrue(result["ready_for_step05a_candidate_generation"])

    def test_aws_tag_only_or_unknown_filter_fails_conservatively(self):
        lifecycle = {
            "Rules": [
                {
                    "ID": "tag-expire",
                    "Status": "Enabled",
                    "Filter": {"Tag": {"Key": "class", "Value": "temp"}},
                    "Expiration": {"Days": 1},
                }
            ]
        }
        with self.assertRaisesRegex(ReadinessError, "tag-expire"):
            validate_aws_readiness(
                versioning=self.aws_versioning(),
                object_lock=self.aws_lock(),
                lifecycle=lifecycle,
                bucket=AWS_BUCKET,
                account_id=AWS_ACCOUNT,
                session_policy=build_aws_session_policy(AWS_BUCKET),
            )

    def test_aws_tampered_session_policy_rejected(self):
        policy = build_aws_session_policy(AWS_BUCKET)
        policy["Statement"][1]["Action"].append("s3:DeleteObject")
        with self.assertRaisesRegex(ReadinessError, "session_policy_not_exact_contract"):
            validate_aws_readiness(
                versioning=self.aws_versioning(),
                object_lock=self.aws_lock(),
                lifecycle=self.aws_lifecycle(),
                bucket=AWS_BUCKET,
                account_id=AWS_ACCOUNT,
                session_policy=policy,
            )

    def test_b2_ready_requires_runtime_scope_lock_and_private_bucket(self):
        result = validate_b2_readiness(
            authorization=self.b2_authorization(),
            buckets_response=self.b2_buckets(),
            expected_bucket=B2_BUCKET,
            expected_endpoint_host=B2_ENDPOINT,
            expected_account_scope_sha256=B2_ACCOUNT_HASH,
            now=NOW,
        )
        self.assertTrue(result["object_lock_enabled"])
        self.assertTrue(result["ready_for_step05a_candidate_generation"])
        self.assertTrue(B2_REQUIRED_CAPABILITIES.issubset(set(result["runtime_key_capabilities"])))
        self.assertFalse(result["r2_proven"])

    def test_b2_missing_readiness_caps_or_broad_destructive_caps_rejected(self):
        with self.assertRaisesRegex(ReadinessError, "required_capabilities_missing"):
            validate_b2_readiness(
                authorization=self.b2_authorization(missing={"readBucketRetentions"}),
                buckets_response=self.b2_buckets(),
                expected_bucket=B2_BUCKET,
                expected_endpoint_host=B2_ENDPOINT,
                expected_account_scope_sha256=B2_ACCOUNT_HASH,
                now=NOW,
            )
        with self.assertRaisesRegex(ReadinessError, "capabilities_too_broad"):
            validate_b2_readiness(
                authorization=self.b2_authorization(extra={"deleteFiles"}),
                buckets_response=self.b2_buckets(),
                expected_bucket=B2_BUCKET,
                expected_endpoint_host=B2_ENDPOINT,
                expected_account_scope_sha256=B2_ACCOUNT_HASH,
                now=NOW,
            )

    def test_b2_long_lived_or_unreadable_object_lock_rejected(self):
        with self.assertRaisesRegex(ReadinessError, "expiry_exceeds_24h"):
            validate_b2_readiness(
                authorization=self.b2_authorization(hours=48),
                buckets_response=self.b2_buckets(),
                expected_bucket=B2_BUCKET,
                expected_endpoint_host=B2_ENDPOINT,
                expected_account_scope_sha256=B2_ACCOUNT_HASH,
                now=NOW,
            )
        buckets = self.b2_buckets()
        buckets["buckets"][0]["fileLockConfiguration"] = {"isClientAuthorizedToRead": False, "value": None}
        with self.assertRaisesRegex(ReadinessError, "configuration_not_readable"):
            validate_b2_readiness(
                authorization=self.b2_authorization(),
                buckets_response=buckets,
                expected_bucket=B2_BUCKET,
                expected_endpoint_host=B2_ENDPOINT,
                expected_account_scope_sha256=B2_ACCOUNT_HASH,
                now=NOW,
            )

    def test_b2_overlapping_lifecycle_and_public_bucket_rejected(self):
        buckets = self.b2_buckets()
        buckets["buckets"][0]["lifecycleRules"] = [
            {
                "fileNamePrefix": RECOVERY_PREFIX,
                "daysFromUploadingToHiding": 7,
                "daysFromHidingToDeleting": 30,
            }
        ]
        with self.assertRaisesRegex(ReadinessError, "lifecycle_conflict"):
            validate_b2_readiness(
                authorization=self.b2_authorization(),
                buckets_response=buckets,
                expected_bucket=B2_BUCKET,
                expected_endpoint_host=B2_ENDPOINT,
                expected_account_scope_sha256=B2_ACCOUNT_HASH,
                now=NOW,
            )
        public = self.b2_buckets()
        public["buckets"][0]["bucketType"] = "allPublic"
        with self.assertRaisesRegex(ReadinessError, "must_be_private"):
            validate_b2_readiness(
                authorization=self.b2_authorization(),
                buckets_response=public,
                expected_bucket=B2_BUCKET,
                expected_endpoint_host=B2_ENDPOINT,
                expected_account_scope_sha256=B2_ACCOUNT_HASH,
                now=NOW,
            )


if __name__ == "__main__":
    unittest.main()
