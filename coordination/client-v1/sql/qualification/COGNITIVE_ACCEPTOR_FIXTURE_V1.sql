-- Disposable CI fixture only. NEVER apply this file to a connected project.
create schema extensions;create extension pgcrypto with schema extensions;
create role anon;create role authenticated;create role service_role bypassrls;
create schema realtime;
create table public.compute_fabric_a2_browser_device_h205f22(device_id uuid primary key,client_id text not null,active boolean not null,revoked_at timestamptz);
create table public.compute_fabric_a2_browser_supervisor_state_h205f22(client_id text primary key,workspace_id uuid not null);
create table realtime.messages(id uuid primary key,payload jsonb,event text,topic text,private boolean,extension text);
grant usage on schema public,extensions,realtime to service_role;
grant select on public.compute_fabric_a2_browser_device_h205f22,public.compute_fabric_a2_browser_supervisor_state_h205f22 to service_role;
grant select,insert on realtime.messages to service_role;
create function realtime.send(payload jsonb,event text,topic text,private boolean default true)
returns void language plpgsql as $f$
begin
 if current_setting('test.drop_broadcast',true)='true' then raise warning 'fixture broadcast unavailable';return;end if;
 insert into realtime.messages values(gen_random_uuid(),payload,event,topic,private,'broadcast');
end;$f$;
