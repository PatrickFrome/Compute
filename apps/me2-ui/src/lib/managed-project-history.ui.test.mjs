import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../components/me2/managed-project-history.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function harness() {
  let state = [], changes = [], effects = [];
  const exports = {};
  const jsx = (type, props, key) => ({ type, props, key });
  const react = {
    useMemo: fn => fn(), useSyncExternalStore: (_subscribe, get) => get(),
    useState: value => { const initial = typeof value === 'function' ? value() : value; state.push(initial); return [initial, next => changes.push(next)]; },
    useEffect: fn => effects.push(fn),
  };
  const require = name => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'lucide-react') return { History: 'History', RefreshCw: 'RefreshCw' };
    if (name === '@/components/me2/ui/primitives') return { Sec: 'section' };
    if (name === '@/lib/client-project-history') return { getClientProjectHistoryView: taskId => ({ subscribe() {},
      getSnapshot: () => ({ filters: { task_id: taskId, attempt: taskId ? 3 : null, event_type: taskId ? 'TASK_EVENT' : null }, entries: [], busy: false, state: 'UNBOUND', overview: null }),
      refresh() {}, restart() {}, setFilters() {}, nextWindow() {},
    }) };
    throw Error(`unexpected import: ${name}`);
  };
  vm.runInNewContext(code, { exports, require });
  return { render(taskId) { state = []; changes = []; effects = []; const wrapper = exports.ManagedProjectHistory({ taskId }); wrapper.type(wrapper.props); return { key: wrapper.key, state: [...state], changes: [...changes], effectCount: effects.length }; } };
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
