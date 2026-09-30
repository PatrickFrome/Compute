# Client UI.1 — research and critical design audit

Date: 2026-09-30. Source: `work/client-v1-c4-proof-reconciliation-hardening-v1 @ 558a260efc9ee3f9b1fa0219b317428881407501` (PR #1083).

The current product is R97/R109's single native Agent workspace, not the historical ten-page dashboard. This audit uses that source and the exact-head Windows Package Smoke artifact `11084786149`, run `36686610048`. Its five PNGs were inspected as renderer evidence; their empty native slot is not evidence of a failed live z.ai conversation.

## Primary-source research

| Reference | Useful interaction principle | Decision for METAENGINE |
| --- | --- | --- |
| [Cursor Agents Window](https://cursor.com/docs/agent/agents-window) | A session workspace combines agents, work and review; an editor remains available for focused implementation. | Keep native conversation as the main surface; make agent selection searchable and reliable. Do not add a parallel agent runtime. |
| [Cursor review](https://cursor.com/learn/review-and-test) | Review changes and verifiable outputs, rather than infer quality from apparent completion. | Show verified result separately from task admission; keep identifiers and evidence available through Status. |
| [VS Code Agents window](https://code.visualstudio.com/docs/agents/run/agents-window) | Session context owns conversation, files, changes, terminals and browser state. | Native actor identity owns selection. A UI click cannot manufacture successful binding. |
| [VS Code layout](https://code.visualstudio.com/docs/configure/custom-layout) | Secondary tools can be hidden and restored; density and placement are explicit presentation preferences. | Preserve primary pixels, while keeping a usable agent picker when the rail no longer fits. |
| [VS Code UX](https://code.visualstudio.com/api/ux-guidelines/overview) | Containers have distinct roles; view actions belong to their owning context. | Group Settings by purpose; do not turn its landing page into a six-panel dashboard. |
| [ChatGPT Windows](https://help.openai.com/en/articles/9982051-using-the-chatgpt-windows-app) | Compact input and conversation continuity reduce navigation cost. | Keep a single task input, short readable status and a keyboard-accessible details dialog. This is an interaction inference, not a claim that METAENGINE implements the companion window. |
| [DaVinci Resolve](https://www.blackmagicdesign.com/products/davinciresolve) | Dedicated workspaces organize tools around the current job. | Keep Tasks, Code, Supervisor, Memory and Evidence as deliberate tools; remove navigation to retired surfaces. Do not copy Resolve's permanent dock into this single-workspace client. |
| [IntelliJ New UI](https://www.jetbrains.com/help/idea/new-ui.html) | Reduce visual complexity, progressively disclose complexity and preserve legibility. | Use readable type, higher-contrast neutral text, text actions and collapsed recovery internals. |
| [Browserbase replay](https://docs.browserbase.com/platform/browser/observability/session-replay) | Inspection connects session evidence to the relevant browser context. | Keep evidence inspectable with exact task/request identity. Do not label renderer fixtures as live-agent execution or build an unbound replay. |
| [WAI-ARIA dialogs](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) | Modal focus remains inside; Escape closes; focus returns to the invoking control. | Use existing Radix modal primitives and explicitly test Escape/focus restoration for task status and the narrow-window picker. |
| [WCAG contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) | Normal text needs at least 4.5:1 contrast. | Replace faint gray labels with `#a1a1aa` on dark workbench surfaces and raise historical 8–10 px labels to 12 px. This change is not a full WCAG certification. |
| [Electron WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view), [View](https://www.electronjs.org/docs/latest/api/view) | Native views have main-process bounds and visibility independent of renderer CSS. | Compare actual DOM bounds against the production layout planner and a real local native view. |
| [React lazy](https://react.dev/reference/react/lazy) | Defer component code until the tool is rendered. | Load retained advanced pages on demand, with a visible loading fallback. |

## Defects supported by source or physical evidence

| Severity | Finding | Before | Change / verification |
| --- | --- | --- | --- |
| P0 | Native goal-bar collision | Renderer has 42 px TopBar + 48 px GoalComposer; `ME2_R95_RUN` reserves only 42 px. | Production planner reserves 90 px; Windows DOM/native-view equality becomes mandatory. |
| P1 | Actor selection looks successful before acknowledgement | `setChatId` runs before IPC and catches errors silently. | Require matching actor and tab plus positive exact binding before local selection; show rejection. Fault-injected Windows selection must preserve the previous row. |
| P1 | Fleet access vanishes below 1008 px | Rail hides to protect native width, without an actor-selection alternative. | TopBar Agents picker uses the same roster and typed native selection; overlay hides native view. |
| P1 | Installed narrow-window attestation is inconsistent | CDP requires the hidden rail to be visible. | Require the rail OR the compact picker to be visible, while both controls remain present. |
| P1 | Retired Settings destinations | Command, Agents and Compute are advertised despite removal from `PageKey`; they normalize back to Browser. | Five retained tools only; actual route mounting is tested. |
| P1 | Build hides type errors | `ignoreBuildErrors: true` lets stale routes and malformed response types pass. | Fix all reported project type errors and restore strict Next build checks. |
| P1 | Misleading task status | IDs, schema language and duplicate proof codes occupy the main bar. | Short lifecycle labels; detailed request/task identity and proof in Status. Queued is never labeled completed; completed without proof remains proof pending. |
| P1 | Refresh confused with submit | One `pending` state labels readback as Submitting and does not synchronously fence double actions. | Distinct read/submit states and synchronous operation fence; timers invoke read-only goalStatus only. |
| P1 | IME confirmation can submit | Enter handler does not check composition. | Ignore composing Enter; physical fixture counts submit invocations. |
| P1 | UI progress remains stale | Goal readback requires manual refresh. | Visibility-aware observation every five seconds, without automatic submit or effect retry. |
| P1 | All Settings resources poll at once | Five independent loops run regardless of the section needed. | Only active area loads; Tools performs no Settings resource requests; reads deduplicate. |
| P1 | Offline looks like perpetual loading | Failed reads leave null data and loading copy indefinitely. | Bound read-only fetches to eight seconds; expose unavailable state and explicit Refresh. Mutation timeout/retry semantics are unchanged. |
| P1 | Source-sync action competes with package updates | UI offers applying fast-forward from the historical unrelated daemon lineage. | Retain collapsed source inspection; remove source apply from the installed client's Settings. Native updater keeps ownership. |
| P2 | Low legibility | 8–10 px technical labels and faint gray are widespread in the captured UI. | Scoped readable text tokens and common section hierarchy; external Agent pages are not restyled. |
| P2 | Decorative persistent chrome | Brand glyphs, redundant action icons and section chevrons compete with text. | Text-only main chrome; one semantic section toggle; no duplicate toggle buttons. |
| P2 | Connection badge overstates health | LIVE/OFF can be read as autonomy status. | Label daemon feed as Data live/offline; roster and task evidence remain separate. |
| P2 | Model metadata repeats in every actor | Role, ID, state and the same model form three tiny lines. | Model once in roster header; role and short unique ID with readable textual state. |
| P2 | Heavy tools eagerly load | Main shell imports all advanced pages. | Lazy page modules; retained tools keep their existing ownership and controls. |
| P2 | External presentation dependencies | Google-font build downloads and an unrelated remote favicon. | System font stack and METAENGINE metadata; no runtime font/icon request needed. |
| P1 | Settings advertises unavailable mutations | Token writes, policy reload and source check remain enabled without a successful resource read; recovery copy points to retired SQLite files. | Require available section data before exposing these actions; remove obsolete local-database advice. |
| P2 | Package identity reused | Several candidates reuse `0.7.0-dev.36516587173.1`. | Commit unique monotonic candidate version `0.7.0-dev.36718632888.1` before producer qualification. |

## Scope and evidence boundaries

This slice repairs presentation, observation and installed UI qualification. It does not add a scheduler, provider API, inferred Agent-origin proof, geometric z.ai click path, or release authority. Private model reasoning is neither requested nor fabricated; cooperation must use shareable plans, messages, action logs and verified results.

The Windows visual harness uses a labeled local native geometry fixture and controlled IPC receipts. It proves renderer/native composition, navigation and interaction contracts. It does not prove C4/C5 live Agent execution, perpetual autonomous development, a working user-machine update or production readiness.

Local strict TypeScript and production webpack build pass. Local browser/server launch was blocked by the execution environment (`uv_interface_addresses`, executable permission); no local live visual PASS is claimed. Windows exact-head Package Smoke, Installed Chat, Final Runtime, Soak and Self Update remain required.

Windows clean-build finding: the unused `src/lib/db.ts` template imported an ungenerated Prisma client; no runtime imports refer to it. Removing that dead module closes the clean-install typing failure without disabling strict validation.

Follow-up audit items: historical tracked `.next` output should be removed in a separately qualified repository-hygiene change; deeper advanced pages still contain legacy technical content; the canonical C4/C5 physical Agent-origin/result exit gate remains independent of these UI improvements.
