"use strict";

const bootstrap = globalThis.A2_BRIDGE_BOOTSTRAP || {};
const PROJECT_ZAI_URL = "https://chat.z.ai/c/55fd8c37-00d0-4821-8e56-14f36c7be6db";
const REMOTE_BRIDGE_URL = String(bootstrap.daemonUrl || "https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-chat-bridge-remote");
const DEFAULTS = {
  daemonUrl: REMOTE_BRIDGE_URL,
  armed: false,
  autoOpenTabs: true,
  pollMs: 2500,
  chatgptUrl: "",
  zaiUrl: PROJECT_ZAI_URL,
  bridgeSecret: String(bootstrap.bridgeSecret || "")
};

const $ = (id) => document.getElementById(id);

function normalizedChatUrl(value, expectedPlatform) {
  const url = new URL(String(value || "").trim());
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  const host = url.hostname.toLowerCase();
  if (expectedPlatform === "CHATGPT" && host !== "chatgpt.com" && host !== "chat.openai.com") {
    throw new Error("ChatGPT URL must be on chatgpt.com or chat.openai.com");
  }
  if (expectedPlatform === "GLM_ZAI" && host !== "chat.z.ai") {
    throw new Error("Z.AI URL must be on chat.z.ai");
  }
  if (!url.pathname.startsWith("/c/")) {
    throw new Error("Use a specific conversation URL containing /c/<conversation-id>");
  }
  return `${url.origin}${url.pathname}`;
}

function normalizedBridgeUrl(value) {
  const url = new URL(String(value || "").trim());
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url;
}

function validateBridgeUrl(value) {
  const daemon = normalizedBridgeUrl(value);
  const loopback = daemon.protocol === "http:" && ["127.0.0.1", "localhost"].includes(daemon.hostname);
  const remote = normalizedBridgeUrl(REMOTE_BRIDGE_URL);
  const exactRemote = daemon.protocol === "https:" && daemon.origin === remote.origin && daemon.pathname === remote.pathname;
  if (!loopback && !exactRemote) {
    throw new Error("Bridge must be localhost HTTP or the exact METAENGINE remote HTTPS endpoint");
  }
  return `${daemon.origin}${daemon.pathname}`;
}

function setStatus(text, error = false) {
  const el = $("status");
  el.textContent = text;
  el.style.color = error ? "#ff9e9e" : "#8fe3a7";
}

async function requestPoll(successText = "Authenticated bridge poll requested.") {
  try {
    const response = await chrome.runtime.sendMessage({ type: "BRIDGE_POLL_NOW" });
    if (!response?.ok) throw new Error(response?.error || "poll failed");
    setStatus(successText);
    return true;
  } catch (error) {
    setStatus(`Background worker unavailable: ${String(error?.message || error)}`, true);
    return false;
  }
}

async function load() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const settings = { ...DEFAULTS, ...stored };
  $("chatgptUrl").value = settings.chatgptUrl || "";
  $("zaiUrl").value = settings.zaiUrl || PROJECT_ZAI_URL;
  $("daemonUrl").value = settings.daemonUrl || DEFAULTS.daemonUrl;
  $("bridgeSecret").value = settings.bridgeSecret || DEFAULTS.bridgeSecret || "";
  $("pollMs").value = settings.pollMs || DEFAULTS.pollMs;
  $("autoOpenTabs").checked = settings.autoOpenTabs !== false;
  $("armed").checked = settings.armed === true;
  await requestPoll("Background worker is running; authenticated bridge poll requested automatically.");
}

async function save() {
  try {
    const chatgptRaw = $("chatgptUrl").value.trim();
    const chatgptUrl = chatgptRaw ? normalizedChatUrl(chatgptRaw, "CHATGPT") : "";
    const zaiUrl = normalizedChatUrl($("zaiUrl").value.trim(), "GLM_ZAI");
    const daemonUrl = validateBridgeUrl($("daemonUrl").value.trim());
    const bridgeSecret = $("bridgeSecret").value.trim();
    if (bridgeSecret.length < 32) throw new Error("Pairing secret must be at least 32 characters");
    const pollMs = Math.max(1000, Math.min(30000, Number($("pollMs").value) || DEFAULTS.pollMs));

    await chrome.storage.local.set({
      chatgptUrl,
      zaiUrl,
      daemonUrl,
      bridgeSecret,
      pollMs,
      autoOpenTabs: $("autoOpenTabs").checked,
      armed: $("armed").checked
    });
    const ok = await requestPoll("Saved. Exact peer bindings and authenticated bridge are active.");
    if (!ok) return;
  } catch (error) {
    setStatus(String(error?.message || error), true);
  }
}

async function detectChatgpt() {
  try {
    const tabs = await chrome.tabs.query({});
    const candidates = tabs.filter((tab) => {
      try {
        const url = new URL(tab.url || "");
        return (url.hostname === "chatgpt.com" || url.hostname === "chat.openai.com") && url.pathname.startsWith("/c/");
      } catch (_) {
        return false;
      }
    });
    if (candidates.length !== 1) {
      throw new Error(`Expected exactly one open ChatGPT conversation tab; found ${candidates.length}`);
    }
    $("chatgptUrl").value = normalizedChatUrl(candidates[0].url, "CHATGPT");
    setStatus("Detected the open ChatGPT conversation. Click Save settings.");
  } catch (error) {
    setStatus(String(error?.message || error), true);
  }
}

$("save").addEventListener("click", save);
$("pollNow").addEventListener("click", () => requestPoll());
$("detectChatgpt").addEventListener("click", detectChatgpt);
$("restoreZai").addEventListener("click", () => {
  $("zaiUrl").value = PROJECT_ZAI_URL;
  setStatus("Project Z.AI chat restored. Click Save settings.");
});

load().catch((error) => setStatus(String(error?.message || error), true));
