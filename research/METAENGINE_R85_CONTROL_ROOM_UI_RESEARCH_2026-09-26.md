# METAENGINE R85 — CONTROL ROOM UI / UX RESEARCH & CRITICAL AUDIT

Date: 2026-09-26
Branch: `work/r85-control-room-ui-v1`
Base: R84 exact head `8e85c4ab30e24c4b1fe330b376339707867d7b1e`
Scope: presentation / interaction architecture only. No scheduler, browser-command, update, release, or fleet authority widening.

## 1. Evidence from the live installed R84

The audit was performed against the physical installed Browser `0.7.0-dev.3.1`, not only source.

Observed:
- ME2 primary shell is physically reachable at the local Mission Control surface.
- COMPUTE and MEMORY page routing were verified by exact semantic click + URL/readback.
- Fleet/Compute mechanisms are live, but the operator surface exposes too much undifferentiated state in permanent chrome.
- SQL mirror is visibly degraded (`OFF`) while outbox grows. This is an attention event, not a normal metric.
- Browser screencast can fall back to CDP when `:3042` stream is unavailable.
- Closed Command Palette content appeared in CAPTURE text while visually closed. Hidden overlay controls therefore polluted the native semantic projection.
- Persistent StatusBar exposed `flush` as a tiny always-available EMERGENCY mutation.

The last two are functional UI/control defects, not visual preferences.

## 2. Existing architecture worth preserving

R74/R75 already chose the correct macro-architecture:
- ten task-specialized Pages;
- global vs page-local separation;
- command palette and keyboard-first navigation;
- agent-first Command Center;
- native Browser stage;
- dedicated observability and system pages;
- page/workspace persistence.

R85 does not replace this architecture. It removes visual/control noise and makes the architecture physically match a professional control room.

## 3. Comparative research

### DaVinci Resolve — task Pages
Blackmagic documents Resolve as task-specific Pages (Media/Cut/Edit/Fusion/Color/Fairlight/Deliver) with one-click task switching.
Adopt:
- keep METAENGINE Pages as primary task contexts;
- keep a persistent page dock;
- do not turn every capability into a permanent dashboard widget.
Source:
https://www.blackmagicdesign.com/products/davinciresolve

### Visual Studio Code — stable spatial model + universal command surface
VS Code separates Activity Bar, side bar, editor, panel, status bar; layout/open state persists; views can move/hide; Command Palette gives keyboard access to functionality.
Adopt:
- one dominant work surface;
- secondary panes only when needed;
- global command surface as the universal escape hatch;
- persistent chrome shows context, not duplicated page telemetry.
Source:
https://code.visualstudio.com/docs/editing/getting-started/userinterface

### JetBrains New UI — progressive disclosure / compact mode
JetBrains explicitly targets reduced visual complexity, essential-feature access and progressive disclosure. Compact Mode reduces toolbar/header heights, spacing, padding, icons and buttons.
Adopt:
- compact professional density;
- quiet toolbar;
- high-information pages without card-dashboard decoration;
- optional detail instead of permanent decoration.
Sources:
https://www.jetbrains.com/help/clion/new-ui.html
https://www.jetbrains.com/help/rider/New_UI.html

### Chrome DevTools — panels + Drawer + command menu
DevTools lets users reorder panels/tabs/panes and move panels into the Drawer; Quick Source allows a secondary context while another panel remains active; Command Menu is a fast navigation/action surface.
Adopt:
- secondary diagnostic/log surfaces should behave like a drawer/inspector, not another permanent dashboard column;
- command palette should cover navigation and commands;
- current workspace must remain dominant.
Sources:
https://developer.chrome.com/docs/devtools/customize
https://developer.chrome.com/docs/devtools/quick-source
https://developer.chrome.com/docs/devtools/command-menu

### Cursor — agent lifecycle in a sidepane, explicit modes
Cursor surfaces agents in a sidepane, shows background agent status, allows follow-ups/takeover, and distinguishes capability modes such as Agent vs Ask.
Adopt:
- agent rail stays first-class;
- agent lifecycle/status should be glanceable;
- capability/authority must be visually explicit instead of inferred from color.
Sources:
https://docs.cursor.com/background-agent
https://docs.cursor.com/en/agent/overview
https://docs.cursor.com/en/agent/modes

### Linear — display preferences, keyboard triage, attention views
Linear allows saved display/group/order preferences, list/board switching, and a priority-oriented Inbox with fast keyboard navigation.
Adopt:
- user/display preferences belong to views/workspaces;
- attention state should be separated from the full event firehose;
- dense task/agent tables should support saved grouping/filtering rather than duplicating data across pages.
Sources:
https://linear.app/docs/display-options
https://linear.app/docs/inbox

