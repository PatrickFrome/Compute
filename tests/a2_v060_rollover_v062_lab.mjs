import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../coordination/chat-control-plane/extension/chatgpt-rollover-v062.js", import.meta.url), "utf8");

function harness({ exhausted = false, ledger = [], initialUrl = "https://chatgpt.com/c/old", rawResult = { ok: true, status: "SENT_DISPATCHED_UNCONFIRMED_NO_RETRY", execution_class: "ACTUATED" }, newUrlAfterRaw = null } = {}) {
  const store = { a2ChatgptDispatchedV0523: structuredClone(ledger) };
  const events = [];
  let tabUrl = initialUrl;
  let rawCalls = 0;

  const chrome = {
    storage: {
      local: {
        async get(keys) {
          if (typeof keys === "string") return { [keys]: store[keys] };
          if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, store[key]]));
          return { ...store };
        },
        async set(patch) {
          Object.assign(store, structuredClone(patch));
          events.push({ kind: "storage.set", patch: structuredClone(patch) });
        }
      }
    },
    tabs: {
      async get(tabId) {
        assert.equal(tabId, 41);
        return { id: 41, url: tabUrl };
      },
      async update(tabId, patch) {
        assert.equal(tabId, 41);
        assert.deepEqual(patch, { url: "https://chatgpt.com/", active: false });
        tabUrl = patch.url;
        events.push({ kind: "tabs.update", tabId, patch: structuredClone(patch) });
        return { id: tabId, url: tabUrl };
      },
      async reload(tabId) {
        assert.equal(tabId, 41);
        events.push({ kind: "tabs.reload", tabId });
      },
      async sendMessage(tabId, message) {
        assert.equal(tabId, 41);
        if (message?.type === "A2_CHATGPT_EXHAUSTION_STATUS") {
          return { ok: true, exhausted, reason: exhausted ? "conversation_length_limit" : null };
        }
        if (message?.type === "GET_CHAT_SNAPSHOT") {
          return { ok: true, snapshot: { platform: "CHATGPT", url: tabUrl, composer_present: true, composer_text: "", generating: false } };
        }
        throw new Error(`unexpected_message:${message?.type}`);
      }
    }
  };

  const context = {
    console,
    chrome,
    URL,
    setTimeout,
    clearTimeout,
    structuredClone,
    A2_CHATGPT_TRUSTED_SEND: async (tabId, command) => {
      rawCalls += 1;
      assert.equal(tabId, 41);
      assert.ok(command?.command_id);
      events.push({ kind: "raw.send", command_id: command.command_id });
      if (newUrlAfterRaw) tabUrl = newUrlAfterRaw;
      return structuredClone(rawResult);
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "chatgpt-rollover-v062.js" });

  return {
    context,
    store,
    events,
    get rawCalls() { return rawCalls; },
    get tabUrl() { return tabUrl; }
  };
}

const command = { command_id: "cmd-1", idempotency_key: "idem-1", target_platform: "CHATGPT", prompt: "A2 CHAT BRIDGE — AUTONOMOUS CONTINUE" };

// Ordinary conversations never rotate merely because a New Chat control exists.
{
  const h = harness({ exhausted: false });
  const result = await h.context.A2_CHATGPT_TRUSTED_SEND(41, command);
  assert.equal(result.ok, true);
  assert.equal(h.rawCalls, 1);
  assert.equal(h.events.some((event) => event.kind === "tabs.update"), false);
  assert.equal(h.store.chatgptRolloverPending, undefined);
}

// Confirmed exhaustion prepositions the exact pinned tab at root, performs one trusted send,
// and pins the materialized new /c/... conversation without a second send.
{
  const h = harness({ exhausted: true, newUrlAfterRaw: "https://chatgpt.com/c/new-conversation" });
  const result = await h.context.A2_CHATGPT_TRUSTED_SEND(41, command);
  assert.equal(result.ok, true);
  assert.equal(result.recovery?.rollover_v062, true);
  assert.equal(result.recovery?.exhausted, true);
  assert.equal(h.rawCalls, 1);
  assert.equal(h.events.filter((event) => event.kind === "tabs.update").length, 1);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(h.store.chatgptUrl, "https://chatgpt.com/c/new-conversation");
  assert.equal(h.store.chatgptRolloverPending, false);
  assert.equal(h.store.chatgptRolloverPendingTabId, null);
  assert.equal(h.rawCalls, 1);
}

// A durable ACTUATED ledger is an absolute no-resend fence even when exhaustion is confirmed.
{
  const h = harness({ exhausted: true, ledger: [{ command_id: "cmd-1", idempotency_key: "idem-1", phase: "ACTUATED" }] });
  const result = await h.context.A2_CHATGPT_TRUSTED_SEND(41, command);
  assert.equal(result.status, "SENT_ALREADY_DURABLE");
  assert.equal(result.execution_class, "ACTUATED");
  assert.equal(result.durable_dispatch_replay, true);
  assert.equal(result.recovery?.resend_forbidden, true);
  assert.equal(h.rawCalls, 0);
  assert.equal(h.events.filter((event) => event.kind === "tabs.update").length, 1);
}

// PRE_ENTER_DURABLE is ambiguous and therefore also forbids resend.
{
  const h = harness({ exhausted: true, ledger: [{ command_id: "cmd-1", idempotency_key: "idem-1", phase: "PRE_ENTER_DURABLE" }] });
  const result = await h.context.A2_CHATGPT_TRUSTED_SEND(41, command);
  assert.equal(result.ok, false);
  assert.equal(result.status, "FAILED_DURABLE_AMBIGUOUS_NO_RETRY");
  assert.equal(result.execution_class, "AMBIGUOUS_NO_RETRY");
  assert.equal(h.rawCalls, 0);
}

// Restart on root resumes only when the local pending marker belongs to the exact tab.
{
  const h = harness({ exhausted: false, initialUrl: "https://chatgpt.com/", newUrlAfterRaw: "https://chatgpt.com/c/resumed" });
  Object.assign(h.store, { chatgptRolloverPending: true, chatgptRolloverPendingTabId: 41 });
  const result = await h.context.A2_CHATGPT_TRUSTED_SEND(41, command);
  assert.equal(result.ok, true);
  assert.equal(result.recovery?.entered_from_root, true);
  assert.equal(h.rawCalls, 1);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(h.store.chatgptUrl, "https://chatgpt.com/c/resumed");
  assert.equal(h.store.chatgptRolloverPending, false);
}

console.log("A2 v0.6.2 ChatGPT rollover lab PASS");
