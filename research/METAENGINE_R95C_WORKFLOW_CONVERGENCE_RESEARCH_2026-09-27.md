# METAENGINE R95C — workflow convergence research (2026)

Date: 2026-09-27  
Branch: `work/r95c-workflow-convergence-v1`  
Base: fully qualified R95 `ff721dcc95f2f9d63a555ff88a0ff2616fd39cad`

## Problem

R94 already renamed the primary dock around the operator workflow:

`COMMAND · PLAN · BUILD · RUN · FLEET · OBSERVE · SYSTEM`

but the live shell still projected native Browser pixels on legacy PageKey `command`. That made the vocabulary and actual spatial model disagree. A divergent #1002 correctly proposed COMMAND as mission control and RUN as the Browser host, but it also rewrote the durable PageKey model and its visual gate still assumed the old COMMAND-only proof.

R95C deliberately converges semantics without a PageKey migration:
- the existing ten module/deep-link PageKeys remain durable;
- R94's stage→module mapping remains the navigation projection;
- `command` becomes mission control;
- legacy `browser` becomes the RUN execution surface;
- native Browser geometry follows only `browser`;
- Utility Panel native reconciliation follows only `browser`.

## Research: workflow pages vs internal modules

### DaVinci Resolve 21

Source: https://www.blackmagicdesign.com/products/davinciresolve

Blackmagic continues to organize Resolve around dedicated pages for concrete stages of the user's production workflow. The page vocabulary describes the work being done rather than the internal software modules that implement it.

Adoption:
- keep the seven-stage R94 dock as the user-facing model;
- do not expose the old ten module names as seven equally important primary destinations;
- preserve old modules as hosted surfaces/deep links so functionality is not lost.

### VS Code workbench

Sources:
- https://code.visualstudio.com/docs/editing/getting-started/userinterface
- https://code.visualstudio.com/docs/configure/custom-layout

VS Code keeps a stable central work region and treats Primary/Secondary Side Bars and Panel as supporting regions. Views can move without changing the identity of the underlying workbench feature, and persisted layouts restore across sessions.

Adoption:
- one Utility Panel data plane, multiple projections;
- native Browser remains the protected central execution surface on RUN;
- layout preferences stay separate from effective geometry.

### IntelliJ IDEA 2026.2

Sources:
- https://www.jetbrains.com/help/idea/tool-windows.html
- https://www.jetbrains.com/help/idea/tool-window-layouts.html
- https://www.jetbrains.com/help/idea/manipulating-the-tool-windows.html

IntelliJ models the editor as primary and tool windows as task-specific supporting surfaces. Tool-window layouts can be moved, resized, saved and restored.

Adoption:
- COMMAND should remain useful without the Browser surface;
- RUN owns execution pixels;
- supporting data should degrade before the active execution surface.

### Cursor 2026

Sources:
- https://cursor.com/docs/agent/overview
- https://prod.cursor.com/docs/agent/tools/browser
- https://cursor.com/changelog/3-4

Cursor's current Agents Window treats browser/files/changes/terminal as distinct working tabs. Browser can live inline or separately, state persists by workspace, and full-screen tabs let one work surface temporarily dominate. The May 2026 full-screen tabs change explicitly prioritizes focus on a single selected work surface.

Adoption:
- Browser is a first-class RUN surface, not permanently embedded in mission overview;
- future R96 Peek can preview details without forcing navigation;
- future focus/full-screen behavior should maximize a selected RUN/BUILD surface without inventing new execution authority.

## Research: contextual information and actions

### Linear Peek

Source: https://linear.app/docs/peek

Linear Peek previews the selected issue/project without navigation. Space toggles or momentarily holds the preview; Up/Down changes the focused item while the preview follows; Escape closes it.

Adoption for R96:
- Peek must be presentation-only;
- it should follow current selection but never create Browser/task authority;
- temporary hold and explicit pin/open should be distinct;
- selection can change under an open preview without changing the current workflow stage.

### Raycast Action Panel

Sources:
- https://manual.raycast.com/action-panel
- https://manual.raycast.com/keyboard-shortcuts

Raycast exposes actions for the *selected item* via Ctrl/Cmd+K rather than permanently displaying every possible control. Escape backs out, while the primary action remains directly accessible.

Adoption for R97:
- contextual actions should be derived from selected-object capability metadata;
- the palette can expose actions without duplicating control buttons across every module;
- destructive/effectful actions keep existing trusted authority and approval gates.

## Critical geometry finding during R95C implementation

The first RUN layout draft tried to release the passive telemetry inspector before rejecting a requested Right Utility Panel. That was unsafe because BrowserPage visibility was still controlled by a viewport breakpoint; main-process geometry could hide its reservation while the renderer continued showing the inspector, allowing native pixels to overlap web chrome.

The implementation was corrected before qualification:
- renderer telemetry now appears at `xl` only;
- main-process inspector threshold is exactly 1280 px;
- main process never independently "releases" a renderer-visible inspector;
- if telemetry + Right Utility Panel + 720 px protected Browser minimum cannot all fit, the Utility Panel fails closed;
- below xl, telemetry is absent in the renderer and the Right Utility Panel may use that freed region.

This is the stronger invariant: **renderer visibility and native reservation must be the same state machine or share an exact deterministic breakpoint.**

## Architecture decision

Do not cherry-pick #1002 wholesale.

R95C selectively adopts:
1. COMMAND mission-control semantics;
2. Browser/legacy `browser` as RUN host;
3. RUN-specific native layout profile;
4. physical visual evidence for COMMAND and RUN;
5. #999 splitter interaction hardening.

R95C intentionally rejects:
- wholesale PageKey rewrite;
- a second navigation/state plane;
- stale COMMAND-native geometry assumptions;
- renderer/main geometry divergence;
- any new command/effect authority.

Next after exact-head qualification: R96 Peek Inspector, then R97 contextual Action Panel.
