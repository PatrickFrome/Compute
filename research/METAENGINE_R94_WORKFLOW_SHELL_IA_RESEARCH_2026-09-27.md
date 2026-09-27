# METAENGINE R94 — Workflow Shell IA research

Date: 2026-09-27
Base: R93 qualified head `5ecb3ed6d587b3d6bf1b188c38f73c463bf7b386`
Scope: presentation/information architecture only. No scheduler, Browser command, update or release authority.

## Problem

R93 exposes ten architectural modules as peer-level pages:

`COMMAND · AGENTS · BROWSER · CODE · TASKS · SUPERVISOR · COMPUTE · MEMORY · OBSERV · SYSTEM`.

This is complete but makes the operator learn METAENGINE's subsystem topology before learning its work loop. The shell should expose operator workflow first and preserve modules as secondary destinations.

## Analog research applied

### DaVinci Resolve
Blackmagic's documented page strip follows production workflow stages rather than subsystem/package names (Media → Edit → Fusion → Color → Fairlight → Deliver). The important transferable principle is **workflow-stage primary navigation**, not visual imitation.

Source:
- https://documents.blackmagicdesign.com/UserManuals/DaVinci-Resolve-15-Definitive-Guide.pdf

### VS Code workbench
VS Code separates the stable editor/work surface from Primary Sidebar, Secondary Sidebar and Panel; view locations are movable and persisted. The transferable principle is **stable primary stage plus contextual secondary regions**, with layout persistence.

Source:
- https://code.visualstudio.com/docs/configure/custom-layout

### Linear Peek
Linear previews selected issue/project details with Space without forcing navigation. The transferable principle for the next shell step is **temporary inspection without losing the primary workflow stage**.

Source:
- https://linear.app/docs/peek

### Raycast Action Panel
Raycast separates item selection/search from contextual actions and exposes the full action set via Cmd/Ctrl+K. The transferable principle for the next command-surface step is **contextual actions instead of permanent button chrome**.

Sources:
- https://manual.raycast.com/action-panel
- https://manual.raycast.com/quickstart

### Chrome DevTools Drawer
DevTools keeps secondary tools in a Drawer that can be opened/closed independently of the main tool and supports alternate docking. The transferable principle for the next layout step is **Utility Panel Bottom/Right/Hidden**, not another global page.

Source:
- https://developer.chrome.com/docs/devtools/customize

## R94 decision

Primary shell stages become:

1. COMMAND — objective, active work, attention
2. PLAN — tasks, dependencies, execution plan
3. BUILD — code, diffs, tests, terminal
4. RUN — browser/application surfaces
5. FLEET — agents, delegation, supervisor
6. OBSERVE — events, traces, memory, outcomes
7. SYSTEM — runtime, compute, releases, settings

Legacy module pages are not deleted or aliased away. They remain exact page identities used by native geometry, deep links and command palette. Group ownership is explicit:

- COMMAND → command
- PLAN → tasks
- BUILD → code
- RUN → browser
- FLEET → agents + supervisor
- OBSERVE → observability + memory
- SYSTEM → system + compute

For grouped stages the dock exposes a small module menu. Thus the primary vocabulary is simplified without losing capability or creating hidden replacement implementations.

## Geometry invariant

The R94 dock keeps the existing 36px (`h-9`) pagebar height. This is important because native Browser WebContentsView bounds reserve `ME2_PRIMARY_PAGEBAR_HEIGHT`; changing renderer height without the native layout contract would cause overlap/drift.

## Post-implementation visual review

Physical Package Smoke capture of the first R94 pass confirmed the seven-stage dock works, but also exposed one duplicated navigation axis: the workspace name appeared both in the new TopBar breadcrumb and as a second selector in the bottom dock. That weakens the intended model because workspace (global context) and workflow stage (current production step) read as peers.

R94 therefore moves the actual Workspace selector/reset control into TopBar and removes it from PageBar. The bottom strip now has one job only: workflow-stage navigation. This keeps the two axes visually and semantically separate without changing the existing workspace persistence model.

## Keyboard transition

`Alt+1..7` selects the seven workflow stages. `Alt+Left/Right` retains exact page history. Legacy modules remain reachable from grouped menus and global palette.

## Color semantics started

R94 begins separating brand/selection accent from health:
- cyan = navigation / selected shell context;
- green = healthy/live state;
- amber = attention;
- rose = failure.

This is intentionally narrow; full tokenization belongs to the later visual-system step.

## Next implementation step after R94 qualification

Utility Panel v2:
- Bottom / Right / Hidden;
- per-workspace persistence;
- same existing Selection / Events / Commands / Runtime data plane;
- no new command authority;
- native Browser geometry reconciliation for Bottom mode and explicit non-overlap contract for Right mode.

Then:
- Peek inspection;
- contextual Action Panel;
- shell surface/color/typography tokens;
- full 7-stage visual qualification matrix.
