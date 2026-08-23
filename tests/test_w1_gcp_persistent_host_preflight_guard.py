import copy
import unittest

from controller.w1.gcp_persistent_host_preflight_guard import validate


SHA = "a" * 40


def instance_fixture():
    return {
        "name": "metaengine-w1-gcp",
        "zone": "https://www.googleapis.com/compute/v1/projects/p/zones/us-central1-a",
        "status": "RUNNING",
        "machineType": "https://www.googleapis.com/compute/v1/projects/p/zones/us-central1-a/machineTypes/e2-micro",
        "scheduling": {"preemptible": False, "provisioningModel": "STANDARD"},
        "guestAccelerators": [],
        "metadata": {"items": [
            {"key": "metaengine-worker-id", "value": "w1-gcp-001"},
            {"key": "metaengine-git-sha", "value": SHA},
        ]},
        "disks": [{
            "boot": True,
            "source": "https://www.googleapis.com/compute/v1/projects/p/zones/us-central1-a/disks/metaengine-w1-gcp",
        }],
        "networkInterfaces": [{"name": "nic0", "accessConfigs": []}],
    }


def disk_fixture():
    return {
        "name": "metaengine-w1-gcp",
        "zone": "https://www.googleapis.com/compute/v1/projects/p/zones/us-central1-a",
        "type": "https://www.googleapis.com/compute/v1/projects/p/zones/us-central1-a/diskTypes/pd-standard",
        "sizeGb": "30",
    }


def run(instance=None, disk=None, permissions=None, zone="us-central1-a"):
    return validate(
        instance=instance or instance_fixture(),
        disk=disk or disk_fixture(),
        permissions=permissions or {"permissions": ["compute.instances.reset"]},
        project_id="metaengine-h205f22",
        zone=zone,
        instance_name="metaengine-w1-gcp",
        worker_id="w1-gcp-001",
        expected_w1_sha=SHA,
    )


class GcpPreflightGuardTests(unittest.TestCase):
    def test_valid_free_tier_shape(self):
        value = run()
        self.assertTrue(value["accepted"])
        self.assertTrue(value["reset_permission_proven"])
        self.assertFalse(value["persistent_worker_proof"])
        self.assertFalse(value["w1_verified"])

    def test_wrong_machine_type_rejected(self):
        i = instance_fixture()
        i["machineType"] = i["machineType"].replace("e2-micro", "e2-small")
        self.assertIn("NOT_E2_MICRO", run(instance=i)["reasons"])

    def test_non_free_region_rejected(self):
        i = instance_fixture()
        i["zone"] = i["zone"].replace("us-central1-a", "europe-west1-b")
        i["machineType"] = i["machineType"].replace("us-central1-a", "europe-west1-b")
        d = disk_fixture()
        d["zone"] = d["zone"].replace("us-central1-a", "europe-west1-b")
        d["type"] = d["type"].replace("us-central1-a", "europe-west1-b")
        self.assertIn("NOT_GCP_COMPUTE_FREE_TIER_REGION", run(instance=i, disk=d, zone="europe-west1-b")["reasons"])

    def test_preemptible_rejected(self):
        i = instance_fixture()
        i["scheduling"]["preemptible"] = True
        self.assertIn("PREEMPTIBLE_NOT_ALLOWED", run(instance=i)["reasons"])

    def test_worker_metadata_mismatch_rejected(self):
        i = instance_fixture()
        i["metadata"]["items"][0]["value"] = "other-worker"
        self.assertIn("WORKER_METADATA_MISMATCH", run(instance=i)["reasons"])

    def test_reset_permission_missing_rejected(self):
        self.assertIn("RESET_PERMISSION_NOT_PROVEN", run(permissions={"permissions": []})["reasons"])

    def test_non_standard_disk_rejected(self):
        d = disk_fixture()
        d["type"] = d["type"].replace("pd-standard", "pd-balanced")
        self.assertIn("BOOT_DISK_NOT_PD_STANDARD", run(disk=d)["reasons"])

    def test_disk_over_30gb_rejected(self):
        d = disk_fixture()
        d["sizeGb"] = "31"
        self.assertIn("BOOT_DISK_OUTSIDE_FREE_TIER_30GB", run(disk=d)["reasons"])

    def test_external_ipv4_is_cost_warning_not_authority_change(self):
        i = instance_fixture()
        i["networkInterfaces"][0]["accessConfigs"] = [{"type": "ONE_TO_ONE_NAT", "natIP": "203.0.113.1"}]
        value = run(instance=i)
        self.assertTrue(value["accepted"])
        self.assertTrue(value["external_ipv4_present"])
        self.assertFalse(value["strict_zero_cost_networking"])
        self.assertFalse(value["authority_effect"])


if __name__ == "__main__":
    unittest.main()
