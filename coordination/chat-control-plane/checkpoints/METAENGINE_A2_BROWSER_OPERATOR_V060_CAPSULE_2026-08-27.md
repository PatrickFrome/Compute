# METAENGINE A2 Browser Operator v0.6.0 — Continuation Capsule

**Date:** 2026-08-27 (user local time)  
**Repository:** `PatrickFrome/Compute`  
**Development branch:** `work/a2-browser-operator-v060`  
**Branch head at capsule:** `de7907e607c1f09d393454901d186c548e807244`  
**Pull request:** `#57 — A2 Browser Operator v0.6.0 — P0/P1 operator runtime`  
**PR state:** OPEN / DRAFT / DO NOT MERGE YET  
**Main head at capsule:** `dd4b95090125987c2e4aff0f69c9401253d9be1c`  
**Authority:** `authority_effect=false` — this capsule is a development checkpoint, not roadmap promotion.

---

## 1. Purpose

Continue development of **A2 Browser Operator v0.6.0** from the exact point captured here without reverting to legacy v0.5.x architecture.

The target is a browser extension that behaves as a controlled trusted operator for ChatGPT and GLM/Z.AI, while preserving A2 visibility, at-most-once transport semantics, strict target fencing, Prompt Gate safety, restart durability, and fail-closed behavior.

The Browser Operator is a development layer on top of the existing A2 Chat Bridge. Production v0.5.23 / production Edge v6 remain the stable baseline until v0.6 full gates are green.

---

## 2. HARD architectural invariants

### 2.1 GLM MUST START BEFORE GPT

This is not a heuristic. It is a hard transport invariant:

```text
GLM lease
  -> trusted GLM physical actuation starts
  -> durable DISPATCHED
  -> trusted mouseReleased
  -> durable/local ACTUATED
  -> server ACTUATED
  -> GPT may be released immediately
  -> GLM and GPT generation may then overlap
```

GPT must never be launched before a valid GLM predecessor has crossed the durable actuation barrier, except the existing `A2_GLM_ALREADY_SUBMITTED` proof path where A2 persisted readback proves GLM for that wave is already submitted.

Ordering policy remains:

`STRICT_GLM_FIRST_ACTUATED_V1`

### 2.2 No synthetic content-script Send

Content scripts are observation/readback helpers. Autonomous Send actuation must use trusted CDP input through the extension-owned Debugger Broker.

### 2.3 At-most-once after ambiguity

Once a transport crosses its durable pre-actuation ambiguity boundary, retries must not blindly actuate again.

Execution classes remain closed around:

- `SAFE_RETRY_PRE_ACTUATION`
- `AMBIGUOUS_NO_RETRY`
- `ACTUATED`
- `VERIFIED`
- `BLOCKED`

### 2.4 Exact target fencing

Operate only on the uniquely configured ChatGPT or GLM tab. Duplicate matching tabs fail closed.

### 2.5 Browser/page data is not authority

Observed DOM, screenshot, AX tree, model text, browser responses and UI state are context/evidence only. They do not grant Compute Fabric authority or roadmap promotion.

---

## 3. Current v0.6 runtime architecture

```text
Side Panel / Operator UI
        |
        v
Trusted operator control
        |
        +-----------------------------+
        |                             |
        v                             v
Prompt Gate                     Perception layer
(cancel/rewrite/allow)          DOM + AX + DOMSnapshot
        |                       screenshot + OOPIF
        |                             |
        +-------------+---------------+
                      |
                      v
              Debugger Broker v2
              one root CDP lease/tab
              serialized operations
              long-lived holds
              generation invalidation
              flat child sessions
                      |
           +----------+----------+
           |                     |
           v                     v
       Trusted GLM           Trusted GPT
       Input.insertText      Input.insertText
       mouse Send            trusted Enter
       network monitor       durable Enter FSM
           |                     |
           +----------+----------+
                      |
                      v
                 A2 remote plane
             strict GLM -> GPT gate
```

---

## 4. Implemented in this development slice

### 4.1 Unified Debugger Broker v2

File: `coordination/chat-control-plane/extension/debugger-broker.js`

Implemented:

