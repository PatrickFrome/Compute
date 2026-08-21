-- METAENGINE H205F22 / T0_HERMETIC_TOOLCHAIN_CONTRACT
-- Strict hermetic toolchain identity v2.
-- Applied to recovery project xpeibufgzjknrhbhpffp under roadmap evidence receipt #1.
-- Noncanonical and authority-free by design: no worker admission, no mainline checkpoint,
-- and no shared cache reuse is enabled by this file.

create or replace function destruktion_meta.compute_fabric_canonical_json_h205f22(p_value jsonb)
returns text
language plpgsql
immutable
security invoker
set search_path = pg_catalog, destruktion_meta
as $$
declare
  v_type text;
  v_result text;
begin
  v_type := jsonb_typeof(p_value);
  if v_type is null or v_type = 'null' then return 'null'; end if;
  if v_type = 'string' then return to_jsonb(p_value #>> '{}')::text; end if;
  if v_type = 'boolean' then return p_value::text; end if;
  if v_type = 'number' then
    raise exception 'numbers are forbidden in canonical identity JSON; encode integer semantics as decimal strings';
  end if;
  if v_type = 'array' then
    select '[' || coalesce(string_agg(
      destruktion_meta.compute_fabric_canonical_json_h205f22(value),
      ',' order by ordinality
    ), '') || ']'
    into v_result
    from jsonb_array_elements(p_value) with ordinality;
    return v_result;
  end if;
  if v_type = 'object' then
    if exists (select 1 from jsonb_object_keys(p_value) k where k !~ '^[ -~]+$') then
      raise exception 'canonical identity object keys must be printable ASCII';
    end if;
    select '{' || coalesce(string_agg(
      to_jsonb(key)::text || ':' || destruktion_meta.compute_fabric_canonical_json_h205f22(value),
      ',' order by key collate "C"
    ), '') || '}'
    into v_result
    from jsonb_each(p_value);
    return v_result;
  end if;
  raise exception 'unsupported JSON type: %', v_type;
end;
$$;

revoke all on function destruktion_meta.compute_fabric_canonical_json_h205f22(jsonb)
from public, anon, authenticated;
grant execute on function destruktion_meta.compute_fabric_canonical_json_h205f22(jsonb)
to service_role;

with c as (
  select jsonb_build_object(
    'schema','metaengine.compute.hermetic-toolchain-contract.h205f22.v2',
    'canonicalization','METAENGINE_CANONICAL_JSON_V1: UTF-8; printable-ASCII object keys sorted bytewise; arrays field-normalized then preserved; no whitespace; JSON numbers forbidden; integer semantics use decimal strings',
    'hash_algorithm','SHA256',
    'identity_domains',jsonb_build_array(
      'runtime','toolset','lockfiles','resolved_dependencies','platform','environment','execution_parameters'
    ),
    'runtime_identity',jsonb_build_object(
      'allowed_kinds',jsonb_build_array('OCI_IMAGE','HOST_FINGERPRINT'),
      'digest_format','sha256:<64hex>',
      'version_required','true'
    ),
    'toolset_identity',jsonb_build_object(
      'allowed_roles',jsonb_build_array(
        'compiler.c','compiler.cxx','compiler.rust','compiler.go',
        'runtime.python','runtime.node','runtime.jvm','linker','archiver',
        'build.bazel','build.cmake','build.ninja','build.make',
        'package.cargo','package.npm','package.pnpm','package.yarn',
        'package.pip','package.uv','package.go'
      ),
      'entry_fields',jsonb_build_array('role','name','version','sha256'),
      'ordering','role,name,version,sha256',
      'unknown_role_policy','REJECT'
    ),
    'lockfile_identity',jsonb_build_object(
      'entry_fields',jsonb_build_array('path','sha256'),
      'ordering','path,sha256',
      'duplicate_path_policy','REJECT'
    ),
    'dependency_identity',jsonb_build_object(
      'entry_fields',jsonb_build_array('uri','digest'),
      'ordering','uri,digest',
      'digest_format','sha256:<64hex>'
    ),
    'environment_identity',jsonb_build_object(
      'mode','EXACT_ALLOWLIST',
      'allowed_keys',jsonb_build_array('PATH','LC_ALL','TZ','SOURCE_DATE_EPOCH'),
      'required_keys',jsonb_build_array('PATH','LC_ALL','TZ','SOURCE_DATE_EPOCH'),
      'unknown_key_policy','REJECT',
      'secret_like_key_policy','REJECT'
    ),
    'platform_identity',jsonb_build_object(
      'required_keys',jsonb_build_array('os','arch'),
      'all_declared_properties_hashed','true'
    ),
    'execution_parameters',jsonb_build_object(
      'all_declared_properties_hashed','true',
      'all_values_strings','true'
    ),
    'top_level_unknown_field_policy','REJECT',
    'cache_namespace_rule','shared cache reuse forbidden until T1 proves identity equivalence on a real W1 worker',
    'authority_effect','false'
  ) as body
)
insert into destruktion_meta.compute_fabric_toolchain_contract_h205f22(
  contract_key,
  schema_version,
  hash_algorithm,
  environment_mode,
  required_environment_keys,
  contract,
  contract_sha256,
  enabled,
  canonical,
  authority_effect
)
select
  'hermetic-v2',
  2,
  'SHA256',
  -- Legacy storage constraint requires DECLARED_COMPLETE. The immutable contract
  -- itself strengthens this to EXACT_ALLOWLIST and the derive function enforces it.
  'DECLARED_COMPLETE',
  array['PATH','LC_ALL','TZ','SOURCE_DATE_EPOCH'],
  body,
  encode(extensions.digest(
    convert_to(destruktion_meta.compute_fabric_canonical_json_h205f22(body),'UTF8'),
    'sha256'
  ),'hex'),
  true,
  false,
  false
from c
on conflict (contract_key) do nothing;

create or replace function destruktion_meta.compute_fabric_derive_toolchain_identity_v2_h205f22(
  p_descriptor jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, destruktion_meta, extensions
as $$
declare
  v_c destruktion_meta.compute_fabric_toolchain_contract_h205f22%rowtype;
  v_runtime jsonb;
  v_tools jsonb;
  v_lockfiles jsonb;
  v_dependencies jsonb;
  v_platform jsonb;
  v_env jsonb;
  v_exec jsonb;
  v_entry jsonb;
  v_key text;
  v_val jsonb;
  v_allowed_env text[];
  v_allowed_roles text[];
  v_body jsonb;
  v_canonical text;
  v_sha text;
begin
  select * into v_c
  from destruktion_meta.compute_fabric_toolchain_contract_h205f22
  where contract_key='hermetic-v2' and enabled;
  if not found then raise exception 'active hermetic-v2 contract not found'; end if;

  if p_descriptor is null or jsonb_typeof(p_descriptor) <> 'object' then
    raise exception 'toolchain descriptor must be object';
  end if;
  if p_descriptor->>'schema' is distinct from 'metaengine.compute.toolchain-identity-input.h205f22.v2' then
    raise exception 'toolchain descriptor schema mismatch';
  end if;
  if exists(
    select 1 from jsonb_object_keys(p_descriptor) k
    where k not in ('schema','runtime','tools','lockfiles','dependencies','platform','environment','execution_parameters')
  ) then
    raise exception 'unknown top-level toolchain descriptor field';
  end if;

  v_runtime := p_descriptor->'runtime';
  if jsonb_typeof(v_runtime) <> 'object' then raise exception 'runtime descriptor required'; end if;
  if exists(select 1 from jsonb_object_keys(v_runtime) k where k not in ('kind','digest','version')) then
    raise exception 'unknown runtime field';
  end if;
  if v_runtime->>'kind' not in ('OCI_IMAGE','HOST_FINGERPRINT') then
    raise exception 'runtime kind invalid';
  end if;
  if coalesce(v_runtime->>'digest','') !~ '^sha256:[0-9a-f]{64}$' then
    raise exception 'runtime digest must be sha256:<64hex>';
  end if;
  if nullif(v_runtime->>'version','') is null then raise exception 'runtime version required'; end if;

  if jsonb_typeof(p_descriptor->'tools') <> 'array'
     or jsonb_array_length(p_descriptor->'tools') = 0 then
    raise exception 'non-empty tools array required';
  end if;
  select array_agg(value) into v_allowed_roles
  from jsonb_array_elements_text(v_c.contract#>'{toolset_identity,allowed_roles}');

  for v_entry in select value from jsonb_array_elements(p_descriptor->'tools') loop
    if jsonb_typeof(v_entry) <> 'object' then raise exception 'tool entry must be object'; end if;
    if exists(select 1 from jsonb_object_keys(v_entry) k where k not in ('role','name','version','sha256')) then
      raise exception 'unknown tool field';
    end if;
    if nullif(v_entry->>'role','') is null or not (v_entry->>'role' = any(v_allowed_roles)) then
      raise exception 'unknown tool role: %', coalesce(v_entry->>'role','<null>');
    end if;
    if nullif(v_entry->>'name','') is null
       or nullif(v_entry->>'version','') is null
       or coalesce(v_entry->>'sha256','') !~ '^[0-9a-f]{64}$' then
      raise exception 'every tool requires role,name,version,sha256';
    end if;
  end loop;

  if exists(
    select 1 from (
      select value->>'role' role, value->>'name' name, count(*) c
      from jsonb_array_elements(p_descriptor->'tools')
      group by 1,2 having count(*)>1
    ) d
  ) then raise exception 'duplicate tool role/name entries are forbidden'; end if;

  select coalesce(jsonb_agg(value order by value->>'role',value->>'name',value->>'version',value->>'sha256'),'[]'::jsonb)
  into v_tools
  from jsonb_array_elements(p_descriptor->'tools');

  if jsonb_typeof(p_descriptor->'lockfiles') <> 'array' then
    raise exception 'lockfiles must be explicit array';
  end if;
  for v_entry in select value from jsonb_array_elements(p_descriptor->'lockfiles') loop
    if jsonb_typeof(v_entry) <> 'object'
       or exists(select 1 from jsonb_object_keys(v_entry) k where k not in ('path','sha256')) then
      raise exception 'lockfile entry fields invalid';
    end if;
    if nullif(v_entry->>'path','') is null
       or coalesce(v_entry->>'sha256','') !~ '^[0-9a-f]{64}$' then
      raise exception 'lockfile entries require path+sha256';
    end if;
  end loop;
  if exists(
    select 1 from (
      select value->>'path' path,count(*) c
      from jsonb_array_elements(p_descriptor->'lockfiles')
      group by 1 having count(*)>1
    ) d
  ) then raise exception 'duplicate lockfile path forbidden'; end if;
  select coalesce(jsonb_agg(value order by value->>'path',value->>'sha256'),'[]'::jsonb)
  into v_lockfiles
  from jsonb_array_elements(p_descriptor->'lockfiles');

  if jsonb_typeof(p_descriptor->'dependencies') <> 'array' then
    raise exception 'dependencies must be explicit array';
  end if;
  for v_entry in select value from jsonb_array_elements(p_descriptor->'dependencies') loop
    if jsonb_typeof(v_entry) <> 'object'
       or exists(select 1 from jsonb_object_keys(v_entry) k where k not in ('uri','digest')) then
      raise exception 'dependency entry fields invalid';
    end if;
    if nullif(v_entry->>'uri','') is null
       or coalesce(v_entry->>'digest','') !~ '^sha256:[0-9a-f]{64}$' then
      raise exception 'dependency entries require uri+sha256 digest';
    end if;
  end loop;
  select coalesce(jsonb_agg(value order by value->>'uri',value->>'digest'),'[]'::jsonb)
  into v_dependencies
  from jsonb_array_elements(p_descriptor->'dependencies');

  v_platform := p_descriptor->'platform';
  if jsonb_typeof(v_platform) <> 'object'
     or nullif(v_platform->>'os','') is null
     or nullif(v_platform->>'arch','') is null then
    raise exception 'platform os+arch required';
  end if;
  for v_key,v_val in select key,value from jsonb_each(v_platform) loop
    if jsonb_typeof(v_val)<>'string' then raise exception 'platform values must be strings: %',v_key; end if;
  end loop;

  v_env := p_descriptor->'environment';
  if jsonb_typeof(v_env) <> 'object' then raise exception 'environment object required'; end if;
  select array_agg(value) into v_allowed_env
  from jsonb_array_elements_text(v_c.contract#>'{environment_identity,allowed_keys}');
  foreach v_key in array v_c.required_environment_keys loop
    if not (v_env ? v_key)
       or jsonb_typeof(v_env->v_key)<>'string'
       or nullif(v_env->>v_key,'') is null then
      raise exception 'required environment key missing or non-string: %',v_key;
    end if;
  end loop;
  for v_key,v_val in select key,value from jsonb_each(v_env) loop
    if not (v_key = any(v_allowed_env)) then raise exception 'environment key not allowlisted: %',v_key; end if;
    if jsonb_typeof(v_val)<>'string' then raise exception 'environment values must be strings: %',v_key; end if;
    if v_key ~* '(secret|token|password|credential|api[_-]?key|private[_-]?key)' then
      raise exception 'secret-like environment key forbidden: %',v_key;
    end if;
  end loop;
  if (v_env->>'SOURCE_DATE_EPOCH') !~ '^[0-9]+$' then
    raise exception 'SOURCE_DATE_EPOCH must be integer string';
  end if;

  v_exec := p_descriptor->'execution_parameters';
  if jsonb_typeof(v_exec) <> 'object' then raise exception 'execution_parameters object required'; end if;
  for v_key,v_val in select key,value from jsonb_each(v_exec) loop
    if jsonb_typeof(v_val)<>'string' then raise exception 'execution parameter values must be strings: %',v_key; end if;
  end loop;

  v_body := jsonb_build_object(
    'schema','metaengine.compute.toolchain-identity.h205f22.v2',
    'contract_key',v_c.contract_key,
    'contract_sha256',v_c.contract_sha256,
    'runtime',v_runtime,
    'tools',v_tools,
    'lockfiles',v_lockfiles,
    'dependencies',v_dependencies,
    'platform',v_platform,
    'environment',v_env,
    'execution_parameters',v_exec
  );
  v_canonical := destruktion_meta.compute_fabric_canonical_json_h205f22(v_body);
  v_sha := encode(extensions.digest(convert_to(v_canonical,'UTF8'),'sha256'),'hex');

  return v_body || jsonb_build_object(
    'toolchain_digest',v_sha,
    'toolchain_identity_sha256',v_sha,
    'canonicalization','METAENGINE_CANONICAL_JSON_V1',
    'cache_safe_identity',true,
    'canonical',false,
    'authority_effect',false
  );
end;
$$;

create or replace function destruktion_meta.compute_fabric_assert_toolchain_identity_v2_h205f22(
  p_descriptor jsonb,
  p_expected_sha256 text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, destruktion_meta
as $$
declare
  v_identity jsonb;
begin
  if coalesce(p_expected_sha256,'') !~ '^[0-9a-f]{64}$' then
    raise exception 'expected toolchain digest must be 64 lowercase hex';
  end if;
  v_identity := destruktion_meta.compute_fabric_derive_toolchain_identity_v2_h205f22(p_descriptor);
  if v_identity->>'toolchain_digest' is distinct from p_expected_sha256 then
    raise exception 'toolchain digest mismatch';
  end if;
  return v_identity;
end;
$$;

revoke all on function destruktion_meta.compute_fabric_derive_toolchain_identity_v2_h205f22(jsonb)
from public, anon, authenticated;
revoke all on function destruktion_meta.compute_fabric_assert_toolchain_identity_v2_h205f22(jsonb,text)
from public, anon, authenticated;
grant execute on function destruktion_meta.compute_fabric_derive_toolchain_identity_v2_h205f22(jsonb)
to service_role;
grant execute on function destruktion_meta.compute_fabric_assert_toolchain_identity_v2_h205f22(jsonb,text)
to service_role;

create or replace function destruktion_meta.compute_fabric_toolchain_v2_selftest_h205f22()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, destruktion_meta
as $$
declare
  v_a jsonb;
  v_b jsonb;
  v_bad jsonb;
  v_ia jsonb;
  v_ib jsonb;
  v_changed jsonb;
  v_expected constant text := 'f961eb7b2857ce50f39bfb9ba1640cfe260ea7050949e85f0eb4c2dedd42482c';
  v_unknown_env_rejected boolean := false;
  v_unknown_tool_rejected boolean := false;
  v_unknown_field_rejected boolean := false;
  v_mismatch_rejected boolean := false;
  v_bad_runtime_rejected boolean := false;
begin
  v_a := jsonb_build_object(
    'schema','metaengine.compute.toolchain-identity-input.h205f22.v2',
    'runtime',jsonb_build_object('kind','OCI_IMAGE','digest','sha256:'||repeat('1',64),'version','ubuntu-24.04'),
    'tools',jsonb_build_array(
      jsonb_build_object('role','compiler.c','name','clang','version','18.1.8','sha256',repeat('2',64)),
      jsonb_build_object('role','build.ninja','name','ninja','version','1.12.1','sha256',repeat('3',64))
    ),
    'lockfiles',jsonb_build_array(
      jsonb_build_object('path','Cargo.lock','sha256',repeat('4',64)),
      jsonb_build_object('path','pnpm-lock.yaml','sha256',repeat('5',64))
    ),
    'dependencies',jsonb_build_array(
      jsonb_build_object('uri','pkg:cargo/serde@1.0.219','digest','sha256:'||repeat('6',64)),
      jsonb_build_object('uri','pkg:npm/typescript@5.9.2','digest','sha256:'||repeat('7',64))
    ),
    'platform',jsonb_build_object('os','linux','arch','amd64','libc','glibc-2.39'),
    'environment',jsonb_build_object('PATH','/toolchain/bin','LC_ALL','C.UTF-8','TZ','UTC','SOURCE_DATE_EPOCH','0'),
    'execution_parameters',jsonb_build_object('target','x86_64-unknown-linux-gnu','optimization','release','lto','thin')
  );

  v_b := jsonb_build_object(
    'schema','metaengine.compute.toolchain-identity-input.h205f22.v2',
    'runtime',jsonb_build_object('version','ubuntu-24.04','digest','sha256:'||repeat('1',64),'kind','OCI_IMAGE'),
    'tools',jsonb_build_array(
      jsonb_build_object('sha256',repeat('3',64),'version','1.12.1','name','ninja','role','build.ninja'),
      jsonb_build_object('sha256',repeat('2',64),'version','18.1.8','name','clang','role','compiler.c')
    ),
    'lockfiles',jsonb_build_array(
      jsonb_build_object('sha256',repeat('5',64),'path','pnpm-lock.yaml'),
      jsonb_build_object('sha256',repeat('4',64),'path','Cargo.lock')
    ),
    'dependencies',jsonb_build_array(
      jsonb_build_object('digest','sha256:'||repeat('7',64),'uri','pkg:npm/typescript@5.9.2'),
      jsonb_build_object('digest','sha256:'||repeat('6',64),'uri','pkg:cargo/serde@1.0.219')
    ),
    'platform',jsonb_build_object('libc','glibc-2.39','arch','amd64','os','linux'),
    'environment',jsonb_build_object('SOURCE_DATE_EPOCH','0','TZ','UTC','LC_ALL','C.UTF-8','PATH','/toolchain/bin'),
    'execution_parameters',jsonb_build_object('lto','thin','optimization','release','target','x86_64-unknown-linux-gnu')
  );

  v_ia := destruktion_meta.compute_fabric_derive_toolchain_identity_v2_h205f22(v_a);
  v_ib := destruktion_meta.compute_fabric_derive_toolchain_identity_v2_h205f22(v_b);
  if v_ia->>'toolchain_digest' <> v_expected then
    raise exception 'fixture digest drift: expected %, got %', v_expected, v_ia->>'toolchain_digest';
  end if;
  if v_ia->>'toolchain_digest' <> v_ib->>'toolchain_digest' then
    raise exception 'field/order normalization failed';
  end if;

  v_changed := jsonb_set(v_a,'{tools,0,version}','"18.1.9"'::jsonb,false);
  if destruktion_meta.compute_fabric_derive_toolchain_identity_v2_h205f22(v_changed)->>'toolchain_digest' = v_expected then
    raise exception 'tool version mutation did not change digest';
  end if;

  v_changed := jsonb_set(v_a,'{lockfiles,0,sha256}',to_jsonb(repeat('8',64)),false);
  if destruktion_meta.compute_fabric_derive_toolchain_identity_v2_h205f22(v_changed)->>'toolchain_digest' = v_expected then
    raise exception 'lockfile mutation did not change digest';
  end if;

  v_changed := jsonb_set(v_a,'{execution_parameters,optimization}','"debug"'::jsonb,false);
  if destruktion_meta.compute_fabric_derive_toolchain_identity_v2_h205f22(v_changed)->>'toolchain_digest' = v_expected then
    raise exception 'execution parameter mutation did not change digest';
  end if;

  begin
    v_bad := jsonb_set(v_a,'{environment,HOME}','"/tmp"'::jsonb,true);
    perform destruktion_meta.compute_fabric_derive_toolchain_identity_v2_h205f22(v_bad);
  exception when others then v_unknown_env_rejected := true; end;

  begin
    v_bad := jsonb_set(v_a,'{tools,0,role}','"compiler.zig"'::jsonb,false);
    perform destruktion_meta.compute_fabric_derive_toolchain_identity_v2_h205f22(v_bad);
  exception when others then v_unknown_tool_rejected := true; end;

  begin
    v_bad := v_a || jsonb_build_object('ambient','forbidden');
    perform destruktion_meta.compute_fabric_derive_toolchain_identity_v2_h205f22(v_bad);
  exception when others then v_unknown_field_rejected := true; end;

  begin
    perform destruktion_meta.compute_fabric_assert_toolchain_identity_v2_h205f22(v_a, repeat('0',64));
  exception when others then v_mismatch_rejected := true; end;

  begin
    v_bad := jsonb_set(v_a,'{runtime,digest}','"sha256:deadbeef"'::jsonb,false);
    perform destruktion_meta.compute_fabric_derive_toolchain_identity_v2_h205f22(v_bad);
  exception when others then v_bad_runtime_rejected := true; end;

  if not (
    v_unknown_env_rejected
    and v_unknown_tool_rejected
    and v_unknown_field_rejected
    and v_mismatch_rejected
    and v_bad_runtime_rejected
  ) then raise exception 'one or more negative canaries failed'; end if;

  return jsonb_build_object(
    'schema','metaengine.compute.toolchain-selftest.h205f22.v2',
    'status','PASS',
    'fixture_digest',v_expected,
    'order_normalization',true,
    'tool_version_binding',true,
    'lockfile_binding',true,
    'execution_parameter_binding',true,
    'unknown_env_rejected',v_unknown_env_rejected,
    'unknown_tool_rejected',v_unknown_tool_rejected,
    'unknown_field_rejected',v_unknown_field_rejected,
    'digest_mismatch_rejected',v_mismatch_rejected,
    'bad_runtime_digest_rejected',v_bad_runtime_rejected,
    'authority_effect',false
  );
end;
$$;

revoke all on function destruktion_meta.compute_fabric_toolchain_v2_selftest_h205f22()
from public, anon, authenticated;
grant execute on function destruktion_meta.compute_fabric_toolchain_v2_selftest_h205f22()
to service_role;

-- Reproducible acceptance vector.
select destruktion_meta.compute_fabric_toolchain_v2_selftest_h205f22();
