from pathlib import Path
import unittest

WORKFLOW = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "a1-live-peer-review-ingest.yml"


class LivePeerReviewWorkflowContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = WORKFLOW.read_text(encoding="utf-8")

    def test_live_job_is_manual_main_only(self):
        self.assertIn("if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'", self.text)
        self.assertIn("environment: a1-peer-review-ingest", self.text)
        self.assertNotIn("pull_request_target:", self.text)
        self.assertNotIn("workflow_run:", self.text)

    def test_pap_endpoint_is_fixed_and_read_only(self):
        self.assertIn(
            "PAP_BASE_URL: https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/pap-transport",
            self.text,
        )
        self.assertIn("/pap/read?peer=glm&after_seq=", self.text)
        self.assertNotIn("/pap/ack", self.text)
        self.assertNotIn("/pap/publish", self.text)

    def test_raw_pap_response_is_not_uploaded(self):
        self.assertIn("-o /tmp/pap-read.json", self.text)
        self.assertIn("rm -f /tmp/github-reviews.json /tmp/pap-read.json", self.text)
        artifact_section = self.text.split("Upload credential-free peer-review evidence", 1)[1]
        self.assertNotIn("/tmp/pap-read.json", artifact_section)
        self.assertNotIn("/tmp/github-reviews.json", artifact_section)

    def test_secret_is_not_used_on_pr_test_job(self):
        pre_live = self.text.split("  live-ingest:", 1)[0]
        self.assertNotIn("PAP_CHATGPT_TOKEN", pre_live)
        self.assertNotIn("secrets.", pre_live)

    def test_checkout_does_not_persist_credentials(self):
        self.assertGreaterEqual(self.text.count("persist-credentials: false"), 2)


if __name__ == "__main__":
    unittest.main()
