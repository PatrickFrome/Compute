// TEST SUPPORT ONLY. Match the production Host's concrete provider message;
// a failure or terminal receipt is never readiness or permission to retry.
import path from 'node:path';
import { canonicalLocalStateSupervisorBase, LOCAL_STATE_INSTANCE_UUID } from '../../../apps/metaengine-browser/src/local-state-provider-policy.mjs';

const descriptorKeys = ['schema', 'provider', 'endpoint', 'instance_id', 'status_file', 'runtime_ready',
  'automatic_cloud_fallback', 'hosted_supabase_required', 'authority_effect'];
const validStatusFile = value => typeof value === 'string' && path.isAbsolute(value)
  && !/^(?:\\\\|\/\/)/.test(value) && value.length <= 2048 && !/[\x00-\x1f]/.test(value)
  && path.basename(value) !== '';
const canonicalEndpoint = value => typeof value === 'string' && canonicalLocalStateSupervisorBase(value) === value;

export function waitForRuntimeHostDescriptor(child, { timeoutMs = 150000, expectedEndpoint, expectedStatusFile } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('bundled_runtime_fixture_timeout_invalid');
  try {
    if ((expectedEndpoint !== undefined && !canonicalEndpoint(expectedEndpoint))
      || (expectedStatusFile !== undefined && !validStatusFile(expectedStatusFile))) throw new Error();
  } catch { throw new Error('bundled_runtime_fixture_host_binding_invalid'); }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, descriptor) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('message', onMessage);
      child.off('error', onError);
      child.off('close', onClose);
      child.off('disconnect', onDisconnect);
      error ? reject(new Error(error)) : resolve(descriptor);
    };
    const onMessage = value => {
      try {
        if (value?.schema === 'compute.runtime-host-failure.v1') return finish('bundled_runtime_fixture_host_failed');
        if (value?.schema === 'compute.runtime-host-terminal.v1') return finish('bundled_runtime_fixture_host_stopped_before_ready');
        if (!value || typeof value !== 'object' || Array.isArray(value)
          || Reflect.ownKeys(value).length !== descriptorKeys.length || descriptorKeys.some(key => !Object.hasOwn(value, key))
          || value.schema !== 'compute.runtime-host-provider.v1' || value.provider !== 'LOCAL_POSTGRES'
          || !canonicalEndpoint(value.endpoint) || typeof value.instance_id !== 'string' || !LOCAL_STATE_INSTANCE_UUID.test(value.instance_id)
          || !validStatusFile(value.status_file)
          || (expectedEndpoint !== undefined && value.endpoint !== expectedEndpoint)
          || (expectedStatusFile !== undefined && path.resolve(value.status_file) !== path.resolve(expectedStatusFile))
          || value.runtime_ready !== true || value.automatic_cloud_fallback !== false
          || value.hosted_supabase_required !== false || value.authority_effect !== false) {
          return finish('bundled_runtime_fixture_host_descriptor_invalid');
        }
        finish(null, value);
      } catch { finish('bundled_runtime_fixture_host_descriptor_invalid'); }
    };
    const onError = () => finish('bundled_runtime_fixture_host_failed');
    const onClose = () => finish('bundled_runtime_fixture_host_ended_before_ready');
    const onDisconnect = () => finish('bundled_runtime_fixture_host_disconnected_before_ready');
    const timer = setTimeout(() => finish('bundled_runtime_fixture_host_ready_timeout'), timeoutMs);
    child.on('message', onMessage);
    child.once('error', onError);
    child.once('close', onClose);
    child.once('disconnect', onDisconnect);
  });
}
