import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

// Only the physical activation is substituted. The production registry's
// serialization, identity and dependency decisions execute unchanged.
const registryUrl = new URL('../src/final-runtime-activation-registry.mjs', import.meta.url).href;
const factory = `export function createFinalRuntimeActivation() {
  const h = globalThis.__finalRuntimeLifecycleTest; h.created++;
  return { async start() { await h.ready; return { schema: 'test', state: 'READY' }; },
    async stop() { h.stopped++; return { schema: 'test', state: 'STOPPED' }; },
    snapshot() { return { schema: 'test', state: 'READY' }; } };
}`;
const hook = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.startsWith(registryUrl) && specifier === './final-runtime-activation.mjs')
    return { url: `data:text/javascript,${encodeURIComponent(factory)}`, shortCircuit: true };
  return next(specifier, context);
} });

await test('restart during pending activation drains old lifetime then creates one fresh activation', async () => {
  let release;
  const h = { created: 0, stopped: 0, ready: new Promise(resolve => { release = resolve; }) };
  globalThis.__finalRuntimeLifecycleTest = h;
  const r = await import(`${registryUrl}?lifecycle-restart`);
  const supervisor = { snapshot() { return {}; } };
  r.registerFinalRuntimeDevelopmentPlane({ request() {} });
  r.registerFinalRuntimeSupervisor(supervisor, {});
  const first = r.markFinalRuntimeSupervisorStarted(supervisor);
  r.markFinalRuntimeSupervisorStopped(supervisor);
  const restart = r.markFinalRuntimeSupervisorStarted(supervisor);
  const joined = r.markFinalRuntimeSupervisorStarted(supervisor);
  release(); await first;
  assert.equal((await restart).state, 'READY');
  assert.equal((await joined).state, 'READY');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(r.finalRuntimeActivationRegistrySnapshot().state, 'READY');
  assert.equal(h.created, 2);
  assert.equal(h.stopped, 1);
  await r.quiesceFinalRuntimeSupervisor(supervisor);
  assert.equal(h.stopped, 2);
});

await test('dependency removed during drain cannot create a replacement activation', async () => {
  let release;
  const h = { created: 0, stopped: 0, ready: new Promise(resolve => { release = resolve; }) };
  globalThis.__finalRuntimeLifecycleTest = h;
  const r = await import(`${registryUrl}?lifecycle-dependency-removal`);
  const supervisor = { snapshot() { return {}; } }, plane = { request() {} };
  r.registerFinalRuntimeDevelopmentPlane(plane);
  r.registerFinalRuntimeSupervisor(supervisor, {});
  const first = r.markFinalRuntimeSupervisorStarted(supervisor);
  r.markFinalRuntimeSupervisorStopped(supervisor);
  const restart = r.markFinalRuntimeSupervisorStarted(supervisor);
  r.unregisterFinalRuntimeDevelopmentPlane(plane);
  release(); await first;
  assert.equal((await restart).state, 'WAITING_FOR_DEVELOPMENT_PLANE');
  assert.equal(h.created, 1);
  assert.equal(h.stopped, 1);
  await r.quiesceFinalRuntimeSupervisor(supervisor);
});
hook.deregister();
delete globalThis.__finalRuntimeLifecycleTest;