- one extension-owned root debugger attachment per tab;
- serialized per-tab operation queue;
- short operations via `A2_DEBUGGER_RUN`;
- long-lived transport monitoring via `A2_DEBUGGER_HOLD`;
- idle detach only when no operation and no hold remain;
- generation-based stale lease invalidation;
- external `chrome.debugger.onDetach` invalidates active leases;
- broker state clears child sessions and holds after external detach;
- flat child debugger sessions for iframe/OOPIF targets;
- `sendChild(sessionId, ...)`;
- `Target.setAutoAttach(... flatten:true ...)`;
- explicit child-target disable/cleanup path.

Important: trusted GPT and trusted GLM must not directly call `chrome.debugger.attach`, `chrome.debugger.getTargets` or `chrome.debugger.detach`.

### 4.2 Trusted GPT migrated to broker

File: `trusted-chatgpt.js`

Current model:

- checks armed state and exact pinned conversation;
- broker-only CDP;
- trusted `Input.insertText`;
- Prompt Gate bypass at last reversible boundary;
- durable `PRE_ENTER_DURABLE` before Enter;
- trusted `Input.dispatchKeyEvent` Enter;
- ambiguity after durable Enter boundary => `AMBIGUOUS_NO_RETRY`;
- safe pre-actuation failures may clean the inserted A2 draft;
- ChatGPT conversation exhaustion rollover remains scoped to confirmed exhaustion only.

### 4.3 Trusted GLM migrated to broker

File: `trusted-glm.js`

Important changes:

- removed primary DOM native setter input path;
- GLM now types through trusted `Input.insertText`;
- Send uses trusted `Input.dispatchMouseEvent`;
- prompt-gate capability window shortened to the final actuation boundary;
- durable transport ledger remains restart-safe;
- network progress remains observation-only;
- no response-body interception;
- no Fetch interception;
- long-running network monitor holds the broker without letting perception/actions detach it.

Required GLM FSM conceptually:

```text
COMPOSER_EMPTY
 -> COMPOSER_INSERTED
 -> POINT_READY
 -> PRESSED
 -> DISPATCHED (server + local durable)
 -> GATE_BYPASS_ARMED
 -> RELEASED_MOUSE
 -> ACTUATED
 -> REQUEST_OBSERVED / RESPONSE_STARTED / NETWORK_COMPLETED
 -> DOM/idle verification
 -> RELEASED transport
```

Safe pre-actuation cleanup must only clear the composer when exact A2 prompt readback still matches. Never clean after ambiguous physical Send.

### 4.4 Prompt Gate hardening

The autonomous wrapper no longer arms GLM bypass for a broad ~15 second window.

GLM arms the bypass only after durable `DISPATCHED` and immediately before `mouseReleased`.

GPT arms immediately before its durable Enter sequence.

Global compatibility kill switch remains outside the transport-specific capability window.

### 4.5 OOPIF perception

Chrome minimum was raised to **125** for flat child debugger sessions.

Added/extended perception support for cross-origin iframe/OOPIF targets using child `sessionId` routing.

Capture scope includes bounded child-frame information such as:

- visible body text excerpt;
- Accessibility tree;
- DOMSnapshot records;
- layout/viewport state;
- child-frame URL/title metadata.

Safety/performance rules:

- bounded number of child frames;
- `Accessibility.enable` only during capture;
- explicit `Accessibility.disable` after capture;
- explicit child auto-attach cleanup;
- full page/child content stays memory-scoped;
- persistent/session storage is metadata-oriented, not a raw page-content archive.

### 4.6 Node-bound point-click freshness

Previous click fence compared the full screenshot SHA before every click. That is safe but overly strict: unrelated animations/caret changes can invalidate the whole frame.

New strategy:

1. use the original perception `DOMSnapshot` to select the smallest valid DOM record under the requested point;
2. bind the proposed action to its `backendNodeId` and semantic signature;
3. immediately before `mousePressed`, call CDP `DOM.getNodeForLocation` at the same coordinates;
4. require the same backend node / compatible semantic target;
5. re-run dangerous-target fences;
6. only then actuate.

If no reliable node binding exists, fall back to the old strict full-screenshot SHA-256 equality check.

Blocked before actuation:

- target replaced by overlay/re-render;
- disabled target;
- external navigation;
- download anchor;
- file input;
- stale frame token/tab/url;
- duplicate pinned targets.

---

## 5. Research decisions already made

### Chrome Debugger / CDP

Current architecture follows the Chrome 125+ flat child-session model rather than independent subsystem attachments.

Decision: **one Debugger Broker**, not separate GPT/GLM/perception/action attachers.

