# METAENGINE R95 — Utility Panel docking research

Date: 2026-09-27
Base: R94 exact qualified head `c33437eb915b31dc537fc1b33bc406fe561a3f3b`
Scope: presentation/layout only. No scheduler, Browser command, retry, update, release or promotion authority.

## Post-R94 question

After R94 moved the shell to workflow-stage navigation, the next highest-value shell gap was the fixed Bottom-only Context Drawer. The same read-only context plane is useful while planning, building, running Browser work and observing failures, but a single orientation wastes either vertical or horizontal space depending on task and monitor geometry.

## Research after R94

### VS Code Workbench

VS Code separates the main editor region from Primary Sidebar, Secondary Sidebar and Panel. The Panel can move to left, right, bottom or top, and layout choices persist. Secondary views remain auxiliary to the stable primary work surface.

Source:
- https://code.visualstudio.com/docs/configure/custom-layout
- https://code.visualstudio.com/docs/editing/getting-started/userinterface

Adopted:
- Utility Panel is a secondary workbench region, not another primary Page.
- Position is persisted per METAENGINE Workspace.
- R95 starts with Bottom / Right / Hidden(open=false), the two positions that map cleanly to current Browser-native geometry.
- Reset Workspace restores a safe Bottom/default-size layout.

Not adopted yet:
- arbitrary drag/drop of individual views between all regions;
- top/left Utility Panel placement;
- unconstrained tiling.

Those would add geometry and state complexity before measured need.

### WAI-ARIA Window Splitter

The APG Window Splitter pattern defines a focusable `separator`, orientation-specific arrow keys, Home/End bounds, and value semantics.

Source:
- https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/

Adopted:
- Bottom dock: horizontal separator, Up/Down resize.
- Right dock: vertical separator, Left/Right resize.
- Home/End select min/max.
- Pointer and keyboard resize share the same workspace+dock transaction identity.
- Pointer cancel restores the starting dimension and never persists into a new workspace/dock.

Potential follow-up:
- Enter collapse/restore and optional F6 pane cycling after focus traversal is audited across all seven workflow stages.

## Geometry decision

The native Browser `WebContentsView` remains authoritative and must never be covered by renderer chrome.

Bottom mode:
- reserves Utility Panel height from native Browser height;
- preserves the proven R85/R94 behavior.

Right mode:
- reserves Utility Panel width from native Browser width;
- opens only when the remaining Browser width stays at or above `SHELL_MIN_REMOTE_WIDTH`;
- otherwise fails closed with `ME2_CONTEXT_DRAWER_CLOSED_FOR_ACTIVE_SURFACE`;
- may clamp width when some, but not all, requested width is available.

Renderer preference is not geometry authority. COMMAND sends a narrow presentation-only bridge request:
`open + dock + preferred height + preferred width`.
Main process computes effective geometry and returns readback.

## UI decision

Internal store/component names remain `contextDrawer*` for compatibility in R95, but visible language becomes **Utility Panel**.

The panel contains the same read-only planes:
- Selection
- Events
- Commands
- Runtime

No duplicate data plane is introduced.

Right-dock content is reflowed rather than merely squeezed:
- Selection becomes vertically stacked;
- Runtime becomes one column;
- Event/command rows become compact inspector rows.

## Persistence

Each Workspace persists independently:
- open/hidden
- active tab
- follow-selection
- Bottom height
- Right width
- dock
- existing command rail state

Switching Workspace or dock invalidates an in-flight resize transaction before any pointer-up can persist the old geometry.

## Next research/implementation step

After R95 physical qualification:
1. inspect Bottom and Right physical screenshots on COMMAND at 1440x960;
2. verify degraded narrow-window behavior;
3. research Linear Peek / VS Code Secondary Sidebar focus behavior;
4. implement temporary Peek inspection without navigation;
5. then move to command/action surface and visual token system.
