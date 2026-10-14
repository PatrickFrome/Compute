// MASS15 W35 — Client native trust boundary. This is a pure, synchronous
// gate used by the existing Electron main process; it creates no authority.
const LOCAL_PROVIDER = 'LOCAL_POSTGRES';
const SAFE_SCOPE = /^[A-Z][A-Z0-9_.:-]{0,63}$/;

export function assertClientNativeShellIpcSender({
  event, shellView, primaryShellMode, primaryShellUrl,
}) {
  const webContents = shellView?.webContents;
  // Equality of WebContents objects AND frame objects: numeric IDs alone
  // cannot authenticate a renderer after reuse or navigation.
  if (!webContents || !event || event.sender !== webContents ||
      event.senderFrame !== webContents.mainFrame) {
    throw new Error('client_native_ipc_sender_untrusted');
  }
  let current;
  try { current = new URL(webContents.getURL()); }
  catch { throw new Error('client_native_ipc_document_untrusted'); }
  if (primaryShellMode === 'ME2_PRIMARY') {
    let pinned;
    try { pinned = new URL(primaryShellUrl); }
    catch { throw new Error('client_native_ipc_primary_unpinned'); }
    if (pinned.protocol !== 'http:' || pinned.hostname !== '127.0.0.1' ||
        !pinned.port || current.protocol !== 'http:' ||
        current.hostname !== '127.0.0.1' ||
        current.origin !== pinned.origin || current.pathname !== pinned.pathname ||
        current.search !== pinned.search || current.username || current.password) {
      throw new Error('client_native_ipc_primary_origin_untrusted');
    }
    return true;
  }
  // Recovery is a packaged diagnostic document, not a network origin.
  // No other page gets shell/Client/host privileges.
  if (primaryShellMode !== 'FAIL_CLOSED_RECOVERY' ||
      current.protocol !== 'metaengine:' || current.hostname !== 'recovery' ||
      current.pathname !== '/' || current.username || current.password ||
      current.hash || [...current.searchParams.keys()].some(k => k !== 'reason') ||
      (current.searchParams.get('reason') || '').length > 96) {
    throw new Error('client_native_ipc_recovery_document_untrusted');
  }
  return true;
}

export function assertGenericShellCommandAllowed(primaryShellMode) {
  // The primary ME2 renderer has only typed, individually registered methods.
  // In particular, it must not reach the legacy handleCommand dispatcher.
  if (primaryShellMode === 'ME2_PRIMARY')
    throw new Error('client_primary_generic_command_forbidden');
  if (primaryShellMode !== 'FAIL_CLOSED_RECOVERY')
    throw new Error('client_shell_mode_untrusted');
  return true;
}

function safeScopes(input) {
  if (!Array.isArray(input) || input.length > 32 ||
      input.some(item => typeof item !== 'string' || !SAFE_SCOPE.test(item))) return [];
  return [...new Set(input)];
}
function safeState(value, fallback) {
  return typeof value === 'string' && /^[A-Z_]{1,48}$/.test(value) ? value : fallback;
}

// A status response to any page is an allowlisted projection, never a spread
// of native supervisor/Owner data (which may carry credentials or endpoint
// descriptions). Missing Owner never changes the chosen provider to HOSTED.
export function projectOwnPostgresClientConnection(raw, { localProviderAttested = false } = {}) {
  const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const local = localProviderAttested === true;
  const ready = local && s.local_runtime_ready === true;
  const tier = ready && ['ADMIN', 'USER', 'READ_ONLY'].includes(s.access_tier)
    ? s.access_tier : null;
  const admin = tier === 'ADMIN' && s.admin_ready === true;
  return Object.freeze({
    schema: 'metaengine.client.connection-status.v1',
    state_provider: local ? LOCAL_PROVIDER : 'UNVERIFIED',
    local_runtime_ready: ready,
    secure_device_key_ready: ready && s.secure_device_key_ready === true,
    device_enrolled: ready && s.device_enrolled === true,
    enrollment_state: ready ? safeState(s.enrollment_state, 'UNKNOWN') : 'UNINITIALIZED',
    admin_ready: admin,
    access_tier: tier,
    admin_scopes: admin ? Object.freeze(safeScopes(s.admin_scopes)) : Object.freeze([]),
    admin_grant_epoch: admin && Number.isSafeInteger(s.admin_grant_epoch)
      && s.admin_grant_epoch >= 0 ? s.admin_grant_epoch : null,
    cloud_control_state: 'DISABLED',
    cloud_health: 'NOT_CONFIGURED',
    hosted_supabase_required: false,
    automatic_cloud_fallback: false,
    remote_fallback_allowed: false,
    fallback_mode: 'DISABLED',
    fallback_ready: false,
    fallback_enabled: false,
    automatic_reconnect: false,
    reconnect_uses_existing_supervisor_cycle: true,
    second_connection_scheduler: false,
    local_shell_survives_cloud_outage: true,
    network_availability_guaranteed: false,
    legacy_daemon_feed_is_authority: false,
    master_secret_embedded: false,
    service_role_embedded: false,
    cloudflare_token_embedded: false,
    automatic_effect_retry_allowed: false,
    authority_effect: false,
  });
}
