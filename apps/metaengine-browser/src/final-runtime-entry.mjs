import { registerHooks } from 'node:module';

const mainUrl = new URL('./main.mjs', import.meta.url).href;
const developmentPlaneUrl = new URL('./development-plane.mjs', import.meta.url).href;
const activatedDevelopmentPlaneUrl = new URL('./development-plane-activated.mjs', import.meta.url).href;
const nativeSupervisorUrl = new URL('./native-supervisor-client.mjs', import.meta.url).href;
const activatedNativeSupervisorUrl = new URL('./native-supervisor-client-activated.mjs', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    if (context.parentURL !== mainUrl) return resolved;
    if (resolved.url === developmentPlaneUrl) {
      return { url: activatedDevelopmentPlaneUrl, shortCircuit: true };
    }
    if (resolved.url === nativeSupervisorUrl) {
      return { url: activatedNativeSupervisorUrl, shortCircuit: true };
    }
    return resolved;
  },
});

console.log(JSON.stringify({
  schema: 'metaengine.browser.final-runtime-entry.v1',
  state: 'ACTIVATION_HOOK_INSTALLED',
  main_module: 'main.mjs',
  development_plane_mode: 'PROVEN_RUNTIME_PLUS_FINAL_ACTIVATION',
  native_supervisor_mode: 'PROVEN_RUNTIME_PLUS_HOST_VEF_FAST_CONTROL',
  second_scheduler: false,
  production_authority_fabricated: false,
  authority_effect: false,
}));

await import('./main-entry.mjs');
