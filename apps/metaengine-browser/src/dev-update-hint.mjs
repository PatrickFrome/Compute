const DEV_VERSION_RE = /^(\d+)\.(\d+)\.(\d+)-dev\.(\d+)\.(\d+)$/;
export const DEFAULT_DEV_UPDATE_HINT_URL = 'https://raw.githubusercontent.com/PatrickFrome/Compute/update/browser-dev-channel/dev-hint.json';
export const DEFAULT_DEV_UPDATE_HINT_INTERVAL_MS = 2 * 1000;
const MAX_HINT_BYTES = 4096;

function versionTuple(value) {
  const match = DEV_VERSION_RE.exec(String(value || '').trim());
  return match ? match.slice(1).map(Number) : null;
}

export function isNewerCompatibleDevVersion(candidate, current) {
  const a = versionTuple(candidate);
  const b = versionTuple(current);
  if (!a || !b) return false;
  if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) return false;
  for (let i = 3; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

export async function probeDevUpdateHint({
  currentVersion,
  fetchImpl = globalThis.fetch,
  url = DEFAULT_DEV_UPDATE_HINT_URL,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('dev_update_hint_fetch_invalid');
  const parsed = new URL(String(url || ''));
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('dev_update_hint_url_invalid');
  }
  const response = await fetchImpl(parsed.href, {
    redirect: 'error',
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });
  if (response?.status === 404) return null;
  if (!response?.ok) throw new Error(`dev_update_hint_http_${Number(response?.status || 0)}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 2 || bytes.byteLength > MAX_HINT_BYTES) throw new Error('dev_update_hint_size_invalid');
  const row = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (row?.schema !== 'metaengine.browser.dev-update-hint.v1') throw new Error('dev_update_hint_schema_invalid');
  if (row?.authority_effect !== false) throw new Error('dev_update_hint_authority_invalid');
  const version = String(row?.version || '').trim();
  if (!versionTuple(version)) throw new Error('dev_update_hint_version_invalid');
  const tag = String(row?.tag || '').trim();
  if (tag !== `v${version}`) throw new Error('dev_update_hint_tag_binding_invalid');
  const gitSha = String(row?.git_sha || '').trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(gitSha)) throw new Error('dev_update_hint_git_sha_invalid');
  return Object.freeze({
    schema: row.schema,
    version,
    tag,
    git_sha: gitSha,
    newer_than_current: isNewerCompatibleDevVersion(version, currentVersion),
    authority_effect: false,
  });
}
