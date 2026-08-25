"use strict";

const COMPLETED_KEY = "a2BridgeCompletedCommandsV1";
const LEASED_KEY = "a2BridgeLeasedCommandsV1";
const MAX_COMPLETED = 256;
const MAX_LEASED = 256;
const originalFetch = globalThis.fetch.bind(globalThis);

async function loadArray(key) {
  const stored = await chrome.storage.local.get(key);
  const value = stored[key];
  return Array.isArray(value) ? value : [];
}

async function loadCompleted() {
  return loadArray(COMPLETED_KEY);
}

async function loadLeased() {
  return loadArray(LEASED_KEY);
}

async function rememberLease(command) {
  if (!command?.command_id) return;
  const rows = await loadLeased();
  const next = rows.filter((row) => row?.command_id !== command.command_id);
  next.push({
    command_id: String(command.command_id),
    idempotency_key: String(command.idempotency_key || ""),
    target_platform: command.target_platform || null,
    leased_at: new Date().toISOString()
  });
  await chrome.storage.local.set({ [LEASED_KEY]: next.slice(-MAX_LEASED) });
}

async function leaseForCommand(commandId) {
  const rows = await loadLeased();
  return rows.find((row) => row?.command_id === commandId) || null;
}

async function findCompleted(command) {
  const rows = await loadCompleted();
  const commandId = String(command?.command_id || "");
  const idem = String(command?.idempotency_key || "");
  return rows.find((row) =>
    (commandId && row?.command_id === commandId) ||
    (idem && row?.idempotency_key === idem)
  ) || null;
}

async function rememberCompleted(commandId, result) {
  const lease = await leaseForCommand(commandId);
  const rows = await loadCompleted();
  const idem = String(lease?.idempotency_key || "");
  const next = rows.filter((row) =>
    row?.command_id !== commandId && (!idem || row?.idempotency_key !== idem)
  );
  next.push({
    command_id: commandId,
    idempotency_key: idem || null,
    target_platform: lease?.target_platform || result?.target_platform || null,
    completed_at: new Date().toISOString(),
    status: result?.status || "SENT_AND_DOM_VERIFIED",
    clicked_send_button: result?.clicked_send_button === true,
    target_url: result?.target_url || null
  });
  await chrome.storage.local.set({ [COMPLETED_KEY]: next.slice(-MAX_COMPLETED) });
}

function parseBody(init) {
  try {
    return init?.body ? JSON.parse(String(init.body)) : null;
  } catch (_) {
    return null;
  }
}

function responseWith(response, body) {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(body), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function acknowledgeDurableDuplicate(url, init, command, row) {
  const base = new URL(url);
  const resultUrl = `${base.origin}/v1/commands/${encodeURIComponent(command.command_id)}/result`;
  const headers = new Headers(init?.headers || {});
  headers.set("content-type", "application/json");
  try {
    await originalFetch(resultUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        status: "SENT_ALREADY_DURABLE",
        target_platform: command.target_platform,
        target_url: row?.target_url || null,
        clicked_send_button: row?.clicked_send_button === true,
        authority_effect: false,
        captured_at: new Date().toISOString()
      }),
      cache: "no-store"
    });
  } catch (_) {
    // Next poll retries acknowledgement, but the deterministic idempotency key
    // prevents a second Send even if the daemon restarted with a new command ID.
  }
}

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input?.url || String(input);
  const method = String(init?.method || "GET").toUpperCase();

  if (method === "POST" && /\/v1\/commands\/[^/]+\/result$/.test(url)) {
    const body = parseBody(init);
    const match = url.match(/\/v1\/commands\/([^/]+)\/result$/);
    const commandId = match ? decodeURIComponent(match[1]) : "";
    if (
      commandId &&
      body?.clicked_send_button === true &&
      ["SENT_AND_DOM_VERIFIED", "SENT"].includes(String(body?.status || ""))
    ) {
      // Persist before network ACK. If the daemon disappears after the real Send,
      // command-id or idempotency-key retries are acknowledged without another click.
      await rememberCompleted(commandId, body);
    }
    return originalFetch(input, init);
  }

  const response = await originalFetch(input, init);
  if (!response.ok || method !== "GET" || !url.endsWith("/v1/commands/next")) return response;

  try {
    const body = await response.clone().json();
    const command = body?.command;
    if (!command?.command_id) return response;
    await rememberLease(command);
    const row = await findCompleted(command);
    if (!row) return response;
    await acknowledgeDurableDuplicate(url, init, command, row);
    return responseWith(response, {
      command: null,
      durable_duplicate_command_id: command.command_id,
      durable_duplicate_idempotency_key: command.idempotency_key || null
    });
  } catch (_) {
    return response;
  }
};
