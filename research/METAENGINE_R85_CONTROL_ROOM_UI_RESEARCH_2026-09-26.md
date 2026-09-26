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
