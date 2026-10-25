import {validateCheckpointDatabaseUrl} from '../development-checkpoint.mjs';

// This qualification is authorized only for the existing ephemeral CI service,
// never an installed Owner database or an arbitrary DATABASE_URL fallback.
export function nativeCodingPgPoolFixtureTarget(env=process.env) {
  const fail=()=>{throw Error('native_pool_explicit_checkpoint_ci_fixture_required');};
  if(env.METAENGINE_NATIVE_POOL_PG17!=='1'||env.GITHUB_ACTIONS!=='true')fail();
  const value=env.LOCAL_STATE_TEST_ADMIN_DATABASE_URL;
  let url;
  try{validateCheckpointDatabaseUrl(value);url=new URL(value);}catch{fail();}
  if(url.hostname!=='127.0.0.1'||url.port!=='5432'||url.pathname!=='/checkpoint_fixture'
    ||url.username!=='postgres'||url.password!=='checkpoint-fixture-only'
    ||url.search||url.hash||value.includes('?')||value.includes('#'))fail();
  return value;
}

export function nativeCodingPhysicalIdentitySql(source) {
  const matches=typeof source==='string'?[...source.matchAll(
    /const rows=await reader\.unsafe\(`(select current_setting\('data_directory'\)[\s\S]*?)`\);/g)]:[];
  if(matches.length!==1)throw Error('native_pool_physical_identity_sql_unavailable');
  return matches[0][1];
}
