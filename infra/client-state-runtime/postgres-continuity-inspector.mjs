import {classifyPostgresUtilityFailure} from './postgres-utility-diagnostic.mjs';

// The startup psql qualification stays independent. Continuous health uses
// one bounded connection rather than creating a Windows process every 2s.
export async function createPostgresContinuityInspector(config,{connect}={}) {
  if(!connect) {const module=await import('postgres');connect=module.default;}
  const sql=connect(config.inspectDatabaseUrl,{max:1,prepare:false,connect_timeout:3,idle_timeout:60,
    connection:{statement_timeout:4000,application_name:'metaengine-runtime-continuity'},onnotice:()=>{}});
  let closed=false,pending=null;
  return Object.freeze({
    inspect() {
      if(closed) return Promise.reject(Object.assign(new Error('postgres_inspection_failed'),{code:'postgres_inspection_failed'}));
      if(pending) return pending;
      pending=(async()=>{
        try {
          const rows=await sql.unsafe(`select json_build_object('data_directory',current_setting('data_directory'),
            'version',current_setting('server_version_num')::int,'address',host(inet_server_addr()),
            'port',inet_server_port(),'started_at',pg_postmaster_start_time()
            ${config.expectedClusterSystemIdentifier?",'system_identifier',(select system_identifier::text from pg_catalog.pg_control_system())":''}) as identity`);
          if(closed||!Array.isArray(rows)||rows.length!==1||!rows[0].identity||typeof rows[0].identity!=='object') throw Error('invalid_identity_readback');
          return {...rows[0].identity};
        } catch(cause) {
          const state=/^[0-9A-Z]{5}$/.test(cause?.code||'')?cause.code:null;
          const text=state?`SQLSTATE ${state}`:['ECONNREFUSED','ECONNRESET'].includes(cause?.code)?'connection refused'
            :['CONNECT_TIMEOUT','ETIMEDOUT'].includes(cause?.code)?'connection timed out':'';
          const code=classifyPostgresUtilityFailure(text).code;
          throw Object.assign(new Error(code),{code});
        } finally {pending=null;}
      })();
      return pending;
    },
    async close(){if(closed)return;closed=true;await sql.end({timeout:5});},
  });
}