### Temporal Web UI — vital history first, deeper history on demand
Temporal moved relationships/metadata into separate tabs and provides Compact/Timeline/Full History styles so the primary history surface shows vital information first. Saved Views preserve recurrent queries.
Adopt:
- Observability default = attention/vital events;
- raw full history remains available without occupying every screen;
- save recurrent filters/views.
Sources:
https://temporal.io/blog/the-dark-magic-of-workflow-exploration
https://temporal.io/changelog/product-area/ui

### Ray Dashboard — views by operational question
Ray Dashboard separates Metrics, Cluster, Jobs, Logs and Serve by operator goal.
Adopt:
- Compute = capacity/executors/workers;
- Tasks = work progress;
- Observability = logs/errors/events;
- avoid “one mega telemetry page”.
Source:
https://docs.ray.io/en/latest/ray-observability/getting-started.html

### Blender — persistent task workspaces
Blender workspaces are task-specific arrangements of editors and can be switched, duplicated, reordered and persisted.
Adopt:
- METAENGINE workspace presets should control page/layout preferences;
- page = domain, workspace = operator arrangement.
Source:
https://docs.blender.org/manual/en/latest/interface/window_system/workspaces.html

### Grafana — panels belong in dashboards, not global chrome
Grafana treats dashboards as collections of panels for monitoring.
Adopt:
- detailed metrics remain on Observability/Compute dashboard pages;
- global chrome only shows exceptions/attention.
Source:
https://grafana.com/docs/learning-paths/grafana-cloud-tour/explore-dashboards/

## 4. Critical UI findings

### A. Semantic hygiene is part of UI correctness
A hidden-but-mounted palette is not harmless in an agent-operated browser. Accessibility/CDP projections can expose its controls. UI visibility and automation visibility must agree.

Rule:
> If an overlay is closed, it is not mounted into the actionable semantic tree unless a specific accessibility contract requires otherwise.

### B. Permanent chrome must be low-entropy
Old R74/R75 permanent chrome stacked:
- TopBar with brand/search/4 animated KPI tiles/sparkline/WS/clock;
- 10-page PageBar + workspace + supervisor helper;
- StatusBar with daemon/fleet/tasks/budget/mirror/deferred/boot/ports/emergency flush.

This duplicates information and competes with the active surface.

R85 target:
- 42 px command bar;
- 36 px Page dock;
- 22 px read-only status line;
- detailed data only on its Page.

### C. Attention is different from telemetry
Mirror OFF + growing outbox, self-update ambiguity, failed tasks, disconnected transport are attention states.
They should be visually promoted. Normal healthy counters should recede.

### D. Destructive authority must not live in persistent micro-controls
A tiny `flush` link in StatusBar had EMERGENCY effect. Persistent chrome may navigate to a dangerous action, but should not execute it directly.

### E. Professional tools use panes, not floating SaaS cards
`rounded-lg + card-lift + hover elevation + glow` makes a dense tool feel like a dashboard of unrelated cards.
R85 uses flat panes and separators. Motion is reserved for operational transitions.

### F. The native Browser surface geometry is a contract
When chrome density changes, main-process WebContentsView bounds must change with it. R85 updates both presentation dimensions and `shell-layout.mjs` constants/tests in the same change.

## 5. R85 implemented slice

- closed Palette / global dialogs conditionally mounted;
- TopBar rebuilt as quiet command/context surface;
- page dock compressed while retaining all 10 Pages and Alt+1..0;
- StatusBar made read-only; emergency flush removed;
- mirror degradation promoted to attention;
- BUDGET_FLUSH remains available in Palette but requires explicit confirmation;
- pane hierarchy flattened;
- Command Center converted from spaced cards to integrated workbench;
- decorative lift/glow suppressed;
- reduced-motion policy strengthened;
- native ME2 bounds synchronized to new chrome dimensions;
- regression tests added for semantic isolation, persistent-chrome safety, required R75 anchors and geometry.

## 6. Next R85 slices after the first CI gate

1. **Contextual Drawer / Inspector**
   - logs, console, effect fences, task detail;
   - one secondary context without shrinking all pages permanently.

2. **Saved Views / Display Profiles**
   - task filters/grouping;
   - agent filters;
   - observability event filters;
   - workspace-level persistence.

3. **Authority badges**
   - READ_ONLY / CONTROL / MUTATION / EMERGENCY;
   - use icon + text, never color alone.

4. **Attention Center**
   - update ambiguity;
   - mirror backlog;
   - failed/blocked generations;
   - degraded transport;
   - one deduplicated queue, not repeated warnings.

5. **Resizable panes**
   - user can resize agent rail/inspector;
   - native Browser center has a protected minimum;
   - layout persisted per workspace.

