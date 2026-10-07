-- Disposable CI fixture only.
alter table public.compute_fabric_a2_browser_supervisor_state_h205f22 add column last_seen_at timestamptz default clock_timestamp(),add column state jsonb;
create table public.compute_fabric_a2_browser_supervisor_command_h205f22(command_id uuid primary key,workspace_id uuid,target_client_id text,issued_by text,action text,platform text,payload jsonb,status text,issued_at timestamptz,expires_at timestamptz,authority_effect boolean,idempotency_key text);
create unique index issuer_idempotency on public.compute_fabric_a2_browser_supervisor_command_h205f22(workspace_id,idempotency_key) where idempotency_key is not null;
