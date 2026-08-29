const SELF_UPDATE_STATES = new Set([
  'UNINITIALIZED',
  'DISABLED',
  'ERROR',
  'IDLE',
  'CHECKING',
  'CURRENT',
  'APPROVED_DOWNLOAD',
  'DOWNLOADING',
  'READY_RESTART',
  'RESTART_GRACE',
  'RESTARTING',
  'REJECTED_METADATA',
]);

const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const CHANNEL_RE = /^[0-9A-Za-z._-]{1,32}$/;

function boundedVersion(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  return text.length <= 64 && VERSION_RE.test(text) ? text : null;
}

function boundedChannel(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  return CHANNEL_RE.test(text) ? text : null;
}

function boundedNumber(value, min, max, { integer = false } = {}) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return null;
  return integer ? Math.trunc(number) : number;
}

function boundedTimestamp(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (text.length > 80 || !Number.isFinite(Date.parse(text))) return null;
  return text;
}

function exactBoolean(value) {
  return typeof value === 'boolean' ? value : null;
}

export function boundedSelfUpdateState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const state = String(value.state || '').toUpperCase();
  if (!SELF_UPDATE_STATES.has(state)) return null;
  return {
    schema: 'metaengine.self-update-runtime.observer.v1',
    state,
    available_version: boundedVersion(value.available_version),
    downloaded_version: boundedVersion(value.downloaded_version),
    install_attempted_version: boundedVersion(value.install_attempted_version),
    metadata_verified: exactBoolean(value.metadata_verified),
    trusted_channel: boundedChannel(value.trusted_channel),
    candidate_file_count: boundedNumber(value.candidate_file_count, 0, 16, { integer: true }),
    staging_percentage: boundedNumber(value.staging_percentage, 0, 100),
    download_percent: boundedNumber(value.download_percent, 0, 100),
    restart_gate_safe: exactBoolean(value.restart_gate_safe),
    restart_gate_since: boundedTimestamp(value.restart_gate_since),
    restart_grace_ms: boundedNumber(value.restart_grace_ms, 0, 300000, { integer: true }),
    ci_test_feed_active: exactBoolean(value.ci_test_feed_active),
    pre_install_receipt_persisted: exactBoolean(value.pre_install_receipt_persisted),
    installer_handoff_prepared: exactBoolean(value.installer_handoff_prepared),
    publisher_verified: exactBoolean(value.publisher_verified),
    authority_effect: false,
  };
}

export function boundedNativeSupervisorState(value, { now = () => new Date().toISOString() } = {}) {
  const s = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const tabs = Array.isArray(s.tabs)
    ? s.tabs.slice(0, 32).map((t) => ({
        tab_id: String(t?.tab_id || '').slice(0, 80),
        url: String(t?.url || '').slice(0, 1200),
        title: String(t?.title || '').slice(0, 240),
        kind: String(t?.kind || '').slice(0, 40),
        selected: t?.selected === true,
      }))
    : [];
  const mode = String(s.supervisor_mode || 'OFF').toUpperCase();
  return {
    schema: 'metaengine.native-browser-supervisor.state.v1',
    client_kind: 'METAENGINE_BROWSER_ELECTRON_NATIVE',
    shell_version: String(s.shell_version || '').slice(0, 32),
    supervisor_mode: ['OFF', 'MONITOR', 'CONTROL'].includes(mode) ? mode : 'OFF',
    armed: s.armed === true,
    operator_mode: String(s.operator_mode || 'CONTROL').slice(0, 32),
    tabs,
    active_tab: s.active_tab && typeof s.active_tab === 'object' && !Array.isArray(s.active_tab) ? s.active_tab : null,
    development_plane: s.development_plane && typeof s.development_plane === 'object' && !Array.isArray(s.development_plane) ? s.development_plane : null,
    fleet: s.fleet && typeof s.fleet === 'object' && !Array.isArray(s.fleet) ? s.fleet : null,
    perception: s.perception && typeof s.perception === 'object' && !Array.isArray(s.perception) ? s.perception : null,
    self_update: boundedSelfUpdateState(s.self_update),
    last_error: String(s.last_error || '').slice(0, 500) || null,
    started_at: s.started_at || null,
    heartbeat_at: now(),
  };
}