6. **Performance budget**
   - centralize REST polling;
   - pages subscribe to shared resources;
   - pause hidden-page polling;
   - measure render/update cost and semantic target count.

7. **Accessibility/automation QA**
   - actionable target count;
   - no closed overlay targets;
   - keyboard-only traversal;
   - reduced-motion;
   - contrast;
   - exact semantic refs remain stable across page switching.

## 6.1 Repeat critical audit delta — 2026-09-26 21:01 UTC

The second audit deliberately re-read the physical installed R84 instead of trusting the first design pass.

Exact live evidence:
- Browser `0.7.0-dev.3.1`, `native-electron-supervisor-v1`, CONTROL, armed, Compute HEALTHY.
- Fleet converged to 4 ACTIVE / 0 BOUND_UNVERIFIED / 0 LOST.
- read-only CAPTURE command `4565ec5b-5aeb-42f7-92d5-760b7cae0c6b` completed in 52 ms against the physical local Mission Control tab.
- the closed Command Palette was still present in the installed R84 accessibility/interaction projection;
- persistent `flush` was still an actionable StatusBar control;
- mirror was OFF with outbox 853;
- Command exposed stream profile + CDP q/w tuning that belongs to Browser infrastructure, not the daily workbench;
- the agent row exposed nested interactive semantics (session pseudo-button containing a child button);
- the browser stream was unavailable and operating through CDP fallback.

R85 repeat-pass response:
- agent rows are sibling real buttons, never nested interactive controls;
- advanced stream/CDP tuning is hidden in compact COMMAND and retained in full BROWSER;
- mirror/task/command/transport/worker/budget degradation is deduplicated into a read-only Attention Center;
- duplicate AgentChat polling is replaced by a shared in-flight-fenced feed that pauses when the document is hidden;
- OBSERVABILITY Event Log now has persisted `compact | full` modes and groups adjacent related events in compact mode;
- unavailable legacy SANDBOXES PLANE is collapsed and explicitly marked LEGACY LOCKED;
- stale R74 geometry literals in the R85 layout test were removed after exact CI failure evidence (80 vs 90 px).

### Additional reference findings

**VS Code**
The workbench supports persistent movable views/panels and layout density controls, while Command Palette remains a universal navigation/action surface. R85 therefore keeps the primary work surface stable and treats persistent chrome as context, not a dashboard.

**Chrome DevTools**
Panels and panes can move to/from a Drawer, layout can adapt to window width, and the Command Menu offers fast access even when the operator does not remember placement. The next R85 slice should use a contextual Drawer/Inspector for logs, task detail and diagnostics instead of permanent columns.

**Temporal**
Temporal's redesign explicitly separates Compact, Timeline and Full History. Compact groups related events and preserves high-value information; Full History remains available for deep debugging. R85 Event Log adopts the same progressive-disclosure direction while retaining exact raw events.

**Linear**
Display options and Custom Views persist grouping/filter/layout preferences; Priority Inbox separates items requiring attention from normal updates. This directly supports Saved Views plus the R85 Attention Center.

**Cursor**
Agent/Ask/Plan/Debug and approval/run modes make capability level explicit. METAENGINE should surface READ_ONLY / CONTROL / MUTATION / EMERGENCY as first-class operator-visible authority, not infer it from color or location.

**Blender / DaVinci Resolve**
Task-specific Workspaces/Pages validate the current METAENGINE model: Page = functional domain; Workspace = persisted arrangement/preferences for a way of working.

**Ray / Grafana**
Operational views are separated by question (jobs, logs, cluster, metrics) and dashboards are parameterized rather than cloned. METAENGINE should keep TASKS / COMPUTE / OBSERVABILITY distinct and add Saved View variables instead of duplicating panels.

### Navigation finding: the advertised back/forward shortcut was not a history

The repeat audit also falsified the old `Alt+← / Alt+→` behavior. `recentPages` was maintained as an MRU list, but the shortcut derived indexes from list length, so “back” could jump several contexts and “forward” did not represent a forward stack.

R85 now keeps a chronological bounded page trail plus an explicit cursor. A normal Page navigation truncates stale forward history, while Alt+Left/Right moves the cursor without appending a synthetic visit. Page persistence, Electron presentation routing and hash state use the same presentation-sync function.

### Native composition finding: renderer overlays vs WebContentsView

The repeat pass found a cross-process UI composition defect that source-only CSS review would miss. On COMMAND, the actual Browser is a native Electron `WebContentsView` placed above the ME2 renderer. A renderer-only modal, palette, attention popover or workspace menu can therefore be physically occluded by the native Browser even when its CSS z-index is higher.

