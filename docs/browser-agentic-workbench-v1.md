# METAENGINE Browser — Agentic Workbench V1

Date: 2026-09-03

## Why this exists

METAENGINE Browser already has stronger actuation authority controls than mainstream AI browsers: typed native commands, exact target binding, durable supervisor/fleet state, no blind retry, and explicit zero-authority page/model projections. The largest product gap is therefore not “more autonomy”. It is the operator experience around context, routing, repeatable workflows, and explainable agent state.

This document records the product benchmark that led to Agentic Workbench V1.

## Analog benchmark

### Dia

Dia's 2026 product direction combines chat-with-tabs, Memory, Skills, tab groups, a command bar, connected work context, Profiles, Splits, and proactive work surfaces such as Morning Brief / Live Work. The useful pattern for METAENGINE is explicit multi-tab context and a browser-native work command surface, not cloud memory authority.

Sources:
- https://www.diabrowser.com/
- https://www.diabrowser.com/release-notes/1-13-1-new-year-new-polish
- https://www.diabrowser.com/students

### Arc

Arc established a keyboard-first command bar, Spaces, vertical tabs, Split View, and fast switching among work contexts. The key transferable pattern is one command surface that can route to navigation, tabs, workspaces, and browser tools.

Sources:
- https://start.arc.net/command-bar-actions
- https://resources.arc.net/hc/en-us/articles/19228064149143-Spaces-Distinct-Browsing-Areas

### Perplexity Comet

Comet exposes an always-available assistant beside the page, can reference current or named tabs, reasons across open tabs, and can run multiple errands in parallel. The relevant METAENGINE pattern is explicit context selection and a persistent side workbench, while keeping task execution behind the existing typed command and lease model.

Sources:
- https://www.perplexity.ai/help-center/comet/en/articles/11734688-assistant-panel
- https://www.perplexity.ai/help-center/comet/en/articles/11583745-getting-started-with-comet-set-up

### Google Chrome + Gemini

Chrome in 2026 has multi-tab context, remembered conversation context, Auto Browse, and reusable Skills. Google also explicitly keeps confirmation in front of sensitive actions and trains against prompt injection. METAENGINE should adopt repeatable browser workflows and context ergonomics while preserving its stricter authority/effect barriers.

Sources:
- https://blog.google/products-and-platforms/products/chrome/gemini-3-auto-browse/
- https://blog.google/products-and-platforms/products/chrome/skills-in-chrome/

### Microsoft Edge + Copilot

Browse with Copilot emphasizes visible step-by-step browser actions and immediate takeover. METAENGINE already has the stronger execution proof model, but needs a clearer operator-facing activity/attention surface.

Source:
- https://support.microsoft.com/en-us/microsoft-copilot/browse-with-copilot

### Opera Neon

Neon exposes the live browser session to external agents over MCP/CLI and can recommend an appropriate agent mode from user intent. The transferable pattern is browser-native routing and live context access. METAENGINE must not copy Neon's broad external actuation surface because its authority model deliberately requires typed/fenced effects.

Sources:
- https://press.opera.com/2026/03/31/opera-neon-adds-mcp-connector/
- https://blogs.opera.com/news/2026/02/opera-neon-ai-browser-intelligent-mode/

### Browserbase / Stagehand

Stagehand v4 moves browser-agent target/state handling close to the browser, emphasizes lower-latency context, self-healing observation/action primitives, iframe support, caching and observability. Browserbase also frames identity, persistence and observability as core browser-agent infrastructure. METAENGINE already has identity/persistence/fencing; the missing user-facing layer is concise context and explainable state.

Sources:
- https://www.browserbase.com/blog/stagehand-v4
- https://www.browserbase.com/blog/what-is-a-browserbase-browser

## Gap analysis

| Capability | Strong analogs | METAENGINE before V1 | V1 decision |
| --- | --- | --- | --- |
| Keyboard-first universal routing | Arc, Dia | Address bar + separate Commands panel | Add smart workbench routing grammar to omnibox |
| Explicit multi-tab context | Dia, Comet, Chrome | Tabs/workspaces visible, but no operator context set | Add local Context Set (bounded, explicit, non-authoritative) |
| Repeatable workflows / Skills | Chrome, Dia, Neon | Commands exist but are not packaged as workflows | Add bounded Workbench Skills that only compose shell/read-only surfaces or explicit local tab actions |
| Proactive attention | Dia Morning Brief, browser-agent observability | Rich telemetry exists but operator must hunt across sections | Add Attention queue derived only from trusted shell snapshot |
| Visible agent activity | Edge Copilot, Browserbase | Evidence exists in Supervisor/Fleet/DevOS panels | Add compact Activity projection |
| Split View | Arc, Dia | Single remote view | Separate native PR: changes WebContentsView geometry and target-binding blast radius |
| Browser as external MCP server | Opera Neon | Deliberately absent | Do not add: conflicts with typed authority boundary unless a separately fenced MCP actuator is designed |
| Broad autonomous page action | Chrome, Comet, Edge | Already available only through stronger typed/fenced plane | Keep existing authority architecture |

## Agentic Workbench V1 contract

V1 is a renderer/workbench capability only. It MUST NOT create a second scheduler, command lease path, page/model authority path, arbitrary eval path, or automatic retry path.

### Smart omnibox routing

- `>attention`, `>activity`, `>context`, `>skills`, `>fleet`, `>workspaces`, `>supervisor`, `>devos`, `>runtime`, `>safety`, `>commands` open trusted local workbench sections.
- `@query` targets open tabs/workspaces. A unique match selects exactly that tab. Multiple matches only filter/reveal the context rail; they do not guess a target.
- `/research`, `/triage`, `/authority`, `/context`, `/new` are bounded Workbench Skills.
- Normal URL input keeps the existing navigation path.

### Context Set

- Explicitly operator-selected open tab IDs only.
- Stored locally in renderer storage; no page content is persisted.
- Bounded to 8 tabs.
- Missing/closed tabs are pruned on snapshot refresh.
- It has no scheduling, model, browser-actuation, or authority semantics.

### Attention

Attention items may be derived from trusted shell projections only, including:
- fleet ambiguous/lost/bound-unverified counts;
- workspace binding drift/frozen holds;
- supervisor errors;
- self-update errors/holds;
- Development Plane not-ready state;
- Compute offline state;
- wildcard owner-gate override.

Untrusted page text is never promoted into control authority or an automatic action.

### Activity

Activity is a read-only compact view of already-exposed current/last command, fleet state, mesh state, DevOS cycle, update state and worker-observer evidence.

## Deliberately separate: Native Split View

Split View is valuable, but it changes how multiple `WebContentsView` instances are attached and sized simultaneously. That affects exact tab/target perception and must be implemented with explicit target-incarnation tests in a separate native branch. It should not be smuggled into a renderer UX patch.
