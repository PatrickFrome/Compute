-- METAENGINE Browser Supervisor — ChatGPT-only active command platform.
--
-- Historical GLM/ZAI command rows remain admissible as terminal evidence, but
-- no new or updated active command may enter PENDING/LEASED on the legacy
-- provider. This is a DB-authority fence below Edge routing and Browser
-- physical execution, so stale callers cannot reactivate GLM by bypassing UI
-- or source-level provider policy.

alter table public.compute_fabric_a2_browser_supervisor_command_h205f22
  add constraint a2_browser_supervisor_command_no_active_legacy_platform_ck
  check (
    platform is distinct from 'GLM_ZAI'
    or status not in ('PENDING','LEASED')
  )
  not valid;

alter table public.compute_fabric_a2_browser_supervisor_command_h205f22
  validate constraint a2_browser_supervisor_command_no_active_legacy_platform_ck;

comment on constraint a2_browser_supervisor_command_no_active_legacy_platform_ck
  on public.compute_fabric_a2_browser_supervisor_command_h205f22 is
  'ChatGPT-only active execution fence. Historical terminal GLM/ZAI rows remain read-compatible.';