R85 now treats global overlays as a presentation-composition state:
- the presentation-only preload bridge exposes only `setPrimaryOverlay(boolean)`;
- main-process `nativeBrowserSurfaceAllowed()` removes the native Browser surface while any ME2 global overlay is open;
- Palette / dialogs are derived centrally by `Me2Shell`;
- Attention Center and Workspace menu register their own overlay sources;
- closing the last overlay restores the native Browser surface;
- this bridge grants no Browser command, scheduler, update, release or execution authority.

This is intentionally not implemented with CSS. A renderer cannot z-index above a sibling native `WebContentsView`; the owner of native view composition must resolve the occlusion.

### Native viewport finding: BrowserStage controls must live outside WebContentsView bounds

A second composition review found that the old R75 geometry started the native Browser `WebContentsView` at the top of `BrowserStage`. That means the renderer-owned browser tab strip, URL bar and status strip could exist in DOM but be physically covered by the native page surface.

R85 now makes compact BrowserStage chrome deterministic and reserves it in main-process layout:
- tab strip: 28 px;
- URL bar: 36 px;
- bottom Browser status: 24 px;
- the native Browser surface begins below the tab strip + URL bar and ends above the Browser status strip.

This turns COMMAND into a true hybrid workbench: ME2 owns controls and context, while the native Browser owns only the page viewport. The same constants are tested against `planShellLayout()`, so CSS/main-process geometry drift fails CI instead of silently hiding controls.



## 6.2 Third critical audit delta — 2026-09-26 21:44 UTC

This pass re-established source-of-truth from the current R85 branch **and** independently re-read the still-installed R84 Browser state. The installed bytes remain `0.7.0-dev.3.1`; therefore source fixes below are not claimed as physical R85 proof yet.

### Live runtime evidence

- Native Browser heartbeat remained current; runtime is `native-electron-supervisor-v1`, CONTROL, armed.
- Compute remained HEALTHY and available.
- Fleet remained 4 ACTIVE / 0 LOST / 0 BOUND_UNVERIFIED.
- Host resilience remained ACTIVE with a healthy Sentinel worker.
- Browser self-update remained fail-closed in `AMBIGUOUS_INSTALL` with `automatic_retry_allowed=false` and `restart_gate_safe=false`; the audit did not retry it.
- Supervisor keepalive remained `ROLLOVER_AMBIGUOUS` with `ROLLOVER_ERROR:supervisor_composer_not_unique`; installed R84 does not contain the R85 semantic/composer corrections yet, so no blind rollover retry was issued.

### Source audit findings that survived the second R85 pass

**1. TASKS had cross-domain control-plane leakage.**  
Although the architecture says Browser controls belong to COMMAND/BROWSER and Mirror belongs to OBSERVABILITY, TASKS still mounted its own browser-tab poll, live/steering toggles and MirrorPanel. This duplicated state, created another 15s browser polling loop and made the task page responsible for unrelated infrastructure.

R85 now removes that entire Browser/Mirror strip from TASKS. TASKS owns branch graph, queue and retry metrics only. The selected task branch view is persisted in `me2.tasks.branch-view.v1`, following the same preference model used by professional tools instead of reconstructing the view every time the page is remounted.

**2. Persistent chrome still repeated the same facts in three places.**  
Task counts appeared in TopBar and StatusBar; mirror degradation appeared in Attention Center and StatusBar. The result was a smaller R74 dashboard rather than true low-entropy chrome.

R85 now keeps TopBar for identity/context/search/Attention/transport, while StatusBar holds compact operational navigation. Mirror failure is owned by Attention + OBSERVABILITY, not repeated globally.

**3. Cached state was presented as live runtime.**  
StatusBar used the presence of `snap` to render `runtime live`. A disconnected socket can leave a valid cached snapshot, so this label was semantically wrong. It now renders `runtime live | runtime cached | runtime offline` from transport state plus snapshot presence.

**4. A native shell intent bypassed the ME2 overlay/composition model.**  
The `open-site-prompt` event used `window.prompt`. That prompt was outside the ME2 design system, outside normal semantic composition, and did not participate in the renderer/native-WebContents overlay state.

R85 replaces it with a real global `OpenSiteDialog`. Only http/https is accepted. The dialog uses the same presentation overlay path that temporarily yields the native Browser surface, and it calls the existing Desktop tab API without adding scheduler/update/release authority.

**5. Task Sheet had a render-time timer side effect.**  
The component called `setTimeout(...scrollIntoView...)` directly during render whenever a task detail existed. Re-renders could therefore accumulate unnecessary timers. It now uses a post-commit `useEffect + requestAnimationFrame`, keyed by task identity and stream length, with cancellation.

