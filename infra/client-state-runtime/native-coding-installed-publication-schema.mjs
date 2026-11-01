import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {nativePhysicalSettlementUnconfirmed,markNativePhysicalSettlementUnconfirmed} from '../../apps/metaengine-browser/src/native-coding-host-settlement.mjs';
import {assertNativeCodingTransactionPoolScope} from './native-coding-preparation-transaction.mjs';
import {attestNativeMigrationApiIdentity,consumeNativeMigrationApiIdentityReadOnly,
 recheckNativeMigrationApiIdentityReadOnly,releaseNativeMigrationApiIdentityReadOnly} from './native-coding-migration-api-identity.mjs';

// A bounded installed-schema prerequisite, NOT Owner/native/loaded-code proof.
// No migration/DO execution, role provisioning, durable marker or effect authority.
// Host must retain its existing runtime pathname lock + source/native/control
// lifetime and synchronously assert that lifetime at every call/COMMIT. Canonical
// migrations use the same advisory key exclusively; the original monitored
// reservation holds its shared SESSION lock before BEGIN through settlement. Arbitrary privileged DDL
// outside those existing locks is NOT made safe by a cached startup observation.
const READ_ONLY='isolation level repeatable read read only',SERIALIZABLE='isolation level serializable';
const fail=reason=>{throw Error('native_installed_publication_schema_'+reason);};
const hash=text=>createHash('sha256').update(text).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sources=[new URL('./native-coding-callback-publication-v1.sql',import.meta.url),
 new URL('./native-coding-initial-anchor-task-fence-v1.sql',import.meta.url),
 new URL('../../supabase/migrations/20261023082533_native_coding_operator_qa_admission_v1.sql',import.meta.url)];
const tables=['native_coding_execution_h205f22','native_coding_job_registration_h205f22','devos_fleet_claim_h205f22','devos_fleet_task_h205f22'];

