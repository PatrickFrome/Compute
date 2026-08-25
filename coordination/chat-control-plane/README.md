# METAENGINE A2 Chat Bridge

Local browser bridge for two long-lived project chats:

- GPT: one exact `https://chatgpt.com/c/...` conversation selected in extension options.
- GLM: `https://chat.z.ai/c/55fd8c37-00d0-4821-8e56-14f36c7be6db` by default.

The bridge has two cooperating processes:

1. **Chrome extension** (`extension/`) reads the live conversation DOM, reports `generating/idle` state, writes exact prompts into the composer, and invokes the real visible **Send** button.
2. **Local daemon/dashboard** (`daemon/`) receives both DOM streams, reads the current A2 mailbox/macroblock/peer-relay state, enforces commit/reveal visibility, detects a stalled peer, and queues a bounded continuation prompt.

The browser transport is never project authority. All generated commands are marked `WEB_CHAT_INTERACTIVE`; A2 hard gates, claims, directives, pair-seal visibility and persisted verification remain authoritative.

## Security boundary

- The Supabase service-role key belongs **only in the local daemon process environment**. It is never stored in extension source, Chrome storage, prompts, DOM snapshots, Git or the dashboard.
- The browser and daemon also share a separate 32+ character **local pairing secret**. The extension stores its copy only in `chrome.storage.local`; the daemon receives its copy only through the process environment.
- Start through `daemon/secure-entry.mjs`. Direct `daemon/run.mjs` execution is intentionally rejected unless invoked behind the authenticated internal loopback gate.
- The public local endpoint binds `127.0.0.1`; all mutating/command endpoints require `x-a2-chat-bridge-secret`. The read-only dashboard and `/v1/status` remain viewable on loopback without the secret.
- The internal scheduler runs on a second loopback-only port and never receives the pairing header.
- The extension sends only to the exact configured conversation URLs.
- The global extension badge is a kill switch: `OFF` means no composer write or Send click can execute.
- If A2 peer visibility is closed, the daemon redacts the other browser chat from the wake prompt.
- A command is leased to one extension client. Successful Sends are durably fenced in `chrome.storage.local` by both `command_id` and the deterministic `idempotency_key`, preventing a second Send after extension or daemon restart.
- Raw browser chat text is held in daemon memory for scheduling. The prepared Supabase bridge-receipt contract stores hashes/metadata only and is **not applied to production yet**.

## Start the daemon

Requires Node.js 20+.

Generate a local-only pairing secret, then start the authenticated entrypoint:

```bash
cd coordination/chat-control-plane
export SUPABASE_SERVICE_ROLE_KEY='...local secret...'
export A2_BRIDGE_SHARED_SECRET="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
node daemon/secure-entry.mjs
```

Copy the value of your locally generated pairing secret into **Extension options → Local pairing secret**. Do not put it in Git, the A2 mailbox, Supabase, screenshots, or chat messages.

Defaults are already bound to the current project:

```text
SUPABASE_URL=https://xpeibufgzjknrhbhpffp.supabase.co
A2_WORKSPACE_ID=2de9f84b-7c0a-4091-911c-894ff1d6eaf4
A2_MACROBLOCK_ID=dce58a3b-2f67-47e0-ae0d-9b3825ff53cd
A2_BRIDGE_PORT=8765
A2_BRIDGE_INTERNAL_PORT=8766
A2_BRIDGE_IDLE_MS=18000
A2_BRIDGE_WAKE_COOLDOWN_MS=60000
```

Open the dashboard at:

```text
http://127.0.0.1:8765/
```

## Load the extension

1. Check out branch `work/chat-control-plane-browser-bridge` locally, or use the `a2-chat-bridge-extension` artifact produced by the **Chat Control Plane Contract** workflow.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select `coordination/chat-control-plane/extension`.
5. Open the extension details → **Extension options**.
6. Paste the local pairing secret generated for the daemon.
7. Keep the preset Z.AI URL or restore it with **Restore project Z.AI chat**.
8. Open the dedicated ChatGPT project conversation, press **Use open ChatGPT tab**, then **Save settings**.
9. Start the daemon and verify both peers are `online` in the dashboard.
10. Click the extension toolbar icon until its badge is `ON` to arm real Send clicks.

## Runtime behavior

Each content script emits a DOM snapshot about every 2.5 seconds and on meaningful mutations. The daemon tracks the latest assistant-output hash and message count. A peer is eligible for automatic wake only when:

- its snapshot is fresh;
- it is not currently generating;
- the composer exists and is empty;
- visible progress has stopped for the configured idle threshold;
- there is no pending command for that peer;
- A2 visibility/gate state permits the intended prompt.

During a blind SAME_POINT proposal, the daemon uses the A2 peer-relay state to identify the missing peer and omits the other chat's DOM text until atomic pair visibility opens. The safe launcher filters old blocked relays whose `base_github_sha` no longer matches the current SHA found in the live mailbox.

The executable CI behavioral test uses a mock A2 blind duel with a unique GPT DOM marker and proves that only GLM is queued and the GPT marker is absent from the GLM wake prompt.

## Wake prompt contents

A wake prompt contains bounded context only:

- workspace/macroblock identifiers;
- latest A2 mailbox frontier and recent messages;
- current peer-relay visibility state;
- the target chat's recent visible turns;
- the other peer's recent visible turns **only when A2 visibility permits**;
- an instruction to continue autonomously until the next real hard gate/dependency and to persist significant evidence through A2.

No browser message is promoted to canonical evidence merely because the bridge observed it.

## Manual controls

The dashboard can queue a GPT or GLM wake explicitly. This still goes through the same pairing, exact-URL and extension arming checks. The dashboard also shows recent command leases/results and whether the content script observed a real Send click.

## Acceptance status

The repository contract currently verifies:

- full DOM readback retained;
- actual visible Send `.click()` path retained;
- exact Z.AI project-chat pin;
- A2 blind visibility fencing;
- current-main stale relay rejection;
- restart-safe idempotency;
- authenticated loopback transport;
- fail-closed direct-daemon bypass;
- buildable Chrome-extension and complete bridge ZIP artifacts.

A real browser acceptance run still requires loading the extension in the user's already-authenticated Chrome profile and arming it. Repository CI cannot truthfully substitute for that final live-tab observation.
