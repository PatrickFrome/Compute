# METAENGINE Browser — Agentic Workbench benchmark and adoption plan

Date: 2026-09-03

## Executive finding

The strongest 2026 AI-browser products are converging on five product primitives:

1. browser-native multi-tab context;
2. reusable prompt/workflow shortcuts;
3. visible agent activity with immediate human takeover;
4. a standard external agent interface (MCP and/or CLI);
5. low-latency structured observation with strong prompt-injection boundaries.

METAENGINE already exceeds mainstream products on a different axis: typed native effects, exact target/incarnation binding, durable leases, ambiguity as a terminal no-replay state, explicit authority projections, and evidence-gated release/update. Therefore the correct product strategy is not to widen autonomous authority. It is to add the operator ergonomics and developer surfaces from the best analogs while preserving the existing effect boundary.

## 2026 analog benchmark

### Perplexity Comet

Comet's Assistant is a persistent sidecar that can use the current tab or explicitly named tabs as context. Its Shortcuts feature turns repeatable workflows into reusable mini-agents. A particularly valuable safety/UX detail is that entering a shortcut does not execute it: the shortcut expands into a prompt that the user can still inspect or extend before submission.

Sources:
- https://www.perplexity.ai/help-center/comet/en/articles/11734688-assistant-panel
- https://www.perplexity.ai/help-center/en/articles/11897890-comet-shortcuts
- https://www.perplexity.ai/help-center/comet/en/articles/11906981-comet-query-shortcuts

Transfer to METAENGINE:
- keep explicit bounded tab context;
- add reusable workflow/shortcut composition;
- retain a no-auto-execute boundary for shortcut expansion.

### Microsoft Edge + Copilot

Browse with Copilot exposes browser actions visibly and lets the user interrupt/take control at any time. Microsoft also exposes enterprise allow/block domain policy for agentic browsing, and the feature is explicitly invoked rather than automatically activated.

Sources:
- https://support.microsoft.com/en-us/microsoft-copilot/browse-with-copilot
- https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/allowbrowsingwithcopilot

Transfer to METAENGINE:
- make current activity/evidence visible in one operator surface;
- add an explicit human takeover control that blocks future leases/effects without claiming to cancel an already attempted physical effect;
- evaluate domain-scoped capability policy as a separate control-plane slice.

### Google Chrome / Gemini Spark

Chrome-integrated agentic browsing can operate inside logged-in sessions while explicitly handing sensitive actions back to the user. Google describes prompt-injection protection as part of the design.

Sources:
- https://blog.google/innovation-and-ai/products/gemini-app/gemini-spark-updates-july-2026/
- https://blog.google/products-and-platforms/products/chrome/bringing-chrome-ai-to-android/

Transfer to METAENGINE:
- keep high-risk/sensitive transitions behind explicit human/evidence boundaries;
- do not let web content acquire instruction authority.

### Opera Neon

Opera Neon exposes the live logged-in browser to external agents through MCP. Opera also ships a local browser CLI; Opera describes the CLI as lower overhead and broader in tool coverage than the MCP connector, while MCP is better for external/cloud clients.

Sources:
- https://blogs.opera.com/news/2026/03/opera-neon-adds-mcp-connector-to-the-browser/
- https://blogs.opera.com/news/2026/05/opera-browser-cli/

Transfer to METAENGINE:
- define a typed tool manifest now;
- do not expose a broad network listener or mutation tools until every effectful tool can reuse the existing lease/exact-target/effect-intent contracts;
- prefer a future local read-only stdio/CLI surface before a network-accessible actuator.

### Browserbase / Stagehand v4

Stagehand v4 moves target/state handling close to the browser and exposes observe/act/extract/agent primitives. Browserbase emphasizes inspectable sessions, persistence and agent observability. Its agent-harness guidance treats page content as untrusted and recommends structured, schema-validated projections rather than raw DOM-to-model promotion. Stagehand also uses caching to reduce repeated inference.

Sources:
- https://www.browserbase.com/blog/stagehand-v4
- https://www.browserbase.com/blog/what-is-a-browser-agent-harness
- https://www.browserbase.com/changelog/caching-configurable
- https://www.browserbase.com/solutions/browser-agents

