# METAENGINE R95C — dual-axis Utility Panel splitter hardening research

Date: 2026-09-27  
Base: R95 exact qualified head `ff721dcc95f2f9d63a555ff88a0ff2616fd39cad`  
Implementation branch: `work/r95c-workflow-convergence-v1`  
Scope: presentation/layout only; zero scheduler, Browser-command, update, release or production authority.

## Evidence before mutation

R95 is now terminal-green across its full exact-head workflow matrix, including Windows Package Smoke, Installed Chat, Final Runtime, Autonomous Soak and physical Self Update E2E. This made it safe to start a successor rather than mutating R95 while qualification was incomplete.

The divergent R94 accessibility slice (#999) already proved four useful splitter semantics physically:
- cancel an in-progress resize with Escape without persisting partial geometry;
- double-click restores the preferred size;
- enlarge the effective pointer target without enlarging visual chrome;
- make keyboard focus visible on the splitter grip.

R95 added a second dock axis, so the semantics were ported rather than merging #999 wholesale.

## 2026 research pass

### WAI-ARIA APG Window Splitter

Source: https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/

The current APG contract still centers a focusable `separator` with `aria-valuemin`, `aria-valuemax`, `aria-valuenow`, `aria-controls`, and orientation-specific arrow keys. Home/End are optional. Enter collapse/restore and F6 pane cycling are also described.

Decision:
- retain the R95 separator/value/orientation contract;
- retain Left/Right for the vertical Right dock and Up/Down for the horizontal Bottom dock;
- retain Home/End bounds;
- do **not** claim Escape or double-click as APG requirements. They are METAENGINE productivity semantics layered on top of the APG contract.

### VS Code workbench

Sources:
- https://code.visualstudio.com/docs/configure/custom-layout
- https://code.visualstudio.com/docs/editing/getting-started/userinterface

VS Code treats the Panel as an auxiliary workbench region that can move around the editor, while the editor remains the primary work surface. Its layout is persistent across sessions.

Decision:
- keep one Utility Panel/data plane and move its projection, rather than creating separate Bottom and Right inspector backends;
- preserve per-Workspace preferred geometry separately from effective geometry constrained by the active Browser surface.

### IntelliJ IDEA 2026.2

Sources:
- https://www.jetbrains.com/help/idea/manipulating-the-tool-windows.html
- https://www.jetbrains.com/help/idea/tool-windows.html
- https://www.jetbrains.com/help/idea/tool-window-layouts.html

IntelliJ 2026.2 explicitly supports resizing active tool windows from the keyboard, remembered custom sizes, multiple saved layouts, and a default-layout restore path. It also preserves a strong focus model between editor and tool windows.

Decision:
- the R95C keyboard resize semantics and preferred-size reset are not an isolated browser-shell trick; they match a mature IDE convention;
- keep workspace-scoped persistence and an explicit reset instead of silently overwriting the preferred size when native geometry clamps the effective size.

### Chrome DevTools

Source: https://developer.chrome.com/docs/devtools/customize

DevTools supports Bottom/Left/Right/undocked placement, persistent panel/tab ordering, responsive panel rearrangement, and Escape as an immediate Drawer toggle.

Decision:
- fast Escape interaction is consistent with developer-tool muscle memory, but in METAENGINE an Escape during an active splitter drag is deliberately narrower: cancel that transaction and restore the starting dimension;
- the user-requested dock should never cover native Browser pixels; main-process geometry remains authoritative.

## Critical review after implementation

The first R95C change adds no new layout authority. The resize transaction remains fenced by both Workspace and dock. Escape and pointercancel share one restore path, so neither can persist a half-applied resize. Double-click checks the current Workspace+dock before persisting the preferred dimension.

The hidden hit target grows independently of visual thickness, which improves pointer acquisition without making the shell visually heavier. A focus-visible cue is applied to the grip itself, not only to the surrounding rail.

Remaining gap before R95C can qualify:
- COMMAND still owns native Browser geometry in R95;
- the next slice must move the native surface to the existing legacy `browser` page that R94 already exposes as workflow stage RUN, without rewriting the ten legacy PageKeys;
- the physical visual harness must prove both COMMAND mission-control usability and RUN + Bottom/Right Utility Panel usability.