async function reviewedSources(){
 const observations=await Promise.allSettled(sources.map(url=>readFile(url,'utf8')));
 const rejected=observations.find(row=>row.status==='rejected');if(rejected)throw rejected.reason;
 const bytes=observations.map(row=>row.value),[callback,fence]=bytes;
 const raw=callback.match(/declare expected jsonb:='([^']+)'::jsonb;/)?.[1];
 const lists=[...fence.matchAll(/jsonb_array_elements\('([^']+)'::jsonb\)/g)].map(m=>JSON.parse(m[1]));
 if(!raw||lists.length!==2)fail('source_review_changed');
 const specs=JSON.parse(raw),[predecessors,anchors]=lists;
 if(specs.length!==8||predecessors.length!==5||anchors.length!==4)fail('source_review_changed');
 for(const spec of predecessors){
  const prior=specs.find(x=>x.signature===spec.signature);
  if(prior){if(prior.sha256!==spec.sha256||prior.definer!==spec.definer||prior.volatile!==spec.volatility||prior.return_type!==spec.returns)fail('source_review_changed');}
  else specs.push({...spec,args:[],return_type:spec.returns,language:'plpgsql',volatile:spec.volatility,defaults:0,public_context:false});
 }
 for(const spec of anchors)specs.push({...spec,args:[],return_type:'trigger',language:'plpgsql',definer:false,volatile:'v',defaults:0,public_context:false});
 // The review hashes are read from shipped SQL, and checked AGAINST the shipped
 // definitions. They are not copied into this module as an independent root.
 const definitions=new Map();
 for(const source of bytes)for(const m of source.matchAll(/create(?: or replace)? function ([a-z0-9_.]+)\([\s\S]*?\bas \$\$([\s\S]*?)\$\$;/g))if(!definitions.has(m[1]))definitions.set(m[1],m[2]);
 for(const spec of specs){const body=definitions.get(spec.signature.split('(')[0]);if(body===undefined||hash(body.replaceAll('\r\n','\n'))!==spec.sha256)fail('source_body_changed');}
 const triggers=[{signature:'destruktion_meta.native_coding_callback_publication_guard_v1()',table:tables[0],trigger:'native_callback_publication_guard_v1',tgtype:31},...anchors];
 for(const spec of triggers){
  const source=spec.trigger==='native_callback_publication_guard_v1'?callback:fence;
  const events=spec.tgtype===31?'insert or update or delete':spec.tgtype===7?'insert':'update';
  const definition=`create trigger ${spec.trigger} before ${events} on destruktion_meta.${spec.table} for each row execute function ${spec.signature};`;
  if(!source.replace(/\s+/g,' ').includes(definition))fail('source_trigger_changed');
 }
 return {digest:hash(JSON.stringify(bytes)),specs,triggers};
}
const IDENTITY_SQL=`select pg_catalog.current_database() as database_name,
 (select oid::text from pg_catalog.pg_database where datname=pg_catalog.current_database()) as database_oid,
 (select system_identifier::text from pg_catalog.pg_control_system()) as system_identifier,
 pg_catalog.pg_postmaster_start_time()::text as postmaster,pg_catalog.current_setting('data_directory') as data_directory,
 pg_catalog.inet_server_addr()::text as address,pg_catalog.inet_server_port() as port,
 pg_catalog.current_setting('server_version_num')::int as version,current_user::text as current_login,session_user::text as session_login,
 pg_catalog.current_setting('transaction_isolation') as isolation,pg_catalog.current_setting('transaction_read_only') as read_only,
 pg_catalog.current_setting('session_replication_role') as replication_role`;
const FUNCTIONS_SQL=`select s->>'signature' as signature,p.oid::text as oid,pg_catalog.pg_get_userbyid(p.proowner) as owner,
 pg_catalog.format_type(p.prorettype,null) as return_type,p.proretset,p.prokind,p.proisstrict,p.proleakproof,p.proparallel,
 p.provolatile as volatile,l.lanname as language,p.prosecdef as definer,p.pronargdefaults as defaults,p.provariadic::text as variadic,
 p.prosupport::oid::text as support,p.proargnames as args,p.proargmodes,p.proallargtypes,p.proconfig,p.prosrc,
 pg_catalog.pg_get_expr(p.proargdefaults,0) as default_expr,
 coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('grantee',a.grantee::text,'grantor',a.grantor::text,'privilege',a.privilege_type,'grantable',a.is_grantable))
 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a),'[]'::jsonb) as acl,
 p.proowner::text as owner_oid,pg_catalog.to_regrole('service_role')::oid::text as service_oid
 from pg_catalog.jsonb_array_elements($1::text::jsonb) s left join pg_catalog.pg_proc p on p.oid=pg_catalog.to_regprocedure(s->>'signature')
 left join pg_catalog.pg_language l on l.oid=p.prolang`;
const TABLES_SQL=`select n as name,c.oid::text as oid,c.relkind,c.relpersistence,c.relispartition,c.relrowsecurity,c.relforcerowsecurity,
 pg_catalog.pg_get_userbyid(c.relowner) as owner,
 exists(select 1 from pg_catalog.pg_policy where polrelid=c.oid) as policies,
 exists(select 1 from pg_catalog.pg_rewrite where ev_class=c.oid) as rules,
 exists(select 1 from pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a where a.grantee<>c.relowner) as external_acl,
 exists(select 1 from pg_catalog.pg_attribute a,lateral pg_catalog.aclexplode(a.attacl) x where a.attrelid=c.oid and x.grantee<>c.relowner) as column_acl
 from pg_catalog.jsonb_array_elements_text($1::text::jsonb) n left join pg_catalog.pg_class c on c.oid=pg_catalog.to_regclass('destruktion_meta.'||n)`;
const SHAPE_SQL=`select
 exists(select 1 from pg_catalog.pg_attribute a where a.attrelid=pg_catalog.to_regclass('destruktion_meta.native_coding_execution_h205f22')
  and a.attname='callback_publication' and not a.attisdropped and a.atttypid=pg_catalog.to_regtype('jsonb') and not a.attnotnull
  and a.attidentity='' and a.attgenerated='' and not a.atthasdef
  and not exists(select 1 from pg_catalog.pg_attrdef d where d.adrelid=a.attrelid and d.adnum=a.attnum)) as column_valid,
 exists(select 1 from pg_catalog.pg_constraint c join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attname='callback_publication'
  where c.conrelid=pg_catalog.to_regclass('destruktion_meta.native_coding_execution_h205f22') and c.conname='native_callback_publication_shape_v1'
  and c.contype='c' and c.convalidated and not c.condeferrable and not c.condeferred and not c.connoinherit and c.conislocal and c.coninhcount=0
  and c.conkey=array[a.attnum]::smallint[] and pg_catalog.pg_get_expr(c.conbin,c.conrelid)='destruktion_meta.native_coding_callback_publication_valid_v1(callback_publication)') as shape_valid,
 exists(select 1 from pg_catalog.pg_constraint c join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attname='task_id'
  join pg_catalog.pg_index i on i.indexrelid=c.conindid join pg_catalog.pg_class ic on ic.oid=i.indexrelid join pg_catalog.pg_am am on am.oid=ic.relam
  where c.conrelid=pg_catalog.to_regclass('destruktion_meta.native_coding_execution_h205f22') and c.conname='native_execution_one_task_v1'
  and c.contype='u' and c.convalidated and not c.condeferrable and not c.condeferred and c.conislocal and c.coninhcount=0
  and not a.attisdropped and a.atttypid=pg_catalog.to_regtype('uuid') and a.attnotnull and a.attidentity='' and a.attgenerated=''
  and c.conkey=array[a.attnum]::smallint[] and i.indrelid=c.conrelid and i.indisunique and i.indisvalid and i.indisready and i.indislive and i.indimmediate
  and not i.indisprimary and not i.indnullsnotdistinct and i.indnatts=1 and i.indnkeyatts=1 and i.indkey::text=a.attnum::text and i.indoption::text='0'
  and i.indcollation::text='0' and i.indexprs is null and i.indpred is null and am.amname='btree'
  and i.indclass[0]=(select o.oid from pg_catalog.pg_opclass o join pg_catalog.pg_namespace n on n.oid=o.opcnamespace where n.nspname='pg_catalog' and o.opcname='uuid_ops' and o.opcmethod=am.oid)
  and ic.relkind='i' and ic.relpersistence='p' and not ic.relispartition and ic.relowner=pg_catalog.to_regrole('state_owner')) as unique_valid`;
const TRIGGERS_SQL=`select s->>'trigger' as name,t.oid::text as oid,
 t.tgfoid=pg_catalog.to_regprocedure(s->>'signature') as function_valid,t.tgtype,t.tgenabled,t.tgisinternal,t.tgnargs,
 t.tgqual is null as no_qual,t.tgattr::text as attrs,pg_catalog.encode(t.tgargs,'hex') as args,
 t.tgconstraint::text as constraint_oid,t.tgparentid::text as parent_oid,t.tgdeferrable,t.tginitdeferred,t.tgoldtable,t.tgnewtable
 from pg_catalog.jsonb_array_elements($1::text::jsonb) s left join pg_catalog.pg_trigger t
 on t.tgrelid=pg_catalog.to_regclass('destruktion_meta.'||(s->>'table')) and t.tgname=s->>'trigger'`;
const API_ROLE_SQL=`select r.oid::text as oid from pg_catalog.pg_roles r where r.oid=$1::oid and r.rolname=$2
 and r.rolcanlogin and not r.rolinherit and not r.rolsuper and not r.rolcreatedb and not r.rolcreaterole and not r.rolreplication and not r.rolbypassrls
 and not exists(select 1 from pg_catalog.pg_auth_members m where m.member=r.oid or m.roleid=r.oid)
 and pg_catalog.has_database_privilege(r.oid,pg_catalog.current_database(),'CONNECT') and not pg_catalog.has_database_privilege(r.oid,pg_catalog.current_database(),'CREATE')`;

async function catalog(tx,reviewed,api,read,mode){
 const [identity]=await read(tx,IDENTITY_SQL);
 if(!identity||identity.version<170000||identity.version>=180000||identity.current_login!=='state_owner'||identity.session_login!=='state_owner'
  ||identity.replication_role!=='origin'||identity.isolation!==(mode===READ_ONLY?'repeatable read':'serializable')||mode===READ_ONLY&&identity.read_only!=='on')fail('postgres_identity');
 const [role]=await read(tx,API_ROLE_SQL,[api.api_role_oid,api.api_login]);if(role?.oid!==api.api_role_oid)fail('api_principal');
 const functions=await read(tx,FUNCTIONS_SQL,[JSON.stringify(reviewed.specs)]);
 if(functions.length!==reviewed.specs.length)fail('functions');
 for(const spec of reviewed.specs){
  const f=functions.find(x=>x.signature===spec.signature);
  if(!f?.oid||f.owner!=='state_owner'||f.return_type!==spec.return_type||f.proretset||f.prokind!=='f'||f.proisstrict||f.proleakproof||f.proparallel!=='u'
   ||f.volatile!==spec.volatile||f.language!==spec.language||f.definer!==spec.definer||f.defaults!==spec.defaults||f.variadic!=='0'||f.support!=='0'
   ||!same(f.args??[],spec.args)||f.proargmodes!==null||f.proallargtypes!==null||!same(f.proconfig,['search_path=pg_catalog, destruktion_meta'])
   ||typeof f.prosrc!=='string'||hash(f.prosrc.replaceAll('\r\n','\n'))!==spec.sha256||f.default_expr!==(spec.defaults?'NULL::text, NULL::text':null))fail('function');
  if(!Array.isArray(f.acl)||!f.acl.length||f.acl.some(a=>a.grantor!==f.owner_oid||a.privilege!=='EXECUTE'||a.grantable
   ||a.grantee!==f.owner_oid&&!(spec.public_context&&(a.grantee===api.api_role_oid||a.grantee===f.service_oid)))
   ||spec.public_context&&!f.acl.some(a=>a.grantee===api.api_role_oid))fail('function_acl');
 }
 const relations=await read(tx,TABLES_SQL,[JSON.stringify(tables)]);
 if(relations.length!==tables.length||tables.some(name=>!relations.some(r=>r.name===name&&r.oid&&r.owner==='state_owner'&&r.relkind==='r'&&r.relpersistence==='p'
  &&!r.relispartition&&r.relrowsecurity&&!r.relforcerowsecurity&&!r.policies&&!r.rules&&!r.external_acl&&!r.column_acl)))fail('table');
 const [history]=await read(tx,`select exists(select 1 from destruktion_meta.native_coding_execution_h205f22 group by task_id having count(*)>1) as duplicates`);
 if(history?.duplicates!==false)fail('duplicate_history');
 const [shape]=await read(tx,SHAPE_SQL);if(!shape?.column_valid||!shape.shape_valid||!shape.unique_valid)fail('shape');
 const triggers=await read(tx,TRIGGERS_SQL,[JSON.stringify(reviewed.triggers)]);
 if(triggers.length!==reviewed.triggers.length||reviewed.triggers.some(s=>!triggers.some(t=>t.name===s.trigger&&t.oid&&t.function_valid&&t.tgtype===s.tgtype&&t.tgenabled==='O'
  &&!t.tgisinternal&&t.tgnargs===0&&t.no_qual&&t.attrs===''&&t.args===''&&t.constraint_oid==='0'&&t.parent_oid==='0'&&!t.tgdeferrable&&!t.tginitdeferred&&t.tgoldtable===null&&t.tgnewtable===null)))fail('trigger');
 const {isolation,read_only,...incarnation}=identity;return incarnation;
}

export function createNativeInstalledPublicationSchemaVerifier({ownerSql,apiSql,apiLogin,assertCurrent,signal}={}){
 if(typeof ownerSql?.begin!=='function'||typeof apiSql?.unsafe!=='function'||typeof apiLogin!=='string'||typeof assertCurrent!=='function'
  ||typeof signal?.addEventListener!=='function'||typeof signal?.aborted!=='boolean')fail('dependencies');
 let state='NEW',identity=null,reviewed=null,pg=null;const pending=new Set(),guarded=new WeakSet();
 const close=()=>{state='CLOSED';if(identity)releaseNativeMigrationApiIdentityReadOnly(identity);signal.removeEventListener('abort',close);};
 const open=()=>{if(state==='CLOSED'||signal.aborted)fail('closed');const result=assertCurrent();if(result!==undefined){if(result?.then)Promise.resolve(result).catch(()=>{});fail('lifetime_assertion');}};
 const read=async(tx,q,args=[])=>{open();tx.assertOpen();const value=await tx.unsafe(q,args);open();tx.assertOpen();return value;};
 const track=fn=>{const operation=Promise.resolve().then(fn).catch(error=>{close();
  const safe=/^native_(?:installed_publication_schema_[a-z_]+|workspace_transaction_[a-z_]+|migration_api_identity_unattested)$/.test(error?.message||'')
   ?error:Error('native_installed_publication_schema_check_failed');
  throw nativePhysicalSettlementUnconfirmed(error)?markNativePhysicalSettlementUnconfirmed(safe):safe;
 });pending.add(operation);operation.then(()=>pending.delete(operation),()=>pending.delete(operation));return operation;};
 const inScope=async(tx,mode,fn)=>{
  assertNativeCodingTransactionPoolScope(ownerSql,tx,mode,{unqueried:!guarded.has(tx),publicationFence:true});open();
  if(!guarded.has(tx)){
   // Retain through physical COMMIT/ROLLBACK; monitor signals only this exact
   // reservation's connection death, never a later pool user's lifetime.
   tx.signal.addEventListener('abort',close,{once:true});tx.addCommitGuard(open);
   guarded.add(tx);
  }
  await fn();open();
 };
 const verifySources=async()=>{const current=await reviewedSources();open();if(reviewed&&current.digest!==reviewed.digest)fail('source_changed');return current;};
 signal.addEventListener('abort',close,{once:true});if(signal.aborted)close();
 return Object.freeze({
  attest(){if(state!=='NEW')return Promise.reject(Error('native_installed_publication_schema_attestation_repeated'));state='ATTESTING';
   return track(async()=>{open();reviewed=await verifySources();
    await ownerSql.begin(READ_ONLY,tx=>inScope(tx,READ_ONLY,async()=>{
     const ticket=await attestNativeMigrationApiIdentity({apiSql,ownerSql:tx,apiLogin});open();
     identity=await consumeNativeMigrationApiIdentityReadOnly(tx,ticket);
     if(state==='CLOSED'){releaseNativeMigrationApiIdentityReadOnly(identity);open();}
     const api=await recheckNativeMigrationApiIdentityReadOnly(tx,identity);open();
     pg=await catalog(tx,reviewed,api,read,READ_ONLY);await verifySources();
    }));open();state='OPEN';
   });
  },
  recheck(tx){return track(async()=>{if(state!=='OPEN')fail('not_attested');
   await inScope(tx,SERIALIZABLE,async()=>{
    const current=await verifySources(),api=await recheckNativeMigrationApiIdentityReadOnly(tx,identity);open();
    const observed=await catalog(tx,current,api,read,SERIALIZABLE);if(!same(pg,observed))fail('postgres_changed');await verifySources();
   });
  });},
  close,
  // Joins these reads only. Caller still owns/join the original transaction,
  // pool and native shutdown; this is never physical-settlement evidence.
  async drain(){while(pending.size)await Promise.allSettled([...pending]);},
 });
}
