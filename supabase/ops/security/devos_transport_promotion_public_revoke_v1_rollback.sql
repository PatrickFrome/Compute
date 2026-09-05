-- EMERGENCY ROLLBACK for devos_transport_promotion_public_revoke_v1.sql.
-- This intentionally restores the legacy PUBLIC execute surface and therefore re-opens
-- the security condition this change is designed to remove. Use only if the intended
-- service-role caller path cannot sustain production during the bounded change window.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

DO $guard$
begin
  if coalesce(current_setting('metaengine.promotion_rpc_acl_rollback_approved', true), 'off') <> 'on' then
    raise exception using
      errcode = '55000',
      message = 'promotion_rpc_acl_rollback_not_approved';
  end if;
end
$guard$;

grant execute on function public.devos_transport_promotion_lease_v1(text,text,integer,text,text,integer,integer)
  to public;
grant execute on function public.devos_transport_promotion_release_v1(text,text,text)
  to public;

commit;
