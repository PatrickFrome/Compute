import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {LOCAL_RUNTIME_MIGRATIONS,loadLocalRuntimeMigrationPlan} from './local-runtime-migrations.mjs';
const read=name=>fs.readFile(new URL(name,import.meta.url),'utf8');
const functionBody=(source,name)=>{
 const start=source.indexOf('function destruktion_meta.'+name+'(');assert.ok(start>=0);
 const begin=source.indexOf('as $$',start)+5,end=source.indexOf('$$;',begin);assert.ok(end>begin);return source.slice(begin,end);
};
const sha=value=>createHash('sha256').update(value).digest('hex');
test('running-agent upgrade follows current admission and guards exact old/current bodies',async()=>{
 const source=await read('./native-coding-running-agent-scope-v1.sql');
 const original=await read('../../supabase/migrations/20261025090000_native_coding_agent_project_tools_v1.sql');
 const oldBody=functionBody(original,'native_coding_agent_context_v1'),newBody=functionBody(source,'native_coding_agent_context_v1');
 assert.equal(newBody,oldBody.replace('native_coding_worktree_admissible_v1(t.workspace_id,t.task_id)','native_coding_running_critic_admissible_v1(t.workspace_id,t.task_id)'));
 for(const body of [oldBody,newBody,functionBody(source,'native_coding_running_critic_admissible_v1')])assert.ok(source.includes("'"+sha(body)+"'"));
 const index=LOCAL_RUNTIME_MIGRATIONS.findIndex(m=>m.path==='native-coding-running-agent-scope-v1.sql');
 assert.ok(index>LOCAL_RUNTIME_MIGRATIONS.findIndex(m=>m.path==='native-agent-count-unbounded-v2.sql'));
 assert.equal(LOCAL_RUNTIME_MIGRATIONS[index].reviewed_running_agent_scope_upgrade,true);
 const plan=await loadLocalRuntimeMigrationPlan();assert.ok(plan.migrations[index].signatures.includes('destruktion_meta.native_coding_agent_context_v1(uuid)'));
 assert.match(source,/security invoker/);assert.match(source,/current_user<>'state_owner' or session_user<>'state_owner'/);
 assert.match(source,/revoke all on function destruktion_meta.native_coding_running_critic_admissible_v1\(uuid,uuid\)/);
});
test('running critic retains full witness and subject predicates without fresh-slot admission checks',async()=>{
 const source=await read('./native-coding-running-agent-scope-v1.sql'),helper=functionBody(source,'native_coding_running_critic_admissible_v1');
 const service=functionBody(await read('./native-agent-count-unbounded-v2.sql'),'native_coding_service_admissible_v1');
 const prefix=service.slice(service.indexOf(' select * into r from destruktion_meta.native_coding_service_heartbeat_h205f22'),service.indexOf(' -- Retained UNKNOWN/RESULT_READY jobs'));
 assert.ok(helper.includes(prefix.replaceAll('p_permit','p.permit_id')));
 const worktree=functionBody(await read('../../supabase/migrations/20261025120000_native_coding_service_heartbeat_admission_v1.sql'),'native_coding_worktree_admissible_v1');
 const subject=worktree.slice(worktree.indexOf('   subject:='),worktree.indexOf('\n end if;\n return false;'));
 assert.ok(helper.includes(subject));assert.ok(!helper.includes('free<=0'));assert.ok(!helper.includes('unrepresented<free'));
 assert.ok(helper.includes("active_job.job_envelope#>'{payload,host_process}'=v->'host_process'"));
 assert.ok(helper.includes("if t.role is distinct from 'CRITIC' then return false"));
 assert.ok(!/\b(insert|update|delete)\b/i.test(helper));
});


test('running-agent real PG regression is wired to existing disposable PG17 CI',async()=>{
  const workflow=await fs.readFile(new URL('../../.github/workflows/client-source-candidate-w59.yml',import.meta.url),'utf8');
  assert.match(workflow,/METAENGINE_PG_TEST_BIN=\/usr\/lib\/postgresql\/17\/bin/);
  assert.match(workflow,/METAENGINE_PG_TEST_DRIVER=.*postgres\/src\/index\.js/);
  assert.match(workflow,/test -x "\$METAENGINE_PG_TEST_BIN\/initdb"/);
  assert.match(workflow,/test -f "\$METAENGINE_PG_TEST_DRIVER"/);
  assert.match(workflow,/"\$NODE_BIN" --test infra\/client-state-runtime\/native-coding-agent-project-tools\.integration\.test\.mjs/);
  assert.match(workflow,/runuser -u postgres/);
});
