from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[2] / "coordination" / "sync" / "transactional_coordination.py"
SPEC = importlib.util.spec_from_file_location("transactional_coordination", MODULE_PATH)
assert SPEC and SPEC.loader
mod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mod)

EPOCH = "a" * 64
SUBJECT = "b" * 64
PAYLOAD = "c" * 64


def intent(*, generation=7, fence=11, domain="coordination", operation="APPEND_TASK_EVENT"):
    key = mod.derive_idempotency_key(
        task_id="SYNC-L4.7-002",
        operation=operation,
        mutation_domain=domain,
        sync_epoch_sha256=EPOCH,
        epoch_generation=generation,
        fencing_token=fence,
        execution_subject_sha256=SUBJECT,
    )
    return {
        "schema": "metaengine.compute.sync-write-intent.h205f22.v1",
        "task_id": "SYNC-L4.7-002",
        "operation": operation,
        "mutation_domain": domain,
        "sync_epoch_sha256": EPOCH,
        "epoch_generation": generation,
        "fencing_token": fence,
        "execution_subject_sha256": SUBJECT,
        "idempotency_key": key,
        "authority_effect": False,
        "canonical": False,
    }


class TransactionalCoordinationTests(unittest.TestCase):
    def test_exact_epoch_and_fence_apply_once(self):
        result = mod.validate_write_intent(intent(), current_sync_epoch_sha256=EPOCH,
                                           current_epoch_generation=7,
                                           current_fencing_tokens={"coordination": 11})
        self.assertEqual(result["decision"], "APPLY_ONCE")
        self.assertTrue(result["apply"])
        self.assertFalse(result["authority_effect"])

    def test_known_idempotency_key_is_noop_even_after_fence_advances(self):
        i = intent()
        result = mod.validate_write_intent(i, current_sync_epoch_sha256=EPOCH,
                                           current_epoch_generation=8,
                                           current_fencing_tokens={"coordination": 12},
                                           applied_idempotency_keys={i["idempotency_key"]})
        self.assertEqual(result["decision"], "IDEMPOTENT_REPLAY")
        self.assertFalse(result["apply"])

    def test_stale_epoch_rejected(self):
        with self.assertRaisesRegex(ValueError, "STALE_EPOCH_GENERATION"):
            mod.validate_write_intent(intent(generation=6), current_sync_epoch_sha256=EPOCH,
                                      current_epoch_generation=7,
                                      current_fencing_tokens={"coordination": 11})

    def test_future_epoch_rejected(self):
        with self.assertRaisesRegex(ValueError, "FUTURE_EPOCH_GENERATION"):
            mod.validate_write_intent(intent(generation=8), current_sync_epoch_sha256=EPOCH,
                                      current_epoch_generation=7,
                                      current_fencing_tokens={"coordination": 11})

    def test_stale_fence_rejected(self):
        with self.assertRaisesRegex(ValueError, "STALE_FENCING_TOKEN"):
            mod.validate_write_intent(intent(fence=10), current_sync_epoch_sha256=EPOCH,
                                      current_epoch_generation=7,
                                      current_fencing_tokens={"coordination": 11})

    def test_future_fence_rejected(self):
        with self.assertRaisesRegex(ValueError, "FUTURE_FENCING_TOKEN"):
            mod.validate_write_intent(intent(fence=12), current_sync_epoch_sha256=EPOCH,
                                      current_epoch_generation=7,
                                      current_fencing_tokens={"coordination": 11})

    def test_idempotency_key_cannot_be_reused_for_other_operation(self):
        i = intent()
        i["operation"] = "PUBLISH_REVIEW_RECEIPT"
        with self.assertRaisesRegex(ValueError, "idempotency_key mismatch"):
            mod.validate_write_intent(i, current_sync_epoch_sha256=EPOCH,
                                      current_epoch_generation=7,
                                      current_fencing_tokens={"coordination": 11})

    def test_unknown_domain_rejected(self):
        i = intent(domain="unknown")
        with self.assertRaisesRegex(ValueError, "unknown mutation domain"):
            mod.validate_write_intent(i, current_sync_epoch_sha256=EPOCH,
                                      current_epoch_generation=7,
                                      current_fencing_tokens={"coordination": 11})

    def test_authority_overclaim_rejected(self):
        i = intent()
        i["authority_effect"] = True
        with self.assertRaisesRegex(ValueError, "non-authority"):
            mod.validate_write_intent(i, current_sync_epoch_sha256=EPOCH,
                                      current_epoch_generation=7,
                                      current_fencing_tokens={"coordination": 11})

    def test_append_only_event_chain_and_reorder_guard(self):
        e1 = mod.build_event(event_id="evt-1", task_id="SYNC-L4.7-002",
                             event_type="TASK_CREATED", sequence=1,
                             sync_epoch_sha256=EPOCH, epoch_generation=7,
                             execution_subject_sha256=None, previous_event_sha256=None,
                             payload_sha256=PAYLOAD)
        e2 = mod.build_event(event_id="evt-2", task_id="SYNC-L4.7-002",
                             event_type="EXECUTION_VERIFIED", sequence=2,
                             sync_epoch_sha256=EPOCH, epoch_generation=7,
                             execution_subject_sha256=SUBJECT,
                             previous_event_sha256=e1["event_sha256"], payload_sha256=PAYLOAD)
        e3 = mod.build_event(event_id="evt-3", task_id="SYNC-L4.7-002",
                             event_type="PEER_REVIEW_PENDING", sequence=3,
                             sync_epoch_sha256=EPOCH, epoch_generation=7,
                             execution_subject_sha256=SUBJECT,
                             previous_event_sha256=e2["event_sha256"], payload_sha256=PAYLOAD)
        state = mod.validate_event_chain([e1, e2, e3])
        self.assertEqual(state["last_event_type"], "PEER_REVIEW_PENDING")
        self.assertEqual(state["event_count"], 3)
        self.assertEqual(state["active_execution_subject_sha256"], SUBJECT)
        with self.assertRaises(ValueError):
            mod.validate_event_chain([e1, e3, e2])

    def test_subject_swap_without_reexecution_is_rejected(self):
        e1 = mod.build_event(event_id="evt-1", task_id="SYNC-L4.7-002", event_type="TASK_CREATED",
                             sequence=1, sync_epoch_sha256=EPOCH, epoch_generation=7,
                             execution_subject_sha256=None, previous_event_sha256=None, payload_sha256=PAYLOAD)
        e2 = mod.build_event(event_id="evt-2", task_id="SYNC-L4.7-002", event_type="EXECUTION_VERIFIED",
                             sequence=2, sync_epoch_sha256=EPOCH, epoch_generation=7,
                             execution_subject_sha256=SUBJECT, previous_event_sha256=e1["event_sha256"], payload_sha256=PAYLOAD)
        e3 = mod.build_event(event_id="evt-3", task_id="SYNC-L4.7-002", event_type="PEER_REVIEW_PENDING",
                             sequence=3, sync_epoch_sha256=EPOCH, epoch_generation=7,
                             execution_subject_sha256="d" * 64, previous_event_sha256=e2["event_sha256"], payload_sha256=PAYLOAD)
        with self.assertRaisesRegex(ValueError, "execution subject changed"):
            mod.validate_event_chain([e1, e2, e3])

    def test_new_subject_allowed_only_after_fix_and_reexecution(self):
        events = []
        def add(event_id, event_type, subject):
            event = mod.build_event(event_id=event_id, task_id="SYNC-L4.7-002", event_type=event_type,
                                    sequence=len(events)+1, sync_epoch_sha256=EPOCH, epoch_generation=7,
                                    execution_subject_sha256=subject,
                                    previous_event_sha256=None if not events else events[-1]["event_sha256"],
                                    payload_sha256=PAYLOAD)
            events.append(event)
        add("evt-1", "TASK_CREATED", None)
        add("evt-2", "EXECUTION_VERIFIED", SUBJECT)
        add("evt-3", "PEER_REVIEW_PENDING", SUBJECT)
        add("evt-4", "FIX_REQUIRED", SUBJECT)
        add("evt-5", "FIX_APPLIED", SUBJECT)
        new_subject = "d" * 64
        add("evt-6", "EXECUTION_VERIFIED", new_subject)
        state = mod.validate_event_chain(events)
        self.assertEqual(state["active_execution_subject_sha256"], new_subject)

    def test_invalid_transition_rejected(self):
        e1 = mod.build_event(event_id="evt-1", task_id="SYNC-L4.7-002",
                             event_type="TASK_CREATED", sequence=1,
                             sync_epoch_sha256=EPOCH, epoch_generation=7,
                             execution_subject_sha256=None, previous_event_sha256=None,
                             payload_sha256=PAYLOAD)
        e2 = mod.build_event(event_id="evt-2", task_id="SYNC-L4.7-002",
                             event_type="EVIDENCE_READY", sequence=2,
                             sync_epoch_sha256=EPOCH, epoch_generation=7,
                             execution_subject_sha256=SUBJECT,
                             previous_event_sha256=e1["event_sha256"], payload_sha256=PAYLOAD)
        with self.assertRaisesRegex(ValueError, "invalid event transition"):
            mod.validate_event_chain([e1, e2])


if __name__ == "__main__":
    unittest.main()
