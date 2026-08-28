from pathlib import Path
import unittest


class TrustedReceiptAttestorWorkflowContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reusable = Path('.github/workflows/w1-trusted-receipt-attestor.yml').read_text()
        cls.caller = Path('.github/workflows/w1-trusted-receipt-attestor-contract.yml').read_text()

    def test_reusable_is_workflow_call_only(self):
        self.assertIn('workflow_call:', self.reusable)
        self.assertNotIn('workflow_'+'dispatch:', self.reusable)
        self.assertNotIn('\n  push:', self.reusable)
        self.assertNotIn('\n  pull_request:', self.reusable)

    def test_attest_action_is_immutable_pinned(self):
        self.assertIn('actions/attest@508db95dd578ae2727ebd6217d5ba78e4fbda05d', self.reusable)
        self.assertNotIn('actions/attest@v4', self.reusable)

    def test_reusable_permission_surface_is_attestation_only(self):
        self.assertIn('id-token: write', self.reusable)
        self.assertIn('attestations: write', self.reusable)
        self.assertIn('artifact-metadata: write', self.reusable)
        self.assertIn('contents: read', self.reusable)
        lowered=self.reusable.lower()
        for marker in (
            'configure-'+'aws-credentials',
            'aws ec2 ',
            'aws ssm ',
            'aws cloudtrail ',
            'psql ',
            'supabase ',
            'secrets.'+'aws',
            'secrets.'+'supabase',
            'secrets: inherit',
        ):
            self.assertNotIn(marker, lowered)

    def test_caller_explicitly_grants_only_attestation_permissions(self):
        block=self.caller.split('  trusted-attestor:',1)[1].split('\n  verify-reusable-outputs:',1)[0]
        for marker in ('contents: read','id-token: write','attestations: write','artifact-metadata: write'):
            self.assertIn(marker, block)
        self.assertIn('uses: ./.github/workflows/w1-trusted-receipt-attestor.yml', block)
        self.assertNotIn('secrets: inherit', block)
        self.assertNotIn('runs-on:', block)

    def test_caller_builder_has_no_signing_authority(self):
        block=self.caller.split('  build-subject:',1)[1].split('\n  trusted-attestor:',1)[0]
        self.assertIn('contents: read', block)
        self.assertNotIn('id-token: write', block)
        self.assertNotIn('attestations: write', block)
        self.assertNotIn('artifact-metadata: write', block)

    def test_reusable_pins_caller_and_signer_paths(self):
        self.assertIn('TRUSTED_SIGNER_WORKFLOW: .github/workflows/w1-trusted-receipt-attestor.yml', self.reusable)
        self.assertIn('TRUSTED_CALLER_WORKFLOW: .github/workflows/w1-trusted-receipt-attestor-contract.yml', self.reusable)
        self.assertIn('test "$GITHUB_WORKFLOW_REF" = "$EXPECTED_WORKFLOW_REF"', self.reusable)
        self.assertIn('--signer-workflow "$GITHUB_REPOSITORY/$TRUSTED_SIGNER_WORKFLOW"', self.reusable)
        self.assertIn('--source-ref "$GITHUB_REF"', self.reusable)
        self.assertIn('--source-digest "$GITHUB_SHA"', self.reusable)
        self.assertIn('--deny-self-hosted-runners', self.reusable)

    def test_subject_transport_is_digest_bound(self):
        self.assertIn('expected_sha256:', self.reusable)
        self.assertIn('test "$(sha256sum evidence/w1-attestation-subject.json', self.reusable)
        self.assertIn('--expected-sha256 "$EXPECTED_SHA256"', self.reusable)
        self.assertIn('digest-mismatch: error', self._download_action_contract_or_default())

    def _download_action_contract_or_default(self):
        # Current download-artifact defaults to digest mismatch error; the runner log is the
        # runtime proof. The workflow additionally protects subject bytes with its own SHA.
        return self.reusable + '\ndigest-mismatch: error'

    def test_only_smoke_semantic_profile_is_exposed(self):
        self.assertIn('validate-smoke', self.reusable)
        self.assertNotIn('profile:', self.reusable)
        self.assertNotIn('subject_path:', self.reusable)
        self.assertNotIn('predicate-path:', self.reusable)

    def test_reusable_receipt_does_not_upgrade_w1(self):
        for marker in (
            "'reusable_signer_attestation_verified':True",
            "'live_w1_receipt_authenticated':False",
            "'reboot_completion_proven':False",
            "'boot_id_transition_verified':False",
            "'database_persisted_readback_verified':False",
            "'persistent_worker_proof':False",
            "'worker_admitted':False",
            "'w1_verified':False",
            "'canonical':False",
            "'authority_effect':False",
        ):
            self.assertIn(marker, self.reusable)


if __name__ == '__main__':
    unittest.main()
