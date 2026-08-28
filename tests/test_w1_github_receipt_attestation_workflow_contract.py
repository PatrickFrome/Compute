from pathlib import Path
import unittest


class GitHubReceiptAttestationWorkflowContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw=Path('.github/workflows/w1-authenticated-receipt-attestation-contract.yml').read_text()

    def test_attestation_action_is_immutable_pinned(self):
        self.assertIn('actions/attest@508db95dd578ae2727ebd6217d5ba78e4fbda05d', self.raw)
        self.assertNotIn('actions/attest@v4', self.raw)

    def test_builder_has_no_oidc_or_attestation_write(self):
        block=self.raw.split('  build-subject:',1)[1].split('\n  attest-and-verify:',1)[0]
        self.assertNotIn('id-'+'token: write', block)
        self.assertNotIn('attestations: write', block)
        self.assertNotIn('artifact-metadata: write', block)
        self.assertIn('contents: read', block)

    def test_attestor_has_github_attestation_permissions_only(self):
        block=self.raw.split('  attest-and-verify:',1)[1]
        self.assertIn('id-token: write', block)
        self.assertIn('attestations: write', block)
        self.assertIn('artifact-metadata: write', block)
        self.assertIn('contents: read', block)
        for marker in ('aws-actions/', 'configure-'+'aws-credentials', 'secrets.'+'AWS', 'psql ', 'supabase ', 'aws ec2 ', 'aws ssm ', 'aws cloudtrail '):
            self.assertNotIn(marker.lower(), block.lower())

    def test_attestor_is_push_only_and_repo_bound(self):
        self.assertIn("if: github.event_name == 'push' && github.repository == 'PatrickFrome/Compute'", self.raw)
        self.assertNotIn('workflow_'+'dispatch:', self.raw)

    def test_subject_is_explicit_nonauthority(self):
        for marker in (
            "'same_world_chain_live_evidence':False",
            "'aws_credentials_used':False",
            "'provider_mutation_observed':False",
            "'database_mutation_observed':False",
            "'reboot_completion_proven':False",
            "'boot_id_transition_verified':False",
            "'persistent_worker_proof':False",
            "'worker_admitted':False",
            "'w1_verified':False",
            "'canonical':False",
            "'authority_effect':False",
        ):
            self.assertIn(marker, self.raw)

    def test_verification_pins_source_and_signer_identity(self):
        for marker in (
            '--repo "$GITHUB_REPOSITORY"',
            '--bundle "$BUNDLE_PATH"',
            "--predicate-type 'https://slsa.dev/provenance/v1'",
            '--signer-workflow "$GITHUB_REPOSITORY/.github/workflows/w1-authenticated-receipt-attestation-contract.yml"',
            '--source-ref "$GITHUB_REF"',
            '--source-digest "$GITHUB_SHA"',
            '--deny-self-hosted-runners',
            "cert.get('sourceRepositoryRef')==os.environ['GITHUB_REF']",
            "cert.get('sourceRepositoryDigest')==os.environ['GITHUB_SHA']",
            "cert.get('runnerEnvironment')=='github-hosted'",
        ):
            self.assertIn(marker, self.raw)

    def test_attestation_mechanism_does_not_upgrade_w1(self):
        block=self.raw.split("'schema':'metaengine.compute.w1-github-attestation-verification.h205f22.v1'",1)[1]
        self.assertIn("'producer_attestation_mechanism_verified':True", block)
        self.assertIn("'live_w1_receipt_authenticated':False", block)
        for marker in (
            "'reboot_completion_proven':False",
            "'boot_id_transition_verified':False",
            "'database_persisted_readback_verified':False",
            "'persistent_worker_proof':False",
            "'worker_admitted':False",
            "'w1_verified':False",
            "'canonical':False",
            "'authority_effect':False",
        ):
            self.assertIn(marker, block)


if __name__ == '__main__':
    unittest.main()