**6. Command authority existed but was visually abbreviated.**  
Registry actions displayed the lane as the first four characters. This made the strongest control boundary less explicit exactly where agents/operators select actions. R85 now renders the full authority lane text (`READ ONLY / CONTROL / MUTATION / EMERGENCY`) with text + border semantics and accessible label, rather than relying on color or abbreviation.

**7. Manual Agent Rail state was not part of native Browser geometry.**  
This was a deeper composition defect. React could hide the 252px Command agent rail with Ctrl/Cmd+B while main-process `planShellLayout()` still reserved it. At intermediate window widths the inverse could also happen: main-process geometry released the rail to preserve the 720px Browser minimum while the renderer still showed the rail. Either direction breaks the invariant that native Browser pixels and renderer chrome never overlap or leave phantom reserved space.

R85 now has one bounded presentation state for that geometry. The primary ME2 preload exposes only `setPrimaryCommandRail(boolean)`; main-process layout remains authoritative, clamps the rail away when Browser minimum width would be violated, and returns `effective_open`. Command UI persists the operator's preferred rail state but renders the main-process effective result, and re-reconciles it after window resize. The bridge explicitly carries no Browser command, scheduler, update or release authority. Installed UI attestation now requires the always-visible rail toggle rather than requiring the optional rail itself, so a legitimate collapsed preference cannot fail startup qualification.

### 2026 reference synthesis

**DaVinci Resolve 21** continues to organize the application as dedicated task Pages with one-click switching. This supports the strict domain rule now enforced in TASKS: a Page should own its task workflow, not accumulate Browser/Observability controls merely because those data are available.  
https://www.blackmagicdesign.com/products/davinciresolve/

**VS Code** keeps a dominant editor/work surface with sidebars, Panel, Status Bar and configurable visibility, while Command Palette remains a universal access point. This supports a low-entropy global shell plus optional secondary context rather than permanent telemetry everywhere.  
https://code.visualstudio.com/docs/editing/getting-started/userinterface

**JetBrains 2026.2 New UI** explicitly targets reduced visual complexity and progressive disclosure; Compact Mode reduces toolbar/header heights, spacing, padding, icons and buttons. R85's 42/36/22 chrome and flat panes follow that direction without hiding operational state.  
https://www.jetbrains.com/help/idea/new-ui.html

**Chrome DevTools** uses a Drawer so a secondary tool (for example Quick Source) can remain available while the operator works in another primary panel, and its Command Menu provides fast navigation/actions. The next R85 composition slice should use a contextual Drawer/Inspector for secondary logs/details instead of adding permanent columns.  
https://developer.chrome.com/docs/devtools/quick-source  
https://developer.chrome.com/docs/devtools/command-menu

**Cursor** exposes agents in a sidepane and separates Agent/Ask/Plan/Debug and execution/approval behavior. The relevant METAENGINE lesson is not the branding of modes but explicit capability visibility: an operator should see what an agent/action is permitted to do.  
https://cursor.com/docs/agent/overview  
https://prod.cursor.com/docs/agent/security/run-modes

**GitHub Copilot app (current)** runs several isolated agent sessions in parallel, each with its own branch/worktree or cloud sandbox, and makes Interactive/Plan/Autopilot plus model/reasoning settings explicit per session. METAENGINE's AGENTS/SUPERVISOR UI should converge toward the same direct session-state/authority visibility rather than forcing inspection through logs.  
https://docs.github.com/en/copilot/concepts/agents/github-copilot-app  
https://docs.github.com/en/copilot/how-tos/github-copilot-app/agent-sessions

**Windsurf Arena** runs multiple Cascade sessions independently, with a separate worktree for each model, then allows convergence on a chosen approach. Cascade Hooks also make pre-action blocking controls explicit for reads, writes, commands and MCP. This validates two METAENGINE directions: visible isolated parallel lanes and first-class pre-effect guardrails.  
https://docs.windsurf.com/windsurf/cascade/arena  
https://docs.windsurf.com/windsurf/cascade/hooks

**Linear** persists display options (layout/group/order/properties) as personal or workspace defaults and separates Priority notifications from ordinary updates. R85 now starts applying that model to TASKS view persistence and Attention Center.  
https://linear.app/docs/display-options  
https://linear.app/docs/inbox

**Temporal** uses Compact, Timeline and Full History to expose high-value grouped state first while retaining full low-level history for debugging; current Cloud UI also has Saved Views. R85 already applies compact grouping to Event Log; the next step is saved operator views, not additional cloned monitoring panels.  
https://temporal.io/blog/the-dark-magic-of-workflow-exploration  
https://temporal.io/changelog/product-area/ui

