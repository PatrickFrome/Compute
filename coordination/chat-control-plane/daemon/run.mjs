import process from 'node:process';

if (process.env.A2_BRIDGE_INTERNAL !== '1') {
  console.error('Refusing direct daemon start. Use secure-entry.mjs so localhost pairing is enforced.');
  process.exit(2);
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Refusing to start A2 Chat Bridge without SUPABASE_SERVICE_ROLE_KEY.');
  console.error('The key stays only in the local daemon environment and is never sent to the extension.');
  process.exit(2);
}

const originalFetch = globalThis.fetch.bind(globalThis);
let currentMainSha = process.env.A2_BRIDGE_CURRENT_MAIN_SHA || null;

function findExplicitMainSha(value, depth = 0) {
  if (!value || depth > 6 || typeof value !== 'object') return null;
  for (const key of ['current_main_sha', 'main_sha']) {
    const candidate = value[key];
    if (typeof candidate === 'string' && /^[0-9a-f]{40}$/i.test(candidate)) return candidate.toLowerCase();
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') {
      const found = findExplicitMainSha(child, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function collectMessages(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(collectMessages);
  if (Array.isArray(value.messages)) return value.messages;
  if (value.snapshot) return collectMessages(value.snapshot);
  return [];
}

function learnCurrentMain(value) {
  const messages = collectMessages(value)
    .filter((message) => Number.isFinite(Number(message?.message_seq)))
    .sort((a, b) => Number(a.message_seq) - Number(b.message_seq));
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const found = findExplicitMainSha(messages[i]?.payload);
    if (found) {
      currentMainSha = found;
      return;
    }
  }
}

function relayItems(value) {
  if (!value) return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const items = relayItems(entry);
      if (items) return { owner: entry, items };
    }
    return null;
  }
  if (Array.isArray(value.items)) return { owner: value, items: value.items };
  if (value.pending && Array.isArray(value.pending.items)) return { owner: value.pending, items: value.pending.items };
  return null;
}

function filterPendingByCurrentMain(value) {
  if (!currentMainSha) return value;
  const located = relayItems(value);
  if (!located) return value;
  located.owner.items = located.items.filter((item) => {
    const sha = item?.relay?.base_github_sha || item?.base_github_sha || null;
    return typeof sha === 'string' && sha.toLowerCase() === currentMainSha;
  });
  return value;
}

function jsonResponseLike(response, value) {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(JSON.stringify(value), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url || String(input);
  const response = await originalFetch(input, init);
  if (!response.ok) return response;

  if (url.includes('/rest/v1/rpc/h205f22_a2_interactive_read_v1')) {
    try {
      const parsed = await response.clone().json();
      learnCurrentMain(parsed);
    } catch (_) {}
    return response;
  }

  if (url.includes('/rest/v1/rpc/h205f22_duel_list_peer_relay_pending_v4')) {
    try {
      const parsed = await response.clone().json();
      return jsonResponseLike(response, filterPendingByCurrentMain(parsed));
    } catch (_) {
      return response;
    }
  }

  return response;
};

await import('./server.mjs');
