create table if not exists destruktion_meta.compute_continuity_domain_h205f22 (
  domain_key text primary key,
  provider_kind text not null,
  operator_class text not null,
  failure_domain text not null,
  independence_basis text not null,
  physical_region_independence_claimed boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (length(domain_key) between 3 and 160),
  check (length(operator_class) between 2 and 160),
  check (length(failure_domain) between 2 and 160)
);
create table if not exists destruktion_meta.compute_continuity_object_h205f22 (
  object_id uuid primary key default gen_random_uuid(),
  subject_kind text not null check (subject_kind in ('CHECKPOINT','ARTIFACT','BACKUP_SET')),
  subject_id text not null,
  expected_sha256 text not null check (expected_sha256 ~ '^[0-9a-f]{64}$'),
  expected_bytes bigint check (expected_bytes is null or expected_bytes >= 0),
  payload_root_sha256 text check (payload_root_sha256 is null or payload_root_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_checkpoint_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(subject_kind, subject_id, expected_sha256)
);
create table if not exists destruktion_meta.compute_continuity_observation_h205f22 (
  observation_id bigint generated always as identity primary key,
  object_id uuid not null references destruktion_meta.compute_continuity_object_h205f22(object_id),
  domain_key text not null references destruktion_meta.compute_continuity_domain_h205f22(domain_key),
  status text not null check (status in ('VERIFIED','MISMATCH','MISSING','STALE','ERROR')),
  observed_sha256 text check (observed_sha256 is null or observed_sha256 ~ '^[0-9a-f]{64}$'),
  observed_bytes bigint check (observed_bytes is null or observed_bytes >= 0),
  persisted_at timestamptz,
  readback_at timestamptz,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (readback_at is null or persisted_at is null or readback_at >= persisted_at)
);
create table if not exists destruktion_meta.compute_continuity_repair_h205f22 (
  repair_id uuid primary key default gen_random_uuid(),
  object_id uuid not null references destruktion_meta.compute_continuity_object_h205f22(object_id),
  bad_observation_id bigint not null references destruktion_meta.compute_continuity_observation_h205f22(observation_id),
  replacement_observation_id bigint not null references destruktion_meta.compute_continuity_observation_h205f22(observation_id),
  status text not null check (status = 'VERIFIED_REPLACEMENT'),
  receipt_sha256 text not null check (receipt_sha256 ~ '^[0-9a-f]{64}$'),
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (bad_observation_id <> replacement_observation_id),
  unique(bad_observation_id, replacement_observation_id)
);
create table if not exists destruktion_meta.compute_continuity_retention_event_h205f22 (
  event_id bigint generated always as identity primary key,
  lease_id uuid not null,
  action text not null check (action in ('ACQUIRE','RELEASE')),
  subject_kind text not null check (subject_kind in ('CHECKPOINT','ARTIFACT','BACKUP_SET')),
  subject_id text not null,
  lease_class text not null,
  valid_until timestamptz,
  release_of_event_id bigint references destruktion_meta.compute_continuity_retention_event_h205f22(event_id),
  reason text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check ((action='ACQUIRE' and release_of_event_id is null) or (action='RELEASE' and release_of_event_id is not null))
);
create table if not exists destruktion_meta.compute_continuity_restore_drill_h205f22 (
  restore_receipt_id uuid primary key default gen_random_uuid(),
  object_id uuid not null references destruktion_meta.compute_continuity_object_h205f22(object_id),
  domain_key text not null references destruktion_meta.compute_continuity_domain_h205f22(domain_key),
  status text not null check (status in ('PASS','FAIL')),
  readback_verified boolean not null default false,
  restored_sha256 text check (restored_sha256 is null or restored_sha256 ~ '^[0-9a-f]{64}$'),
  started_at timestamptz not null,
  finished_at timestamptz not null,
  receipt_sha256 text not null check (receipt_sha256 ~ '^[0-9a-f]{64}$'),
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (finished_at >= started_at)
);
create table if not exists destruktion_meta.compute_continuity_recovery_graph_node_h205f22 (
  graph_key text not null,
  node_kind text not null,
  node_key text not null,
  node_sha256 text not null check (node_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key(graph_key,node_kind,node_key)
);
create table if not exists destruktion_meta.compute_continuity_recovery_graph_snapshot_h205f22 (
  graph_key text primary key,
  base_object_id uuid references destruktion_meta.compute_continuity_object_h205f22(object_id),
  node_count integer not null check (node_count >= 1),
  graph_root_sha256 text not null check (graph_root_sha256 ~ '^[0-9a-f]{64}$'),
  root_line_format text not null default 'TYPE<TAB>KEY<TAB>NODE_SHA256 sorted lexicographically',
  status text not null default 'SEALED' check (status='SEALED'),
  created_at timestamptz not null default now()
);
create table if not exists destruktion_meta.compute_continuity_checkpoint_ledger_h205f22 (
  continuity_checkpoint_id text primary key,
  parent_continuity_checkpoint_id text references destruktion_meta.compute_continuity_checkpoint_ledger_h205f22(continuity_checkpoint_id),
  semantic_head_checkpoint_id text not null,
  milestone_key text not null default 'R1_CONTINUITY_PLANE_ADOPTION',
  state text not null check (state in ('IMPLEMENTED','TESTED','EVIDENCE_READY')),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists destruktion_meta.compute_continuity_persisted_seal_h205f22 (
  seal_id uuid primary key default gen_random_uuid(),
  object_id uuid not null references destruktion_meta.compute_continuity_object_h205f22(object_id),
  seal_kind text not null default 'PERSISTED_READBACK_QUORUM' check (seal_kind='PERSISTED_READBACK_QUORUM'),
  readiness jsonb not null,
  receipt_sha256 text not null check (receipt_sha256 ~ '^[0-9a-f]{64}$'),
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(object_id,receipt_sha256)
);
create index if not exists compute_continuity_observation_object_domain_idx on destruktion_meta.compute_continuity_observation_h205f22(object_id,domain_key,observation_id desc);
create index if not exists compute_continuity_observation_domain_idx on destruktion_meta.compute_continuity_observation_h205f22(domain_key);
create index if not exists compute_continuity_repair_object_idx on destruktion_meta.compute_continuity_repair_h205f22(object_id);
create index if not exists compute_continuity_repair_replacement_idx on destruktion_meta.compute_continuity_repair_h205f22(replacement_observation_id);
create index if not exists compute_continuity_retention_subject_idx on destruktion_meta.compute_continuity_retention_event_h205f22(subject_kind,subject_id,lease_id,event_id desc);
create index if not exists compute_continuity_retention_release_idx on destruktion_meta.compute_continuity_retention_event_h205f22(release_of_event_id);
create index if not exists compute_continuity_restore_object_domain_idx on destruktion_meta.compute_continuity_restore_drill_h205f22(object_id,domain_key,finished_at desc);
create index if not exists compute_continuity_restore_domain_idx on destruktion_meta.compute_continuity_restore_drill_h205f22(domain_key);
create index if not exists compute_continuity_graph_snapshot_object_idx on destruktion_meta.compute_continuity_recovery_graph_snapshot_h205f22(base_object_id);
create index if not exists compute_continuity_checkpoint_parent_idx on destruktion_meta.compute_continuity_checkpoint_ledger_h205f22(parent_continuity_checkpoint_id);
