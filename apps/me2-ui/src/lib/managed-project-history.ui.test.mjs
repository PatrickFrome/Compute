import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import {projectMessagePresentation} from './project-message-presentation.ts';
import {jsx as reactJsx, Fragment} from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
const source = fs.readFileSync(new URL('../components/me2/managed-project-history.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function harness(view = {}, nativeElements = false) {
  let state = [], changes = [], effects = [];
  const exports = {};
  const jsx = nativeElements ? reactJsx : (type, props, key) => ({ type, props, key });
  const react = {
    useMemo: fn => fn(), useSyncExternalStore: (_subscribe, get) => get(),
    useState: value => { const initial = typeof value === 'function' ? value() : value; state.push(initial); return [initial, next => changes.push(next)]; },
    useEffect: fn => effects.push(fn),
  };
  const require = name => {
    if (name === '@/lib/project-message-presentation') return {projectMessagePresentation};
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: nativeElements ? Fragment : 'fragment' };
    if (name === 'lucide-react') return { History: 'History', RefreshCw: 'RefreshCw' };
    if (name === '@/components/me2/ui/primitives') return { Sec: 'section' };
    if (name === '@/lib/client-project-history') return { getClientProjectHistoryView: taskId => ({ subscribe() {},
      getSnapshot: () => ({ filters: { task_id: taskId, attempt: taskId ? 3 : null, event_type: taskId ? 'TASK_EVENT' : null }, entries: [], busy: false, state: 'UNBOUND', overview: null, ...view }),
      refresh() {}, restart() {}, setFilters() {}, nextWindow() {},
    }) };
    throw Error(`unexpected import: ${name}`);
  };
  vm.runInNewContext(code, { exports, require });
  return { render(taskId) { state = []; changes = []; effects = []; const wrapper = exports.ManagedProjectHistory({ taskId }); const tree=wrapper.type(wrapper.props); return { tree, key: wrapper.key, state: [...state], changes: [...changes], effectCount: effects.length }; } };
}
test('shipped history component resets filter draft through a distinct task key', () => {
  const h = harness(); const a = h.render('task-a'), b = h.render('task-b'), root = h.render(null);
  assert.notEqual(a.key, b.key); assert.notEqual(b.key, root.key);
  assert.deepEqual(a.state, ['', 'TASK_EVENT', 'task-a', '3', null]);
  assert.deepEqual(b.state, ['', 'TASK_EVENT', 'task-b', '3', null]);
  assert.deepEqual(root.state, ['', '', '', '', null]);
});
test('initial history render does not schedule state-reset effects or state writes', () => {
  const result = harness().render('task-a');
  assert.deepEqual(result.changes, []);
  assert.equal(result.effectCount, 1, 'only external refresh subscription remains');
});

test('history renders addressed message text and ACK scope without sending or marking it processed',()=>{
 const project='11111111-1111-4111-8111-111111111111',task='22222222-2222-4222-8222-222222222222';
 const entry={project_id:project,seq:7,event_type:'BROWSER_AGENT_MESSAGE',source:'UNTRUSTED_BROWSER_AGENT_MESSAGE',actor:'agent_sender123',task_id:task,attempt:1,causal_parent_seq:null,content:{message:'<script>untrusted body</script>',recipient_task_id:task,target_agent_id:'agent_receiver1'}};
 const view={state:'READY',overview:{project_id:project,state:'ACTIVE',total_tasks:1},entries:[entry]},rendered=harness(view).render(null),serialized=JSON.stringify(rendered.tree);
 assert.match(serialized,/Сообщение агента/);assert.match(serialized,/<script>untrusted body<\/script>/);assert.match(serialized,/Это не означает, что сообщение не прочитано/);assert.doesNotMatch(serialized,/dangerouslySetInnerHTML/);assert.deepEqual(rendered.changes,[]);
 const ack={project_id:project,seq:9,event_type:'PROJECT_MESSAGE_ACKNOWLEDGED',source:'AUTHENTICATED_RECIPIENT_ACK',task_id:task,actor:'agent_receiver1',causal_parent_seq:7,content:{message_seq:7,recipient_task_id:task,recipient_agent_id:'agent_receiver1',recipient_acknowledged:true,processing_verified:false}};
 const acknowledged=JSON.stringify(harness({...view,entries:[entry,ack]}).render(null).tree);assert.match(acknowledged,/Получатель подтвердил получение/);assert.match(acknowledged,/Выполнение сообщения не подтверждено/);
});
test('real React HTML renderer escapes message markup while retaining multiline text',()=>{
 const project='11111111-1111-4111-8111-111111111111',task='22222222-2222-4222-8222-222222222222';
 const entry={project_id:project,seq:7,event_type:'NATIVE_AGENT_MESSAGE',source:'UNTRUSTED_NATIVE_AGENT_MESSAGE',actor:'agent_sender123',task_id:task,attempt:1,causal_parent_seq:null,content:{message:'<script>alert("no")</script>\n<img src=x onerror=alert(1)>  text',recipient_task_id:task,target_agent_id:'agent_receiver1'}};
 const html=renderToStaticMarkup(harness({state:'READY',overview:{project_id:project,state:'ACTIVE',total_tasks:1},entries:[entry]},true).render(null).tree);
 assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;  text/);assert.doesNotMatch(html,/<script[ >]|<img[ >]/i);assert.match(html,/Сообщение агента/);
});
