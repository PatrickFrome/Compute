-- Cover event-result foreign keys used by reverse lookup and FK maintenance.
create index if not exists compute_fabric_a2_sync_round_gpt_event_idx
  on destruktion_meta.compute_fabric_a2_sync_round_h205f22(gpt_event_id)
  where gpt_event_id is not null;
create index if not exists compute_fabric_a2_sync_round_glm_event_idx
  on destruktion_meta.compute_fabric_a2_sync_round_h205f22(glm_event_id)
  where glm_event_id is not null;
