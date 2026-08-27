from __future__ import annotations

from pathlib import Path
import re
import unittest


WORKFLOW = Path('.github/workflows/w1-aws-ssm-safety-provision-live.yml')


class LiveWorkflowContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = WORKFLOW.read_text(encoding='utf-8')

    def _job(self, name: str) -> str:
        match = re.search(rf'^  {re.escape(name)}:\n(?P<body>.*?)(?=^  [A-Za-z0-9_-]+:\n|\Z)', self.source, re.M | re.S)
        self.assertIsNotNone(match, name)
        return match.group('body')

    def test_cloud_jobs_are_dispatch_only_and_environment_protected(self):
        for name in ('live-gate', 'provision', 'iid-capture', 'postverify'):
            self.assertIn("if: github.event_name == 'workflow_dispatch'", self._job(name), name)
        for name in ('provision', 'iid-capture', 'postverify'):
            self.assertIn('environment: w1-persistent-host-proof', self._job(name), name)
        self.assertIn("test \"$GITHUB_REF\" = 'refs/heads/main'", self.source)
        self.assertIn("test \"$CONFIRMATION\" = 'PROVISION_W1_SAFETY_PACKAGE'", self.source)

    def test_oidc_credentials_are_split_across_three_narrow_roles(self):
        self.assertEqual(3, self.source.count('id-token: write'))
        self.assertEqual(3, self.source.count('aws-actions/configure-aws-credentials@e6de054238d6b7531b4efff3b6587d9aade6a06c'))
        for variable in (
            'W1_AWS_SSM_PROVISION_ROLE_ARN',
            'W1_AWS_SSM_IID_CAPTURE_ROLE_ARN',
            'W1_AWS_SSM_VERIFY_ROLE_ARN',
        ):
            self.assertIn(variable, self.source)
        self.assertNotIn('secrets.AWS_', self.source)
        self.assertNotIn('vars.AWS_ACCESS_KEY_ID', self.source)
        self.assertEqual(3, self.source.count('output-env-credentials: false'))
        self.assertEqual(3, self.source.count('output-credentials: true'))
        self.assertEqual(3, self.source.count('unset-current-credentials: true'))

    def test_live_workflow_cannot_author_documents_reboot_or_mutate_database(self):
        lowered = self.source.lower()
        for forbidden in (
            'aws ssm create-document',
            'aws ssm update-document',
            'aws ssm delete-document',
            'aws ec2 reboot-instances',
            'aws ec2 run-instances',
            'aws ec2 terminate-instances',
            'supabase',
            'service_role_key',
            'r1_pgpassword',
            '--output-s3-bucket-name',
            '--cloud-watch-output-config',
            '--notification-config',
            '--service-role-arn',
        ):
            self.assertNotIn(forbidden, lowered, forbidden)

    def test_provisioning_semantics_and_eventual_consistency_are_bounded(self):
        provision = self._job('provision')
        self.assertIn('--timeout-seconds 120', provision)
        self.assertIn('seq 1 36', provision)
        self.assertIn('InvocationDoesNotExist', provision)
        postverify = self._job('postverify')
        self.assertIn('seq 1 24', postverify)
        self.assertIn('W1_CLOUDTRAIL_RETRYABLE', postverify)
        self.assertIn('check-cloudtrail', postverify)
        self.assertIn('compose', postverify)

    def test_provisioning_metadata_uses_prefix_environment_assignment(self):
        expected = 'REQUESTED_AT="$REQUESTED_AT" API_RETURNED_AT="$API_RETURNED_AT" COMMAND_ID="$COMMAND_ID" \\\n            python3 -c'
        self.assertIn(expected, self.source)
        self.assertNotRegex(self.source, r'python3 -c .*\\\n\s+REQUESTED_AT=')

    def test_credentials_are_not_uploaded_or_crossed_between_jobs(self):
        for job_name in ('provision', 'iid-capture', 'postverify'):
            job = self._job(job_name)
            self.assertNotIn('echo "$AWS_ACCESS_KEY_ID"', job)
            self.assertNotIn('echo "$AWS_SECRET_ACCESS_KEY"', job)
            self.assertNotIn('echo "$AWS_SESSION_TOKEN"', job)
        provision_upload = self._job('provision').split('Upload credential-free provisioning transport evidence', 1)[-1]
        self.assertNotIn('steps.aws.outputs', provision_upload)
        iid_upload = self._job('iid-capture').split('Upload untrusted IID transport only', 1)[-1]
        self.assertNotIn('steps.aws.outputs', iid_upload)

    def test_verifier_job_has_no_sendcommand_execution(self):
        postverify = self._job('postverify')
        self.assertNotIn('aws ssm send-command', postverify)
        self.assertNotIn('ec2:RebootInstances', postverify)
        self.assertIn('W1_AWS_SSM_VERIFY_ROLE_ARN', postverify)


if __name__ == '__main__':
    unittest.main()
