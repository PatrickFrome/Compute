export const NATIVE_SUPERVISOR_BASE = 'https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-native-supervisor-v1';
export const NATIVE_SUPERVISOR_RUNTIME_PATH = '/a2-browser-native-supervisor-v1';

export function nativeSupervisorRuntimeUrl(pathname) {
  const path = String(pathname || '');
  if (!path.startsWith('/v1/')) throw new Error('native_supervisor_runtime_path_invalid');
  if (path.includes('?') || path.includes('#') || path.includes('\\') || path.includes('..') || path.includes('//')) {
    throw new Error('native_supervisor_runtime_path_invalid');
  }
  return `${NATIVE_SUPERVISOR_BASE}${path}`;
}

export function nativeSupervisorSigningPath(pathname) {
  const path = String(pathname || '');
  if (!path.startsWith('/v1/')) throw new Error('native_supervisor_runtime_path_invalid');
  if (path.includes('?') || path.includes('#') || path.includes('\\') || path.includes('..') || path.includes('//')) {
    throw new Error('native_supervisor_runtime_path_invalid');
  }
  return `${NATIVE_SUPERVISOR_RUNTIME_PATH}${path}`;
}
