from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RELAY = (ROOT / "supabase/migrations/20260824083901_same_point_duel_v4_peer_relay.sql").read_text(encoding="utf-8")
FLAT = (ROOT / "supabase/migrations/20260824084008_same_point_duel_v4_peer_relay_flat_readback.sql").read_text(encoding="utf-8")

# Independent agent submissions are append-only and hidden until the atomic pair is complete.
assert "compute_fabric_duel_peer_submission_h205f22" in RELAY
assert "unique (duel_id,wave,actor)" in RELAY
assert "duel_peer_submission_append_only" in RELAY
assert "pending_payloads_exposed',false" in RELAY
assert "HIDDEN_UNTIL_ATOMIC_PAIR" in RELAY

# Relay sessions are explicitly armed/blocked between external agent calls so the persistent runner cannot steal them.
assert "h205f22_duel_create_peer_relay_v4" in RELAY
assert "set status='BLOCKED',lease_owner=null,lease_expires_at=null" in RELAY
assert "TWO_CHAT_AGENT_RELAY_V1" in RELAY
assert "DB_ATOMIC_PAIR_ONLY" in RELAY

# Each actor is identity-bound and stale/checkpoint/hash submissions fail closed.
assert "gpt_peer_id_prefix_required" in RELAY
assert "glm_peer_id_prefix_required" in RELAY
assert "peer_identity_mismatch" in RELAY
assert "peer_seen_checkpoint_stale" in RELAY
assert "rebut_peer_hash_mismatch" in RELAY
assert "peer_submission_conflict" in RELAY

# The relay does not invent a second arbitration path: it feeds the existing V4 atomic pair/finalizer.
assert "h205f22_duel_submit_pair_v3" in RELAY
assert "h205f22_duel_submit_rebut_finalize_v4" in RELAY
assert "peer_pair_checkpoint_mismatch" in RELAY

# Direct writes stay denied; only the service role may execute the guarded RPC surface.
assert "revoke all on destruktion_meta.compute_fabric_duel_peer_submission_h205f22 from public,anon,authenticated,service_role" in RELAY
assert "grant execute on function public.h205f22_duel_submit_peer_v4" in RELAY
assert "to service_role" in RELAY

# Independent clients receive stable top-level causal identifiers, never pending peer payloads.
for field in (
    "'duel_id',d.duel_id",
    "'current_tick',d.current_tick",
    "'current_checkpoint_sha256',d.current_checkpoint_sha256",
    "'semantic_checkpoint_id',d.semantic_checkpoint_id",
    "'relay_state',relay_state",
    "'pending_payloads_exposed',false",
):
    assert field in FLAT
for state in ("ARMED_WAIT", "WAITING_PROPOSE_PEER", "WAITING_REBUT_START", "WAITING_REBUT_PEER", "DECIDED"):
    assert state in FLAT

print("SAME_POINT_DUEL_V4 peer relay guards: PASS")
