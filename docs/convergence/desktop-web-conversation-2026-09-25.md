# Desktop web-conversation convergence checkpoint — 2026-09-25

User objective: one continuously developing, coordinated web-conversation fleet,
with evidence-based learning and a self-updating desktop. This patch is a
foundation repair, NOT completion of that objective or a release candidate.

## Sources inspected

- Desktop base: `me2/r78-desktop-from-scratch` at
  `8cf09ad7135981361a18c85cf69bcdfb89aeb983`.
- Release reference fetched: `release/self-update-ambiguity-live-v2` at
  `cf747798a285f113ac3ae1563da4be8bd4e56705`.
- Prior conversation reported 615 audited branches and uncommitted desktop fixes.
  Those fixes were not present in the remote desktop head or available local
  working copies. No claim is made here to have recovered or repeated that audit.
- Current browser-agent-platform.mjs specifies GLM/chat.z.ai as the fleet
  platform. Desktop keeps that provider policy; no model-selection override.

## Repairs in this patch

- Real, awaited native conversation opening; no API session-ID URL synthesis.
- Exact origin/path matching, singleflight opens, reserved bounded capacity,
  multiple FLEET views and renderer-loss invalidation. URL observation grants no
  task authority and is not seed-submit/readback proof.
- MAIN-only preload, separate persistent control/remote sessions, top-frame and
  WebContents IPC checks, control-origin redirect fence, denied unmanaged popups.
- Both preload names supported, matching Mission Control's existing window.me2
  entry point. Unsupported activation/restart operations report explicit failures.
- Mission Control loaded through its HTTP/WS gateway; default requests route to
  Next, explicit allowlisted XTransformPort requests route to daemon services.
- Daemon top-level contract accepted; mismatch cannot produce healthy adoption.
- Keepalive shutdown fences pending responses; failures degrade status, failed
  adoption is retried by the bounded probe lane. This does not add a second task
  scheduler or provide daemon process resurrection.
- Second-instance argument order corrected; smoke exit rejects degraded planes.
- Update channel configuration actually reaches checks; stage state persisted;
  staging no longer asserts installer handoff; path-escape versions rejected.
- Installed UI verifier now requires HTTP HTML + a referenced JavaScript asset
  whose bytes match disk, plus build ID and installed byte count.

## Integration ownership and remaining release blockers

| Mechanic | Existing owner | Required integration / evidence still missing |
|---|---|---|
| BrowserCell/CDP identity, semantic refs, generation fences | apps/metaengine-browser/src/main.mjs and native-browser-control.mjs | Attach new presentation to this trusted kernel; the new tab registry is not equivalent to CDP execution authority |
| Web-agent provisioning and lifecycle | fleet-provisioner.mjs / fleet-runtime-bridge.mjs | Consume canonical agent/tab/target/generation bindings; never derive them from daemon API IDs |
| Task admission, claims, dispatch and result acceptance | native-supervisor-client and existing DevOS runtime | Single durable lease owner; task → lease → prompt → native readback → artifact → verifier → accepted result |
| Root seed and rollover | existing supervisor/agent-platform implementation | Live authenticated root → conversation positive proof; ambiguity reconciliation without resend |
| Brain, outcomes and learning | existing brain and DevOS evidence mechanisms | Promote learned strategies only after verification; memory cannot grant dispatch authority |
| UI/API sessions | ME2 daemon / Mission Control | Keep API sessions distinguishable from web agents; UI currently still displays API fleet sessions |
| Client upgrade and recovery | existing Sentinel + self-update-successor-qualification.mjs | Preserve transaction/source/epoch fencing; stage is not activation; installed successor must resume durable work |
| Installed daemon | ME2 daemon uses Bun and SQLite | Desktop packaging currently omits daemon/runtime; ship and physically verify them before any release |
| Unified source | release + desktop lines | Exact-SHA convergence review still required; no whole-branch merge performed |

Do not ship the from-scratch client as a replacement for the existing Browser:
it still lacks canonical dispatch, full persistent recovery, qualified installer
activation and live end-to-end proof. Do not count an API turn as web execution,
URL navigation as prompt delivery, or a staged installer as a successful update.

## Verification scope

`node --test apps/me2-desktop/test/*.test.mjs` covers native-shell behavior through
injected Electron fakes, identity ambiguity, concurrent opens, failed loads,
renderer loss, IPC isolation, real local HTTP gateway traffic, daemon lifecycle,
update staging and HTTP proof with real Node child processes. The optional
physical electron-builder probe reports SKIP when disabled.

No authenticated web-provider submission, Windows install, packaged Electron
launch, live fleet task, self-update activation or learning promotion was tested
in this workspace. Those gates remain mandatory on one final source SHA.
