-- Executed only by the owning fresh-provider inside its original transaction,
-- AFTER an empty application-schema check on the verified newly initialized DB.
-- NOLOGIN compatibility roles carry no user identity or enrollment authority.
do $fresh_owner$
begin
  if current_user <> 'state_owner' or session_user <> 'state_owner' then
    raise exception 'fresh_schema_private_owner_required' using errcode='42501';
  end if;
end
$fresh_owner$;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema extensions authorization state_owner;
create extension pgcrypto with schema extensions;
create schema destruktion_meta authorization state_owner;