Transfer to METAENGINE:
- continue using semantic/accessibility perception instead of raw DOM authority;
- preserve the existing UNTRUSTED_DATA_ONLY boundary for page-derived context;
- if observation caching is added later, key it to exact target + process incarnation + URL/content provenance and never reuse an effect decision from cache.

### Dia

Dia combines chat-with-tabs, Skills, Memory, sidebar workspaces and tab groups. The valuable pattern is continuity of work context and reusable skills. Persistent model memory, however, is a separate privacy/authority decision and should not be smuggled into browser context state.

Source:
- https://www.diabrowser.com/release-notes/1-13-1-new-year-new-polish

## METAENGINE gap map

| Capability | Market leaders | METAENGINE status before this slice | Decision |
| --- | --- | --- | --- |
| Multi-tab context | Comet, Dia, Chrome | Provenance-safe Context Pack core now exists | Keep explicit/bounded; surface it in Workbench |
| Keyboard-first browser command surface | Arc/Dia/Comet-style products | Separate address/operations interactions | Add smart Workbench routing |
| Reusable workflows | Comet Shortcuts, Dia Skills | Commands exist but not packaged as operator workflows | Add bounded Workbench Skills now; add no-auto-execute prompt shortcuts in a control-plane-safe follow-up |
| Attention / activity | Edge, Browserbase | Evidence exists but is scattered | Add read-only Attention + Activity projections |
| Human takeover | Edge Copilot | Supervisor can already change CONTROL/MONITOR + armed state but shell UX is absent | Separate control-plane PR with positive state readback and no retroactive-effect claim |
| External MCP/CLI | Opera Neon | Deliberately absent | Define sealed typed manifest first; no external listener in this slice |
| Domain allow/block policy | Edge | Existing global authority gates, no agentic domain policy | Separate policy PR; deny by default for effectful external tools |
| Prompt-injection boundary | Chrome, Stagehand | Strong semantic/untrusted-data contracts already exist | Preserve; do not promote page text to instruction authority |
| Observation caching | Stagehand | Small local perception cache already exists | Future read-only optimization only; never cache/replay effects |
| Persistent AI memory | Dia | Not a browser authority primitive | Defer pending explicit privacy/product design |

## Implemented in Agentic Workbench V1

This renderer-only slice deliberately has no new authority surface.

### Smart omnibox

- `Ctrl+K` opens command routing.
- `>section` routes to trusted Operations/Agentic sections.
- `@query` searches tabs/workspaces; only a unique match can select a tab. Ambiguous matches reveal/filter rather than guess.
- `/skill` invokes only bounded local Workbench workflows.
- ordinary URLs continue through the existing `NAVIGATE` command.

### Context Set

- explicit local tab IDs only;
- maximum 8 tabs;
- no page-text persistence;
- closed tabs are pruned;
- no scheduler/model/browser-actuation authority.

### Attention

Derived only from trusted shell projections: Fleet, typed Workspaces, Supervisor, updater, Development Plane, Compute and owner safety gates. Page content is intentionally excluded and no remediation is automatic.

### Activity

A compact read-only projection over already exposed command, Mesh, Fleet, DevOS and observer evidence.

### Workbench Skills

Bounded navigation among trusted browser work surfaces plus explicit local tab actions. No arbitrary script, page/model instruction path, scheduler, or automatic effect retry is introduced.

## Follow-up sequence

1. **Human Takeover** — trusted-shell Pause/Resume backed by the existing Native Supervisor `setControlState`, blocking future DevOS leases while never claiming to cancel an in-flight physical effect.
2. **Reusable prompt shortcuts** — no-auto-execute expansion, explicit Context Pack provenance, custom bounded definitions.
3. **External tool manifest + local read-only CLI/stdio** — browser/context/status first; no effectful tools until lease/effect-intent reuse is proven.
4. **Domain-scoped agentic policy** — deny-by-default effect allowlist for any future external actuator.
5. **Observation cache hardening** — exact target/incarnation/URL/provenance key; read-only only.
6. **Native Split View** — separate native geometry/target-binding PR with exact reincarnation tests.

## Non-negotiable invariant

No feature in this product roadmap may turn page/model text, convenience UI state, an external client, or cached observation into authority to replay or bypass an ambiguous physical effect. Existing lease, exact-target/incarnation, ambiguity and evidence contracts remain the authority boundary.