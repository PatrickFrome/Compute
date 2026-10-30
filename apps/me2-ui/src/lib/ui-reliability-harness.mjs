// Execute the shipped TSX with deterministic hooks and an inert native bridge.
// This checks lifecycle/control flow; it does not qualify browser layout or Host.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export async function flush() { for (let n = 0; n < 15; n++) await Promise.resolve(); }

export function clock() {
  let now = 1_800_000_000_000, next = 0;
  const timers = new Map();
  const setTimeout = (fn, ms) => { const id = ++next; timers.set(id, { fn, at: now + ms }); return id; };
  const clearTimeout = id => timers.delete(id);
  const setInterval = (fn, ms) => {
    const id = ++next;
    timers.set(id, { fn, at: now + ms, interval: ms });
    return id;
  };
  return { now: () => now, setTimeout, clearTimeout, setInterval, clearInterval: clearTimeout,
    async advance(ms) {
      const until = now + ms;
      while (true) {
        const due = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, t] = due;
        now = t.at;
        if (t.interval) t.at += t.interval; else timers.delete(id);
        t.fn(); await flush();
      }
      now = until; await flush();
    },
  };
}

export function harness() {
  let slots = [], index = 0, effects = [], component, props, dirty = false, tree;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const useState = initial => {
    const i = index++;
    if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
    return [slots[i].value, value => {
      const next = typeof value === 'function' ? value(slots[i].value) : value;
      if (!Object.is(slots[i].value, next)) { slots[i].value = next; dirty = true; }
    }];
  };
  const useRef = initial => { const i = index++; return slots[i] ??= { current: initial }; };
  const useMemo = (fn, deps) => {
    const i = index++;
    if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: fn(), deps };
    return slots[i].value;
  };
  const useEffect = (fn, deps) => {
    const i = index++;
    if (!slots[i] || !same(slots[i].deps, deps)) effects.push(() => {
      slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() };
    });
  };
  const api = {
    useState, useRef, useEffect, useMemo, useCallback: (fn, deps) => useMemo(() => fn, deps),
    useSyncExternalStore(subscribe, getSnapshot) {
      const [, changed] = useState(0);
      useEffect(() => subscribe(() => changed(v => v + 1)), [subscribe]);
      return getSnapshot();
    },
    React: { createElement: (tag, props, ...children) => ({ tag, props: props ?? {}, children }), Fragment: 'fragment' },
    lazy: () => 'lazy', Suspense: 'suspense',
    mount(fn, nextProps = {}) { component = fn; props = nextProps; return this.render(); },
    render(nextProps = props) {
      props = nextProps;
      let tries = 0;
      do {
        if (++tries > 20) throw Error('render_loop');
        index = 0; effects = []; dirty = false; tree = component(props);
        for (const effect of effects) effect();
      } while (dirty);
      return tree;
    },
    unmount() { for (const slot of slots) slot?.cleanup?.(); slots = []; },
  };
  return api;
}

export function loadUi(relative, exports, context) {
  const url = new URL(relative, import.meta.url);
  const source = ts.createSourceFile(url.pathname, readFileSync(url, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const code = source.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(source)).join('\n');
  const js = ts.transpileModule(`${code}\n globalThis.loaded = {${exports.join(',')}};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText;
  const world = vm.createContext({ exports: {}, console, ...context });
  vm.runInContext(js, world);
  return world.loaded;
}

export function element(tree, id) {
  if (tree?.props?.['data-testid'] === id) return tree;
  for (const child of tree?.children?.flat(Infinity) ?? []) {
    const found = element(child, id);
    if (found) return found;
  }
  return null;
}