**Ray Dashboard** separates operational questions into Metrics/Cluster/Jobs/Logs/Serve rather than building one universal telemetry page. This reinforces the current TASKS/COMPUTE/OBSERVABILITY boundary.  
https://docs.ray.io/en/latest/ray-observability/getting-started.html

**Blender 5.2** models a Workspace as a task-specific arrangement of Areas/Editors and allows workspace duplication/reordering/persistence. METAENGINE should keep Page = functional domain and evolve Workspace = saved arrangement/preferences.  
https://docs.blender.org/manual/en/latest/interface/window_system/workspaces.html

**Grafana** recommends dynamic dashboards driven by variables to reduce dashboard sprawl. The analogous METAENGINE move is Saved Views/variables inside OBSERVABILITY and COMPUTE, not more global KPI copies.  
https://grafana.com/docs/learning-paths/interactive-dashboards/

### Next high-value UI slice

The remaining architectural gap is **Workspace = real layout**, not merely `{page, label, hint}`. The safe implementation should introduce persisted pane/view preferences first, then resizable native-aware panes only after geometry is represented in main-process layout contracts. The other priority is a contextual Drawer/Inspector shared by task detail, logs and Browser diagnostics. Both must preserve the established rule: renderer presentation may alter layout, but it does not gain Browser command, scheduler, update or release authority.



## 6.3 UI slice checkpoint A — persisted operator views

Checkpoint source head before this note: `e5764b96ada0c66f182b1458bf3c11661341dcde`.

Implemented:
- OBSERVABILITY Event Log now has persisted operator view presets: `attention | all | tasks | fleet | commands`;
- `attention` is semantic, not color-based: it filters FAILED / ERROR / AMBIGUOUS / BLOCKED / DEGRADED / REJECTED / OFFLINE tokens across event type+data;
- manually changing lane/search turns the surface into an explicit `custom` view instead of silently pretending a preset is still active;
- selection persists under `me2.obs.events.preset.v1`;
- no new effect authority, scheduler, Browser command or update bridge was added.

Post-step research:
- **Linear Custom Views** saves durable filtered views and lets operators favorite/reopen them; Display Options separately persist layout/group/order preferences. METAENGINE should preserve this separation: query scope and display density are related but not the same setting. https://linear.app/docs/custom-views and https://linear.app/docs/display-options
- **Temporal Saved Views** saves custom queries specifically to eliminate repeated filter construction; this reinforces keeping operator views lightweight and query-centric rather than cloning dashboards. https://temporal.io/changelog/product-area/ui
- **Datadog Log Explorer Saved Views** stores query, live time range, visualization and displayed facets. The useful METAENGINE lesson is that a troubleshooting context is a bundle, not only a text filter. Future custom views should be able to persist lane/query/density and eventually time horizon. https://docs.datadoghq.com/logs/explorer/saved_views/
- **Elastic Discover sessions** preserve queries, filters, columns and view configuration, and can optionally store time/refresh interval. This is a stronger model for future shareable METAENGINE operator views than saving only a filter string. https://www.elastic.co/docs/explore-analyze/discover/save-open-search
- **Grafana 13 section-level variables** reduce dashboard sprawl by scoping filters independently to a row/tab. For METAENGINE, page-local view variables should not become global filters that unexpectedly mutate TASKS/COMPUTE/OBSERVABILITY together. https://grafana.com/whats-new/2026-04-08-stop-juggling-dashboards-with-section-level-variables-for-rows-and-tabs/

Decision after research:
- keep current preset storage page-local;
- do not introduce one global `filters` store;
- next Saved Views iteration should persist a structured bundle `{query,lane,density,time_horizon,columns}` with explicit scope, rather than multiplying dashboard pages.



## 6.4 UI slice checkpoint B — native-aware Context Drawer

Checkpoint source head before this note: `6e9f66a7f8a66495422638e3b4e15e702ece5441`.

Implemented:
- a global 200px read-only Context Drawer with `Events | Commands | Runtime` tabs and `Ctrl/Cmd+J`;
- the drawer reuses already-present bounded store data and issues no command, fetch, agent or mutation effects;
- on COMMAND, the actual Browser `WebContentsView` is physically shrunk by the same drawer height in main-process geometry;
- main process enforces a protected 320px Browser minimum and can reject the drawer on short windows;
- renderer stores the operator's preferred state separately from the effective state, so temporary geometry constraints do not erase preference;
- the preload bridge is presentation-only and explicitly exposes no Browser command / scheduler / update / release authority;
- drawer open state and selected tab persist across sessions.

