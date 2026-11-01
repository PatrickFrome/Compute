// Private compatibility evidence for an EXISTING authenticated direct API login.
// No JSON/GUC admission, grants, credentials or role discovery. Not execution authority.
const tickets=new WeakMap(),readOnlyIdentities=new WeakMap();
const signature='public.native_coding_execution_context_v1(uuid,text,uuid,bigint)';
const identitySql=`select pg_catalog.current_database() as database_name,d.oid::text as database_oid,
 pg_catalog.pg_postmaster_start_time()::text as postmaster,pg_catalog.inet_server_addr()::text as address,pg_catalog.inet_server_port() as port,
 pg_catalog.pg_backend_pid() as backend,(select backend_start::text from pg_catalog.pg_stat_activity where pid=pg_catalog.pg_backend_pid()) as backend_start,session_user::text as session_login,current_user::text as current_login,
 r.oid::text as role_oid,r.rolcanlogin,r.rolinherit,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls,
 (select count(*)::int from pg_catalog.pg_auth_members where member=r.oid or roleid=r.oid) as memberships,
 pg_catalog.has_database_privilege(r.oid,d.oid,'CONNECT') as connect,pg_catalog.has_database_privilege(r.oid,d.oid,'CREATE') as database_create
 from pg_catalog.pg_database d,pg_catalog.pg_roles r where d.datname=pg_catalog.current_database() and r.rolname=current_user`;
const fail=()=>{throw Error('native_migration_api_identity_unattested');};
const sameDatabase=(a,b)=>['database_name','database_oid','postmaster','address','port'].every(k=>a[k]===b[k]);
function restricted(row,login){return row&&row.session_login===login&&row.current_login===login&&row.rolcanlogin===true
 && ['rolinherit','rolsuper','rolcreatedb','rolcreaterole','rolreplication','rolbypassrls','database_create'].every(k=>row[k]===false)
 && row.memberships===0&&row.connect===true;}
async function apiIdentity(apiSql,login){
 const [row]=await apiSql.unsafe(identitySql);if(!restricted(row,login))fail();
 const [grant]=await apiSql.unsafe(`select exists(select 1 from pg_catalog.pg_proc p,lateral pg_catalog.aclexplode(p.proacl) a
 where p.oid=pg_catalog.to_regprocedure($1) and a.grantee=$2::oid and a.privilege_type='EXECUTE' and not a.is_grantable) as direct_grant,
 exists(select 1 from pg_catalog.pg_proc p,lateral pg_catalog.aclexplode(p.proacl) a where p.oid=pg_catalog.to_regprocedure($1) and a.grantee=$2::oid and a.is_grantable) as grantable`,[signature,row.role_oid]);
 if(grant?.direct_grant!==true||grant.grantable!==false)fail();return row;
}
export async function attestNativeMigrationApiIdentity({apiSql,ownerSql,apiLogin}={}){
 if(typeof apiSql?.unsafe!=='function'||typeof ownerSql?.unsafe!=='function'||typeof apiLogin!=='string')fail();
 const api=await apiIdentity(apiSql,apiLogin),[owner]=await ownerSql.unsafe(identitySql);
 if(owner?.current_login!=='state_owner'||owner.session_login!=='state_owner'||!sameDatabase(api,owner))fail();
 const ticket=Object.freeze({});tickets.set(ticket,{apiSql,apiLogin,api,owner});return ticket;
}
async function consume(tx,ticket){
 const row=tickets.get(ticket);if(!row)fail();tickets.delete(ticket); // One attempt, including failures.
 await recheck(tx,row,true);return row;
}
async function recheck(tx,row,sameOwnerBackend){
 if(typeof tx?.unsafe!=='function')fail();
 const api=await apiIdentity(row.apiSql,row.apiLogin),[owner]=await tx.unsafe(identitySql);
 if(!sameDatabase(api,row.api)||api.role_oid!==row.api.role_oid||api.backend!==row.api.backend||api.backend_start!==row.api.backend_start
  ||!sameDatabase(owner,row.owner)||owner.current_login!=='state_owner'||owner.session_login!=='state_owner'
  ||sameOwnerBackend&&(owner.backend!==row.owner.backend||owner.backend_start!==row.owner.backend_start))fail();
 return Object.freeze({api_role_oid:api.role_oid,api_login:row.apiLogin});
}
// Private read-only consumption: no temp relation, GUC, marker or grants. Later
// checks permit another original owner transaction on the SAME database/PG birth;
// the authenticated API connection and exact principal cannot be replaced.
export async function consumeNativeMigrationApiIdentityReadOnly(tx,ticket){
 const row=await consume(tx,ticket),identity=Object.freeze({});readOnlyIdentities.set(identity,row);return identity;
}
export async function recheckNativeMigrationApiIdentityReadOnly(tx,identity){
 const row=readOnlyIdentities.get(identity);if(!row)fail();return recheck(tx,row,false);
}
export function releaseNativeMigrationApiIdentityReadOnly(identity){readOnlyIdentities.delete(identity);}
export async function bindNativeMigrationApiIdentity(tx,ticket){
 const row=await consume(tx,ticket),api=row.api;
 await tx.unsafe(`create temporary table native_callback_migration_api_identity_v1 (
 backend integer not null,backend_start timestamptz not null,transaction_id bigint not null,database_oid oid not null,postmaster timestamptz not null,
 role_oid oid not null,role_name text not null) on commit drop`);
 await tx.unsafe(`insert into pg_temp.native_callback_migration_api_identity_v1 values
 (pg_catalog.pg_backend_pid(),(select backend_start from pg_catalog.pg_stat_activity where pid=pg_catalog.pg_backend_pid()),pg_catalog.txid_current(),(select oid from pg_catalog.pg_database where datname=pg_catalog.current_database()),pg_catalog.pg_postmaster_start_time(),$1::oid,$2)`,[api.role_oid,row.apiLogin]);
}
