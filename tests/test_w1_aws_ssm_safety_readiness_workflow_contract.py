from __future__ import annotations

from pathlib import Path
import re
import unittest


WORKFLOW = Path('.github/workflows/w1-aws-ssm-safety-readiness.yml')


class ReadinessWorkflowContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = WORKFLOW.read_text(encoding='utf-8')

    def _job(self, name: str) -> str:
        match = re.search(rf'^  {re.escape(name)}:\n(?P<body>.*?)(?=^  [A-Za-z0-9_-]+:\n|\Z)', self.source, re.M | re.S)
        self.assertIsNotNone(match, name)
        return match.group('body')

    def test_real_readiness_jobs_are_explicit_dispatch_only(self):
        for name in ('github-environment', 'aws-readonly'):
            self.assertIn("if: github.event_name == 'workflow_dispatch'", self._job(name), name)
        self.assertIn("test \"$GITHUB_REF\" = 'refs/heads/main'", self.source)
        self.assertIn("PREFLIGHT_W1_SSM_SAFETY_READINESS", self.source)

    def test_only_readonly_job_gets_oidc_and_uses_protected_environment(self):
        self.assertEqual(1, self.source.count('id-token: write'))
        readonly = self._job('aws-readonly')
        self.assertIn('environment: w1-persistent-host-proof', readonly)
        self.assertIn('W1_AWS_SSM_VERIFY_ROLE_ARN', readonly)
        self.assertEqual(1, self.source.count('aws-actions/configure-aws-credentials@e6de054238d6b7531b4efff3b6587d9aade6a06c'))
        self.assertIn('output-env-credentials: false', readonly)
        self.assertIn('output-credentials: true', readonly)
        self.assertIn('unset-current-credentials: true', readonly)

    def test_three_role_configuration_is_required_but_only_verifier_is_assumed(self):
        readonly = self._job('aws-readonly')
        for variable in ('W1_AWS_SSM_PROVISION_ROLE_ARN', 'W1_AWS_SSM_IID_CAPTURE_ROLE_ARN', 'W1_AWS_SSM_VERIFY_ROLE_ARN'):
            self.assertIn(variable, readonly)
        self.assertEqual(1, readonly.count('role-to-assume:'))
        self.assertIn('role-to-assume: ${{ vars.W1_AWS_SSM_VERIFY_ROLE_ARN }}', readonly)

    def test_no_provider_or_database_mutation_command_exists(self):
        lowered = self.source.lower()
        for forbidden in (
            'aws ssm send-command', 'aws ssm create-document', 'aws ssm update-document',
            'aws ssm delete-document', 'aws ssm start-session', 'aws ec2 reboot-instances',
            'aws ec2 run-instances', 'aws ec2 terminate-instances', 'aws ec2 stop-instances',
            'cloudtrail lookup-events', 'supabase', 'r1_pgpassword', 'service_role_key',
        ):
            self.assertNotIn(forbidden, lowered, forbidden)

    def test_github_environment_metadata_is_validated_before_oidc_job(self):
        github = self._job('github-environment')
        self.assertIn('/environments/w1-persistent-host-proof', github)
        self.assertIn('/branches/main', github)
        self.assertIn('/deployment-branch-policies?per_page=100', github)
        self.assertIn('aws_provider_reboot_live_guard.py validate-environment', github)
        self.assertIn('aws_persistent_host_preflight_guard.py validate-deployment', github)
        readonly = self._job('aws-readonly')
        self.assertIn('needs: [contract, github-environment]', readonly)

    def test_readonly_aws_surface_checks_both_documents_and_managed_node(self):
        readonly = self._job('aws-readonly')
        for required in (
            'aws sts get-caller-identity', 'aws ec2 describe-instances', 'aws ec2 describe-volumes',
            'aws ec2 describe-security-groups', 'aws ssm describe-instance-information',
            'aws ssm describe-document --name "$PROVISION_DOCUMENT_NAME"',
            'aws ssm get-document --name "$PROVISION_DOCUMENT_NAME"',
            'aws ssm describe-document --name "$IID_DOCUMENT_NAME"',
            'aws ssm get-document --name "$IID_DOCUMENT_NAME"',
            'aws_ssm_safety_readiness_guard.py compose',
        ):
            self.assertIn(required, readonly, required)

    def test_receipt_explicitly_preserves_nonclaims(self):
        readonly = self._job('aws-readonly')
        for marker in (
            "v['send_command_executed'] is False",
            "v['host_filesystem_mutation'] is False",
            "v['reboot_performed'] is False",
            "v['database_mutation'] is False",
            "v['w1_verified'] is False",
            "v['authority_effect'] is False",
        ):
            self.assertIn(marker, readonly)


if __name__ == '__main__':
    unittest.main()