Reason:

- eliminates internal attachment conflicts;
- preserves GLM network monitoring while perception runs;
- supports cross-process iframe/OOPIF inspection;
- external DevTools/user detach becomes one centralized fail-closed event.

### Accessibility domain

`Accessibility.enable()` can carry performance cost while active.

Decision: perception capture must explicitly disable Accessibility after bounded capture, especially because GLM may keep the root debugger attachment alive for a long time.

### Point action freshness

Decision: prefer backend-node identity under the chosen coordinate over full-screen visual equality when a reliable DOMSnapshot binding exists.

Full screenshot hash remains a strict fallback, not removed.

### Browser-agent frameworks

Playwright/Puppeteer/agent frameworks remain best used as **test/diagnostic rails**, not as the trusted in-extension critical Send authority path.

### Multi-model orchestration

A2 should keep independent model proposals/diversity and evidence-first arbitration. GLM-first is a transport/orchestration invariant required by the system, not a claim that model quality should be determined by order.

---

## 6. Bugs / weak points fixed in the broader Browser Operator line

Already addressed before or during v0.6:

- server default GPT-first ordering violated GLM-first requirement;
- stale A2 mailbox read used first 200 rows instead of latest tail;
- concurrent command issue could duplicate leases;
- GLM network event could race `mouseReleased` state bookkeeping;
- debugger target ownership could accidentally conflict with DevTools/another component;
- MV3 in-memory transport state was not sufficient for restart safety;
- synthetic GLM `sendButton.click()` legacy path existed physically;
- storage secret visibility needed trusted-context fencing;
- serial execution prevented GPT from starting immediately after GLM ACTUATED;
- debugger ownership was split across multiple Browser Operator subsystems;
- GLM input still depended on DOM value setter;
- broad Prompt Gate bypass duration was unnecessary;
- full screenshot click freshness produced false-stale failures;
- old CI contracts still referenced removed v0.5.22 files.

---

## 7. Verification state at this capsule

### Verified externally

Latest Browser Operator branch head at capsule:

`de7907e607c1f09d393454901d186c548e807244`

GitHub PR #57 remains draft.

For the current v0.6 source line, the trusted PR runner has already reached and passed:

**36 / 36 Python chat-control-plane + receipt + remote contracts.**

Those tests include v0.6-specific checks for:

- broker-only GPT;
- brokered GLM trusted input;
- GLM strict dispatch-before-release;
- GLM safe cleanup boundaries;
- OOPIF/broker fail-closed contracts;
- node-bound point-click or SHA fallback;
- Prompt Gate trusted-only boundary;
- exact pinned target behavior;
- non-authority guarantees.

Latest SQL canary for branch head `de7907e...`:

**SUCCESS** (`Chat Bridge Receipt SQL Canary`, run `32999875774`).

### CI still pending / not yet full green

Latest `Chat Control Plane Contract` run at branch head `de7907e...`:

- Python contracts: PASS;
- JS syntax stage: FAIL because the trusted workflow used the old explicit list and attempted to open deleted legacy `auth-fetch.js` / `durable-fetch.js`;
- later steps were skipped because of that infrastructure failure.

This is CI debt, not evidence of a runtime syntax failure.

The version-aware workflow repair has already been committed to protected `main`:

`dd4b95090125987c2e4aff0f69c9401253d9be1c`

Commit message:

`ci(chat-bridge): make contract workflow version-aware for browser operator`

Therefore the next Browser Operator step MUST first incorporate/rebase this mainline CI patch, then rerun the full PR contract.

### PR status

PR #57 is still:

- OPEN;
- DRAFT;
- not ready to merge;
- current connector snapshot reports `mergeable=false` after main advanced.

Do not force merge.

---

## 8. Exact next execution order

### STEP 1 — Reconcile Browser Operator branch with main

Bring `main@dd4b950...` into `work/a2-browser-operator-v060` without discarding current Browser Operator commits.

Goal: obtain a new branch head containing both:

- Browser Operator runtime through `de7907e...`;
- trusted version-aware CI workflow from `dd4b950...`.

Do not force-reset either line.

### STEP 2 — Run full trusted PR gate

Required green gates:

