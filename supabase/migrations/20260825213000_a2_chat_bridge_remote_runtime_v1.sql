-- METAENGINE H205F22 A2 remote chat-bridge runtime state.
-- This is a non-authority transport/scheduling surface. It is intentionally
-- separate from the prepared bridge receipt contract and does not enable it.

create table if not exists public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22 (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  label text not null default 'remote-v1',
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  last_used_at timestamptz null
);

create table if not exists public.compute_fabric_a2_chat_bridge_remote_peer_h205f22 (
  platform text primary key check (platform in ('CHATGPT', 'GLM_ZAI')),
  last_assistant_sha256 text null check (last_assistant_sha256 is null or last_assistant_sha256 ~ '^[0-9a-f]{64}$'),
  target_url_sha256 text null check (target_url_sha256 is null or target_url_sha256 ~ '^[0-9a-f]{64}$'),
  message_count bigint not null default 0 check (message_count >= 0),
  changed_at timestamptz not null default clock_timestamp(),
  observed_at timestamptz not null default clock_timestamp(),
  generating boolean not null default false,
  composer_present boolean not null default false,
  composer_empty boolean not null default true,
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.compute_fabric_a2_chat_bridge_remote_command_h205f22 (
  command_id uuid primary key,
  idempotency_key text not null check (idempotency_key ~ '^[0-9a-f]{64}$'),
  target_platform text not null check (target_platform in ('CHATGPT', 'GLM_ZAI')),
  target_agent text not null check (target_agent in ('GPT', 'GLM')),
  client_id text not null,
  status text not null check (status in ('LEASED', 'COMPLETED', 'FAILED')),
  created_at timestamptz not null default clock_timestamp(),
  leased_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz null,
  prompt_sha256 text not null check (prompt_sha256 ~ '^[0-9a-f]{64}$'),
  a2_head_message_seq bigint not null default 0 check (a2_head_message_seq >= 0),
  a2_peer_payloads_exposed boolean not null default false,
  duel_id uuid null,
  authority_effect boolean not null default false check (authority_effect = false),
  result_status text null,
  clicked_send_button boolean null,
  target_url_sha256 text null check (target_url_sha256 is null or target_url_sha256 ~ '^[0-9a-f]{64}$'),
  error_sha256 text null check (error_sha256 is null or error_sha256 ~ '^[0-9a-f]{64}$')
);

create index if not exists compute_fabric_a2_chat_bridge_remote_command_target_idx
  on public.compute_fabric_a2_chat_bridge_remote_command_h205f22 (target_platform, created_at desc);
create index if not exists compute_fabric_a2_chat_bridge_remote_command_idempotency_idx
  on public.compute_fabric_a2_chat_bridge_remote_command_h205f22 (idempotency_key, created_at desc);

alter table public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22 enable row level security;
alter table public.compute_fabric_a2_chat_bridge_remote_peer_h205f22 enable row level security;
alter table public.compute_fabric_a2_chat_bridge_remote_command_h205f22 enable row level security;

revoke all on table public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22 from public, anon, authenticated;
revoke all on table public.compute_fabric_a2_chat_bridge_remote_peer_h205f22 from public, anon, authenticated;
revoke all on table public.compute_fabric_a2_chat_bridge_remote_command_h205f22 from public, anon, authenticated;

grant select, insert, update, delete on table public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22 to service_role;
grant select, insert, update, delete on table public.compute_fabric_a2_chat_bridge_remote_peer_h205f22 to service_role;
grant select, insert, update, delete on table public.compute_fabric_a2_chat_bridge_remote_command_h205f22 to service_role;

comment on table public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22 is
  'Non-authority A2 browser bridge pairing hashes only; no Supabase backend key or raw browser text.';
comment on table public.compute_fabric_a2_chat_bridge_remote_peer_h205f22 is
  'Non-authority A2 browser bridge progress metadata only; no raw DOM/chat text.';
comment on table public.compute_fabric_a2_chat_bridge_remote_command_h205f22 is
  'Non-authority A2 browser bridge command/result metadata; prompts are never persisted here.';
