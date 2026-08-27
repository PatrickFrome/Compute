from __future__ import annotations

import json
import unittest

from controller.w1 import build_host_safety_package as package_builder
from controller.w1 import build_ssm_safety_provision_document as provision


class SsmSafetyProvisionDocumentTests(unittest.TestCase):
    def test_build_is_deterministic_and_within_ssm_limit(self):
        first = provision.build_document()
        second = provision.build_document()
        self.assertEqual(first, second)
        self.assertLessEqual(first["document_bytes"], provision.MAX_SSM_DOCUMENT_BYTES)
        self.assertEqual({}, first["document"]["parameters"])
        self.assertTrue(first["parameterless"])
        self.assertFalse(first["network_fetch_allowed"])
        self.assertFalse(first["generic_package_document_allowed"])
        self.assertFalse(first["capture_authority"])
        self.assertFalse(first["reboot_authority"])
        self.assertFalse(first["admission_authority"])
        self.assertFalse(first["authority_effect"])

    def test_document_embeds_exact_deterministic_package_identity(self):
        result = provision.build_document()
        command = result["document"]["mainSteps"][0]["inputs"]["runCommand"][0]
        self.assertEqual(package_builder.SOURCE_COMMIT, result["source_commit_sha"])
        self.assertEqual(package_builder.SOURCE_TREE, result["source_tree_sha"])
        self.assertIn(result["package_sha256"], command)
        self.assertIn(str(result["package_bytes"]), command)
        self.assertIn(result["payload_lock_sha256"], command)
        self.assertIn(package_builder.INSTALL_ROOT, command)
        self.assertIn(package_builder.EXECUTION_USER, command)
        self.assertIn(package_builder.WORKSPACE_ROOT, command)
        self.assertIn("embedded_package_sha256_mismatch", command)
        self.assertIn("package_install_observed", command)
        self.assertIn("package_provisioning_verified':False", command)
        self.assertIn("host_safety_verified':False", command)
        self.assertIn("w1_verified':False", command)

    def test_document_has_no_runtime_parameter_or_remote_fetch_surface(self):
        result = provision.build_document()
        document = result["document"]
        command = document["mainSteps"][0]["inputs"]["runCommand"][0]
        self.assertEqual("2.2", document["schemaVersion"])
        self.assertEqual({}, document["parameters"])
        self.assertEqual("aws:runShellScript", document["mainSteps"][0]["action"])
        self.assertNotIn("{{", command)
        for forbidden in (
            "https://", "http://", "curl ", "wget ", "git clone", "git pull",
            "aws s3", "AWS-ConfigureAWSPackage", "aws:configurePackage",
            "AWS-RunDocument", "aws:runDocument", "ssm:SendCommand",
        ):
            self.assertNotIn(forbidden.lower(), command.lower(), forbidden)

    def test_embedded_zip_extraction_is_fail_closed(self):
        command = provision.build_document()["document"]["mainSteps"][0]["inputs"]["runCommand"][0]
        required = (
            "embedded_package_entry_set_invalid",
            "embedded_package_path_forbidden",
            "embedded_package_mode_mismatch",
            "os.O_EXCL",
            "os.O_NOFOLLOW",
        )
        for marker in required:
            self.assertIn(marker, command)

    def test_build_receipt_self_hash_is_valid(self):
        result = provision.build_document()
        receipt = result.pop("build_receipt_sha256")
        self.assertEqual(provision.sha256_bytes(provision.canonical_bytes(result)), receipt)


if __name__ == "__main__":
    unittest.main()