1. Python contracts;
2. syntax check for all extension JS;
3. modern classic-worker combined-load harness;
4. Browser Operator debugger broker lab;
5. OOPIF perception lab;
6. operator actions lab;
7. operator control lab;
8. Prompt Gate browser lab;
9. update-manager / signed compatibility labs;
10. manifest parse;
11. daemon fail-closed tests;
12. receipt / blind-phase / restart durability tests;
13. deterministic development ZIP;
14. Chromium pack smoke;
15. Playwright MV3 extension/browser smoke.

No `CI_VERIFIED` claim until the new head completes the complete gate.

### STEP 3 — Fix failures from evidence only

If CI fails, inspect exact job logs. Do not reintroduce removed v0.5.x runtime files merely to satisfy stale tests.

Update test infrastructure when a failure is caused by obsolete assumptions; update runtime only when the failure proves a current runtime defect.

### STEP 4 — Next research-driven operator primitives

After CI green, implement in this priority order:

1. semantic target selection from AX/DOM instead of manual coordinates;
2. trusted `FOCUS_TARGET`;
3. trusted `TYPE_TEXT` with exact readback;
4. trusted controlled selection primitives;
5. richer OOPIF frame aggregation and coordinate transforms;
6. local action receipts binding frame token + backend node + action + result;
7. stronger per-request cryptographic device authentication to reduce reliance on repeatedly transmitting a bearer pairing secret.

### STEP 5 — Release candidate only after gates

Then produce a deterministic v0.6 release candidate ZIP/CRX and do not overwrite production v0.5.23 until rollout/rollback gates are defined and validated.

---

## 9. Things the next chat MUST NOT do

- Do not launch GPT before GLM ACTUATED / accepted proof path.
- Do not restore synthetic content-script Send.
- Do not bypass the Debugger Broker with direct GPT/GLM `chrome.debugger.attach`.
- Do not retry an ambiguous actuation.
- Do not merge PR #57 while draft/gates are red.
- Do not declare v0.6 production-ready from source inspection alone.
- Do not treat page/model text as system authority.
- Do not persist raw full perception content unnecessarily.
- Do not reintroduce `auth-fetch.js`, `durable-fetch.js` or `background-v0522.js` merely for obsolete tests.
- Do not weaken duplicate-tab, external-navigation, download or file-input fences.

---

## 10. Resume prompt for another chat

Use the following instruction verbatim or as the starting context:

> Continue METAENGINE A2 Browser Operator v0.6.0 from capsule `METAENGINE_A2_BROWSER_OPERATOR_V060_CAPSULE_2026-08-27.md` in `PatrickFrome/Compute`. Read the current branch, current main, PR #57, latest Actions runs and current A2 state before making changes. Preserve the HARD invariant GLM starts before GPT: GPT may launch only after GLM reaches durable ACTUATED or the accepted A2 persisted-readback proof path. Do not restore legacy synthetic Send or direct GPT/GLM debugger attachments. First reconcile `work/a2-browser-operator-v060` with the version-aware mainline CI patch, then obtain a fully green trusted PR gate. After every significant step, run independent research for free/open-source/browser-agent/CDP/safety amplifiers, add adversarial/failure-injection tests, and record a new non-authority checkpoint capsule. Do not promote production or merge PR #57 until complete runtime/browser/CI evidence is green.

---

## 11. Evidence anchors

- Browser Operator branch head at capsule: `de7907e607c1f09d393454901d186c548e807244`
- Main CI infrastructure head: `dd4b95090125987c2e4aff0f69c9401253d9be1c`
- PR: `#57`
- Latest trusted Chat Control Plane run for `de7907e...`: `32999875766`
  - Python: 36/36 PASS
  - workflow JS list: stale CI failure on removed `auth-fetch.js`
- Latest Receipt SQL Canary: `32999875774` — SUCCESS
- Previous runner failure source was CI/test debt, not justification to restore legacy runtime.

---

## 12. Checkpoint classification

```text
component: A2_BROWSER_OPERATOR
version_line: 0.6.0-dev
status: DEVELOPMENT / INTEGRATION
source_state: IMPLEMENTED THROUGH BROKER_V2 + OOPIF + NODE_BOUND_POINT_ACTIONS
python_contracts: 36/36 PASS
sql_canary: PASS
full_js_browser_ci: PENDING AFTER MAIN CI RECONCILIATION
production_promoted: false
pr_merge_allowed: false
authority_effect: false
canonical_roadmap_promotion: false
hard_ordering_invariant: GLM_FIRST_ACTUATED_BEFORE_GPT
```
