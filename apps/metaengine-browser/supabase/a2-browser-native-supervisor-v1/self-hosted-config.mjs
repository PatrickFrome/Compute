function loopbackUrl(value, protocols, code) {
  let url;
  try { url = new URL(String(value || '')); } catch { throw new Error(code); }
  if (!protocols.includes(url.protocol) || url.hostname !== '127.0.0.1' || url.search || url.hash) throw new Error(code);
  return url;
}

export function resolveSelfHostedSupervisorConfig(get) {
  const mode = String(get('LOCAL_STATE_RUNTIME') || '');
  if (!mode) return Object.freeze({ local: false, serverOptions: {} });
  if (mode !== 'LOCAL_POSTGRES') throw new Error('local_state_runtime_mode_invalid');
  const database = loopbackUrl(get('LOCAL_STATE_DATABASE_URL'), ['postgres:', 'postgresql:'], 'local_state_database_url_invalid');
  if (!database.username || database.pathname === '/') throw new Error('local_state_database_url_invalid');
  const api = loopbackUrl(get('LOCAL_STATE_API_BASE_URL'), ['http:'], 'local_state_api_url_invalid');
  if (api.username || api.password || api.pathname !== '/') throw new Error('local_state_api_url_invalid');
  const key = String(get('LOCAL_STATE_API_KEY') || '');
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error('local_state_api_key_invalid');
  const instanceId = String(get('LOCAL_STATE_INSTANCE_ID') || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(instanceId)) throw new Error('local_state_instance_id_invalid');
  const port = Number(get('LOCAL_STATE_EDGE_PORT'));
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535 || port === Number(api.port) || port === Number(database.port)) throw new Error('local_state_edge_port_invalid');
  return Object.freeze({ local: true, databaseUrl: database.href, apiBase: api.origin, key, instanceId, serverOptions: Object.freeze({ hostname: '127.0.0.1', port }) });
}