Post-step research:
- **Chrome DevTools / Quick Source** validates the core Drawer pattern: keep one primary panel while a secondary source/diagnostic context remains visible instead of replacing the main task. METAENGINE's drawer follows that exact information-architecture role, but its geometry must additionally coordinate with a native Electron `WebContentsView`. https://developer.chrome.com/docs/devtools/quick-source
- **VS Code Custom Layout** lets users toggle Panel/Secondary Side Bar from global layout controls and remembers view placement across sessions. This supports a persistent operator preference plus an explicit layout toggle rather than hidden automatic UI. https://code.visualstudio.com/docs/configure/custom-layout
- **Cursor 3.1 tiled Agents Window** persists pane arrangements and lets operators focus or compare concurrent agents without tab hopping. This suggests the future METAENGINE drawer should evolve into a typed secondary context that can host an agent/session comparison, but only after native geometry is generalized beyond a fixed height. https://cursor.com/changelog/3-1
- **Figma Dev Mode Inspect** keeps the selected canvas object central and renders contextual properties/code in an Inspect panel. This reinforces the rule that the drawer should be selection/context-driven, not another general dashboard. https://help.figma.com/hc/en-us/articles/15023124644247-Guide-to-Dev-Mode
- **Zed Agent Panel** exposes a dedicated agent context from a panel while the editor stays available. The useful lesson is shortcut/panel continuity, not copying chat into every page. https://zed.dev/docs/ai/agent-panel

Decision after research:
- keep the new drawer read-only in this slice;
- do not add mutation buttons to it;
- next drawer iteration should react to explicit selection (task/agent/browser target) and show typed inspector content;
- resize handles must not be CSS-only: any variable drawer height must be accepted and clamped by main-process geometry before the renderer presents it.



## 6.5 UI slice checkpoint C — Workspace becomes a layout scope

Checkpoint source head before this note: `1c5f13b0136ee59e1321961da6b649e2804eef73`.

Implemented:
- Context Drawer open/tab preferences are no longer global; they are persisted per METAENGINE workspace under `me2.workspace-layouts.v1`;
- the old global drawer keys are treated only as a one-time migration source;
- switching Workspace restores that workspace's Drawer preference and tab;
- Command Agent Rail preference is now also workspace-scoped (`me2.command.agent-rail.v2:<workspace>`) with legacy migration;
- Page remains the functional domain, while Workspace now begins to own a real arrangement preference instead of being only `{label,page,hint}`.

Post-step research:
- **Blender 5.2 Workspaces** are predefined window layouts made of Areas/Editors, geared to tasks and persisted with the file/defaults. This is the strongest direct confirmation that METAENGINE's Workspace should own arrangements while Page owns functional domain. https://docs.blender.org/manual/en/latest/interface/window_system/workspaces.html
- **IntelliJ IDEA 2026.2 Layouts** saves tool-window positions, sizes and view modes as named layouts and supports switching/restoring them. This is a better target than one monolithic global UI preference. https://www.jetbrains.com/help/idea/tool-window-layouts.html
- **VS Code Custom Layout** persists layout density, sidebars, panels and moved views across sessions and has an explicit Restore Defaults operation. METAENGINE should add workspace-level Reset Layout before adding arbitrary drag/drop. https://code.visualstudio.com/docs/configure/custom-layout
- **Cursor 3.1 tiled Agents Window** persists pane arrangements across sessions. This validates storing agent-oriented pane state by working context rather than treating tiling as transient CSS. https://cursor.com/changelog/3-1
- **JetBrains Tool Window view modes** distinguishes pinned, unpinned, undocked, floating and separate-window modes and allows saving those in layouts. METAENGINE can eventually expose typed pane modes, but Browser-native geometry must stay main-process-authoritative. https://www.jetbrains.com/help/idea/viewing-modes.html
- **DaVinci Resolve** historically couples task pages with resizable/hideable inspector/index/effects regions and resettable UI layout. The useful rule remains: panel size/visibility is user state, but the page's functional contract remains stable.

Decision after research:
- evolve `me2.workspace-layouts.v1` into a typed layout record instead of creating unrelated localStorage keys for every future pane;
- next properties should be `drawerHeight`, `agentRailWidth`, `density`, and later typed pane placements;
- add explicit workspace `Reset layout` before freeform drag/drop;
- every size that touches native Browser pixels must be accepted/clamped by main process first.



## 6.6 UI slice checkpoint D — typed layout record + Reset Layout

Checkpoint source head before this note: `3d9346bbc04d407bc61f6025b25018e85bb1c111`.

Implemented:
- `me2.workspace-layouts.v1` now owns both Context Drawer preferences and Command Agent Rail preference;
- Command page no longer creates a parallel layout-storage plane; it consumes the typed workspace layout record;
- legacy rail keys are migration inputs only;
- Workspace menu now exposes an explicit `Reset layout` action;
- reset restores safe defaults `drawerOpen=false, drawerTab=events, commandRailOpen=true` and reconciles native geometry.

