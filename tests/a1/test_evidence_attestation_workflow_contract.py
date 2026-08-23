import re
import unittest
from pathlib import Path


WORKFLOW = Path('.github/workflows/a1-evidence-attestation.yml')
ATTEST_SHA = '1e69f48acb82d1966a394da916b4c1698aa569d6'


class EvidenceAttestationWorkflowContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = WORKFLOW.read_text(encoding='utf-8')

    def test_no_pull_request_target_or_automatic_live_attestation(self):
        self.assertNotIn('pull_request_target:', self.text)
        self.assertIn("if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'", self.text)
        self.assertIn('environment: a1-peer-review-ingest', self.text)

    def test_oidc_and_attestation_permissions_are_explicit(self):
        self.assertIn('id-token: write', self.text)
        self.assertIn('attestations: write', self.text)
        self.assertIn('artifact-metadata: write', self.text)
        # Top-level permission remains read-only; elevated permissions live on live-attest.
        self.assertRegex(self.text, r"permissions:\n  contents: read\n\njobs:")

    def test_attestation_action_is_exactly_pinned_and_verified_downstream(self):
        self.assertIn(f'uses: actions/attest@{ATTEST_SHA}', self.text)
        self.assertIn('subject-path: evidence/l4.8/h205f22-sync-l47-002-evidence.tar', self.text)
        self.assertIn('gh attestation verify', self.text)
        self.assertIn('--format json', self.text)
        self.assertNotIn('predicate-type:', self.text)
        self.assertNotIn('predicate-path:', self.text)

    def test_pap_channel_is_read_only_and_bearer_not_on_curl_header_argument(self):
        self.assertIn('/pap/read?peer=glm&after_seq=$AFTER_SEQ', self.text)
        self.assertNotIn('/pap/ack', self.text)
        self.assertNotIn('/pap/publish', self.text)
        self.assertNotIn('-H "Authorization: Bearer $PAP_CHATGPT_TOKEN"', self.text)
        self.assertIn('/tmp/pap-curl.conf', self.text)
        self.assertIn("umask 077", self.text)

    def test_raw_provider_payloads_are_not_uploaded(self):
        upload_block = self.text.split('name: Upload credential-free attested evidence', 1)[1]
        self.assertNotIn('/tmp/github-reviews.json', upload_block)
        self.assertNotIn('/tmp/pap-read.json', upload_block)
        self.assertIn('Remove raw provider responses', self.text)

    def test_bundle_scope_remains_non_authority(self):
        self.assertIn("assert receipt['evidence_class']=='EVIDENCE_READY_NON_AUTHORITY'", self.text)
        self.assertIn("assert receipt['authority_effect'] is False", self.text)
        self.assertIn("assert receipt['canonical'] is False", self.text)
        self.assertIn("assert receipt['w1_verified'] is False", self.text)


if __name__ == '__main__':
    unittest.main()
