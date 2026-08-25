"use strict";

const COMPLETED_KEY = "a2BridgeCompletedCommandsV1";
const MAX_COMPLETED = 256;
const originalFetch = globalThis.fetch.bind(globalThis);

async function loadCompleted() {
  const stored = await chrome.storage.local.get(COMPLETED_KEY);
  const value = stored[COMPLETED_KEY];
  return Array.isArray(value) ? value : [];
}

async function findCompleted(commandId) {
  const rows = await loadCompleted();
  return rows.find((row) => row?.command_id === commandId) || null;
}

async function rememberCompleted(commandId, result) {
  const rows = await loadCompleted();
  const next = rows.filter((row) => row?.command_id !== commandId);
  next.push({
    command_id: commandId,
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
    // Next poll will retry the acknowledgement, but never the Send click.
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
      // a later lease retry is acknowledged without clicking Send a second time.
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
    const row = await findCompleted(String(command.command_id));
    if (!row) return response;
    await acknowledgeDurableDuplicate(url, init, command, row);
    return responseWith(response, {
      command: null,
      durable_duplicate_command_id: command.command_id
    });
  } catch (_) {
    return response;
  }
};
