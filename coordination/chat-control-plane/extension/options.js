"use strict";

const bootstrap = globalThis.A2_BRIDGE_BOOTSTRAP || {};
const REMOTE_BRIDGE_URL = String(bootstrap.daemonUrl || "https://jhriwwsryeqsvvvufkok.supabase.co/functions/v1/a2-chat-bridge-remote");
const DEFAULTS = { daemonUrl: REMOTE_BRIDGE_URL, armed: false, autoOpenTabs: true, pollMs: 2500, chatgptUrl: "" };
const $ = (id) => document.getElementById(id);
let pairingConfigured = false;

function normalizedChatUrl(value) {
  const url = new URL(String(value || "").trim());
  url.hash = ""; url.search = ""; url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  const host = url.hostname.toLowerCase();
  if (!["chatgpt.com", "chat.openai.com"].includes(host)) throw new Error("ChatGPT URL must be on chatgpt.com or chat.openai.com");
  if (!url.pathname.startsWith("/c/")) throw new Error("Use a specific ChatGPT conversation URL containing /c/<conversation-id>");
  return `${url.origin}${url.pathname}`;
}

function normalizedBridgeUrl(value) {
  const url = new URL(String(value || "").trim());
  url.hash = ""; url.search = ""; url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url;
}

function validateBridgeUrl(value) {
  const daemon = normalizedBridgeUrl(value), remote = normalizedBridgeUrl(REMOTE_BRIDGE_URL);
  const loopback = daemon.protocol === "http:" && ["127.0.0.1", "localhost"].includes(daemon.hostname);
  const exactRemote = daemon.protocol === "https:" && daemon.origin === remote.origin && daemon.pathname === remote.pathname;
  if (!loopback && !exactRemote) throw new Error("Bridge must be localhost HTTP or the exact METAENGINE remote HTTPS endpoint");
  return `${daemon.origin}${daemon.pathname}`;
}

function setStatus(text, error = false) {
  $("status").textContent = text;
  $("status").style.color = error ? "#ff9e9e" : "#8fe3a7";
}

function setPairingState(configured) {
  pairingConfigured = configured === true;
  $("pairingState").textContent = pairingConfigured ? "pairing stored in trusted vault" : "pairing token required";
}

async function pairingStatus() {
  const response = await chrome.runtime.sendMessage({ type: "A2_PAIRING_STATUS" });
  if (!response?.ok) throw new Error(response?.error || "pairing status unavailable");
  setPairingState(response.configured === true);
  return pairingConfigured;
}

async function requestPoll(successText = "Authenticated ChatGPT-only bridge poll requested.") {
  const response = await chrome.runtime.sendMessage({ type: "BRIDGE_POLL_NOW" });
  if (!response?.ok) throw new Error(response?.error || "poll failed");
  setStatus(successText);
  return true;
}

async function load() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const settings = { ...DEFAULTS, ...stored };
  $("chatgptUrl").value = settings.chatgptUrl || "";
  $("daemonUrl").value = settings.daemonUrl || DEFAULTS.daemonUrl;
  $("bridgeSecret").value = "";
  $("pollMs").value = settings.pollMs || DEFAULTS.pollMs;
  $("autoOpenTabs").checked = settings.autoOpenTabs !== false;
  $("armed").checked = settings.armed === true;
  await pairingStatus();
  if (pairingConfigured) await requestPoll("Background worker is running; ChatGPT-only bridge poll requested automatically.");
  else setStatus("Enter the scoped pairing token, save settings, then ARM the bridge.", true);
}

async function save() {
  try {
    const chatgptRaw = $("chatgptUrl").value.trim();
    const chatgptUrl = chatgptRaw ? normalizedChatUrl(chatgptRaw) : "";
    const daemonUrl = validateBridgeUrl($("daemonUrl").value.trim());
    const secret = $("bridgeSecret").value.trim();
    if (secret) {
      if (secret.length < 32) throw new Error("Pairing token must be at least 32 characters");
      const response = await chrome.runtime.sendMessage({ type: "A2_SET_PAIRING_SECRET", secret });
      if (!response?.ok) throw new Error(response?.error || "pairing token save failed");
      $("bridgeSecret").value = "";
      setPairingState(true);
    } else if (!(await pairingStatus())) {
      throw new Error("Pairing token is required");
    }
    const pollMs = Math.max(1000, Math.min(30000, Number($("pollMs").value) || DEFAULTS.pollMs));
    // Deliberately do not remove historical zaiUrl keys: older evidence/settings
    // stay readable, but this active UI can neither create nor modify them.
    await chrome.storage.local.set({ chatgptUrl, daemonUrl, pollMs, autoOpenTabs: $("autoOpenTabs").checked, armed: $("armed").checked });
    await requestPoll("Saved. ChatGPT-only routing and exact target bindings are active.");
  } catch (error) { setStatus(String(error?.message || error), true); }
}

async function detectChatgpt() {
  try {
    const tabs = await chrome.tabs.query({});
    const candidates = tabs.filter((tab) => {
      try { const url = new URL(tab.url || ""); return ["chatgpt.com", "chat.openai.com"].includes(url.hostname) && url.pathname.startsWith("/c/"); }
      catch (_) { return false; }
    });
    if (candidates.length !== 1) throw new Error(`Expected exactly one open ChatGPT conversation tab; found ${candidates.length}`);
    $("chatgptUrl").value = normalizedChatUrl(candidates[0].url);
    setStatus("Detected the open ChatGPT conversation. Click Save settings.");
  } catch (error) { setStatus(String(error?.message || error), true); }
}

$("save").addEventListener("click", save);
$("pollNow").addEventListener("click", () => requestPoll().catch((error) => setStatus(String(error?.message || error), true)));
$("detectChatgpt").addEventListener("click", detectChatgpt);
load().catch((error) => setStatus(String(error?.message || error), true));
