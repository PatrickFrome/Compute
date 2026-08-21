create index if not exists compute_continuity_observation_object_domain_idx on destruktion_meta.compute_continuity_observation_h205f22(object_id, domain_key, observation_id desc);
comment on table destruktion_meta.compute_continuity_checkpoint_ledger_h205f22 is 'H205F22 R1 append-only continuity step ledger. This is not the supervisor mainline checkpoint seal.';
