"use strict";

const PROJECT_ZAI_URL = "https://chat.z.ai/c/55fd8c37-00d0-4821-8e56-14f36c7be6db";
const DEFAULTS = {
  daemonUrl: "http://127.0.0.1:8765",
  armed: false,
  autoOpenTabs: true,
  pollMs: 2500,
  chatgptUrl: "",
  zaiUrl: PROJECT_ZAI_URL
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
  if (expectedPlatform === "GLM_ZAI" && host !== "chat.z.ai" && !host.endsWith(".z.ai")) {
    throw new Error("Z.AI URL must be on chat.z.ai / z.ai");
  }
  if (!url.pathname.startsWith("/c/")) {
    throw new Error("Use a specific conversation URL containing /c/<conversation-id>");
  }
  return `${url.origin}${url.pathname}`;
}

function setStatus(text, error = false) {
  const el = $("status");
  el.textContent = text;
  el.style.color = error ? "#ff9e9e" : "#8fe3a7";
}

async function load() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const settings = { ...DEFAULTS, ...stored };
  $("chatgptUrl").value = settings.chatgptUrl || "";
  $("zaiUrl").value = settings.zaiUrl || PROJECT_ZAI_URL;
  $("daemonUrl").value = settings.daemonUrl || DEFAULTS.daemonUrl;
  $("pollMs").value = settings.pollMs || DEFAULTS.pollMs;
  $("autoOpenTabs").checked = settings.autoOpenTabs !== false;
  $("armed").checked = settings.armed === true;
}

async function save() {
  try {
    const chatgptRaw = $("chatgptUrl").value.trim();
    const chatgptUrl = chatgptRaw ? normalizedChatUrl(chatgptRaw, "CHATGPT") : "";
    const zaiUrl = normalizedChatUrl($("zaiUrl").value.trim(), "GLM_ZAI");
    const daemon = new URL($("daemonUrl").value.trim());
    if (!['http:', 'https:'].includes(daemon.protocol)) throw new Error("Daemon URL must use HTTP(S)");
    const pollMs = Math.max(1000, Math.min(30000, Number($("pollMs").value) || DEFAULTS.pollMs));

    await chrome.storage.local.set({
      chatgptUrl,
      zaiUrl,
      daemonUrl: daemon.href.replace(/\/+$/, ""),
      pollMs,
      autoOpenTabs: $("autoOpenTabs").checked,
      armed: $("armed").checked
    });
    setStatus("Saved. Exact peer bindings are active.");
    await chrome.runtime.sendMessage({ type: "BRIDGE_POLL_NOW" });
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
$("pollNow").addEventListener("click", async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: "BRIDGE_POLL_NOW" });
    if (!response?.ok) throw new Error(response?.error || "poll failed");
    setStatus("Daemon poll requested.");
  } catch (error) {
    setStatus(String(error?.message || error), true);
  }
});
$("detectChatgpt").addEventListener("click", detectChatgpt);
$("restoreZai").addEventListener("click", () => {
  $("zaiUrl").value = PROJECT_ZAI_URL;
  setStatus("Project Z.AI chat restored. Click Save settings.");
});

load().catch((error) => setStatus(String(error?.message || error), true));