Post-step research:
- **VS Code Custom Layout** exposes Restore Defaults / Reset View Locations in the same UI where users customize panes. That supports making reset a first-class operation before adding more freedom. https://code.visualstudio.com/docs/configure/custom-layout
- **IntelliJ IDEA 2026.2 Layouts** keeps a protected factory Default layout and lets the user restore it with `Shift+F12`; custom layouts are separate named states. METAENGINE's reset follows the same safety principle: user layout is mutable, safe default is not. https://www.jetbrains.com/help/idea/tool-window-layouts.html
- **JetBrains Arrange Tool Windows** explicitly saves locations *and sizes* in a layout and has a restore-default path. This confirms that future width/height persistence belongs in the same typed workspace layout record. https://www.jetbrains.com/help/idea/manipulating-the-tool-windows.html
- **Blender Workspaces** ships task-specific defaults while allowing custom workspaces. The key lesson is that reset should restore a known task layout, not simply erase random keys. https://docs.blender.org/manual/en/latest/interface/window_system/workspaces.html
- **Cursor 3.1** persists tiled agent layout across sessions; this increases the importance of a deterministic reset/recovery path once METAENGINE adds multi-agent tiling. https://cursor.com/changelog/3-1

Decision after research:
- keep one typed layout record per workspace;
- next layout schema extension will be versioned fields, not ad-hoc keys;
- any future drag-resize interaction must expose Reset Layout and preserve a main-process-safe default;
- named custom layouts can come later, after fixed workspace defaults and geometry clamps are proven.



## 6.7 UI slice checkpoint E — selection-driven read-only inspector

Checkpoint source head before this note: `678e2ae624e313f87423df173c7608902402f2d3`.

Implemented:
- Context Drawer now has a first-class `Selection` tab;
- the inspector follows two exact UI selections already owned by the application: selected agent session and last inspected task;
- task inspection retains `inspectedTaskId` after the modal/detail surface closes, so secondary context survives without keeping a blocking overlay mounted;
- agent context reuses the shared `useAgentChatSessions()` feed instead of creating a second polling/fetch path;
- the inspector shows bounded identity/state information (session id, agent id, role, model, objective/outcome summary; task id, status, spec, role and step progress);
- no effect controls were added to the inspector and it contains no direct `me2Fetch`, `sendCommand` or agent mutation API.

Post-step research:
- **Figma Dev Mode Inspect** is explicitly selection-driven: selecting a layer populates name/type, component metadata, properties, change history and implementation information in the Inspect panel. The useful METAENGINE rule is “selection determines context; the inspector explains it.” https://help.figma.com/hc/en-us/articles/15023124644247-Guide-to-Dev-Mode
- **GitHub Copilot app agent sessions** keeps multiple isolated sessions in parallel, each with its own workspace/branch, while the selected session exposes its mode, model, reasoning and work context. METAENGINE should likewise make exact session identity/state visible in the secondary inspector instead of forcing the operator to infer it from logs. https://docs.github.com/en/copilot/how-tos/github-copilot-app/agent-sessions
- **Cursor Worktrees / Agent Review** separates each agent task in an isolated worktree and makes result review a distinct inspection step. This reinforces keeping “inspect/review context” separate from actuation controls. https://prod.cursor.com/docs/configuration/worktrees and https://prod.cursor.com/docs/agent/agent-review
- **Linear issue selection** distinguishes highlight/selection from the actions that can then be invoked through keyboard, command menu or contextual menu. METAENGINE should preserve the same separation: selection itself is non-effect state. https://linear.app/docs/select-issues
- **Figma Inspect with view-only access** still exposes useful properties even when editing is unavailable. This supports a read-only inspector contract that remains valuable without inheriting authority. https://help.figma.com/hc/en-us/articles/22012921621015-Guide-to-inspecting

Decision after research:
- keep Selection inspector non-mutating;
- when selection changes, update inspector context without manufacturing task/agent authority;
- future inspector expansion should prefer exact identity/evidence/provenance fields already available in bounded projections;
- effects remain on their owning Page, task sheet, or Command Palette, not in the inspector.


## 7. Acceptance gates

R85 is not qualified by screenshots alone.

Required:
- Next production build succeeds;
- R75 required DOM anchors remain physically visible;
- installed Package Smoke succeeds;
- physical page switching succeeds;
- native Browser WebContentsView remains inside reserved center bounds;
- closed overlays are absent from CAPTURE semantic targets;
- command palette opens and is keyboard-operable;
- no persistent control directly performs EMERGENCY mutation;
- all 10 Pages remain reachable;
- source/runtime tests green;
- no authority widening;
- no regression in installed chat, soak, host resilience, self-update qualification.
