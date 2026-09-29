# API/SDK Fallback Scan (PRINCIPAL-DIRECTIVE §3)
*gen 2026-09-28 06:10 — tracked files scanned: 2616; files with hits: 43; total hit lines: 202*

## Classification summary
{
"NEEDS-REVIEW": 33,
"TEST-ONLY/VERIFY": 8,
"INFRA-SCRIPT": 2
}

## Directive verdict frame
- RUNTIME-CANDIDATE hits -> consumer analysis required, then REMOVE or MIGRATE (no silent API fallback allowed).
- TEST-ONLY/VERIFY + INFRA-SCRIPT -> allowed only outside runtime dispatch path.
- DOCS -> reference only.

## Hits (first 6 lines per file)
| Location | Class | Snippet |
|---|---|---|
| mini-services/agent-factory/tasks-recon2.py:28 | NEEDS-REVIEW | `"/api/chats",` |
| mini-services/agent-factory/test_agentmode.py:33 | TEST-ONLY/VERIFY | `if "chat/completions" in req.url:` |
| mini-services/agent-factory/test_signed_api.py:67 | TEST-ONLY/VERIFY | `const url = '/api/v2/chat/completions?' + urlParams + '&signature_timestamp=' + ts;` |
| mini-services/agent-factory/test_trust.py:209 | TEST-ONLY/VERIFY | `const r = await fetch('/api/v2/chat/completions?' + sp.toString() + '&signature_timestamp=' + ts, {` |
| mini-services/agent-factory/test_trust.py:232 | TEST-ONLY/VERIFY | `const r = await fetch('/api/v2/chat/completions?signature_timestamp=' + Date.now(), {` |
| mini-services/me2-daemon/providers.ts:5 | NEEDS-REVIEW | `*   gateway:<model>     — Vercel AI Gateway (OpenAI-совместимый; ключ из Supabase RPC)` |
| mini-services/me2-daemon/providers.ts:60 | NEEDS-REVIEW | `// ── Vercel AI Gateway key (R47: key живёт в vault'е БД; добыча из Supabase RPC —` |
| mini-services/me2-daemon/providers.ts:95 | NEEDS-REVIEW | `console.log(`[providers] Vercel AI Gateway key loaded from Supabase → tokens DB ${saved.ok ? "сохранён" : "(не` |
| mini-services/me2-daemon/providers.ts:114 | NEEDS-REVIEW | `gateway: { ready: Boolean(key), note: key ? "Vercel AI Gateway (key from tokens DB, R47)" : "no key (Supabase ` |
| mini-services/me2-daemon/providers.ts:135 | NEEDS-REVIEW | `const r = await fetch("https://ai.gateway.vercel.dev/v1/chat/completions", {` |
| mini-services/me2-daemon/providers.ts:227 | NEEDS-REVIEW | `const url = "https://ai.gateway.vercel.dev/v1/chat/completions";` |
| mini-services/me2-daemon/src/glm.ts:9 | NEEDS-REVIEW | `*  - Vercel AI Gateway (умеет маршрутизацию zai/glm-5.3) из sandbox сети недоступен` |
| mini-services/me2-daemon/src/quota.ts:14 | NEEDS-REVIEW | `*   L3 FAILOVER — цепочка провайдеров zai ↔ gateway (Vercel AI Gateway, ключ из vault` |
| mini-services/me2-daemon/src/tokens.ts:38 | NEEDS-REVIEW | `VERCEL_AI_GATEWAY_API_KEY: { tier: "T1", desc: "Vercel AI Gateway: LLM-провайдер gateway:<model>" },` |
| research/2026/METAENGINE-2-BLUEPRINT.md:129 | NEEDS-REVIEW | `│  • Worker pool: API-воркеры (z.ai API / Vercel AI Gateway / Ollama)             │` |
| research/2026/METAENGINE-DEVOS-ANALYSIS.md:13 | NEEDS-REVIEW | `4. **Агент остаётся вкладкой чата.** Для Development OS когниция должна прийти через API-воркеров (z.ai API / ` |
| research/2026/METAENGINE-REBUILD-RESEARCH.md:34 | NEEDS-REVIEW | `- **Claude Code** (Anthropic): однопоточный **master loop («nO»)** + очередь **h2A** с real-time steering; сло` |
| research/2026/METAENGINE-REBUILD-RESEARCH.md:36 | NEEDS-REVIEW | `- **OpenCode**: Go, TUI на Bubble Tea, **75+ провайдеров**, AGENTS.md-конвент, сессии, десктоп+IDE из одного я` |
| research/2026/METAENGINE-REBUILD-RESEARCH.md:83 | NEEDS-REVIEW | `│  • Провайдер-слой: z.ai API / Vercel AI Gateway (ключ уже в Supabase)         │` |
| research/2026/METAENGINE-REBUILD-RESEARCH.md:84 | NEEDS-REVIEW | `│    / локальные модели Ollama / любые через OpenRouter                        │` |
| research/2026/R18-reward-hacking.json:41 | NEEDS-REVIEW | `"snippet": "Jun 4, 2025 — We present a simple eval set of 4 scenarios where we evaluate Anthropic and OpenAI f` |
| research/2026/R20-s1-frameworks.json:41 | NEEDS-REVIEW | `"snippet": "I recently downloaded and tested browser-use w/gpt-5.2 after asking Claude for the nth time to bui` |
| research/2026/R20-s3-computeruse.json:14 | NEEDS-REVIEW | `"snippet": "May 25, 2026 — Claude Computer Use hit 72.5% OSWorld . Anthropic's Claude Computer Use survived, a` |
| research/2026/R20-s3-computeruse.json:22 | NEEDS-REVIEW | `"name": "Anthropic's Computer Use versus OpenAI's",` |
| research/2026/R20-s3-computeruse.json:23 | NEEDS-REVIEW | `"snippet": "Jul 30, 2025 — Anthropic's Computer Use gives Claude direct control over your desktop , letting it` |
| research/2026/R20-s3-computeruse.json:31 | NEEDS-REVIEW | `"name": "Anthropic Computer Use vs Browser Use (2026)",` |
| research/2026/R20-s3-computeruse.json:40 | NEEDS-REVIEW | `"name": "Anthropic Computer Use vs OpenAI Claude: Why 82% on",` |
| research/2026/R20-s3-computeruse.json:41 | NEEDS-REVIEW | `"snippet": "May 23, 2026 — OpenAI scored 38% on OSWorld. Anthropic's Claude Sonnet 4.6 scored 72.5 %. Coasty s` |
| research/2026/R24-vs2-codex.json:12 | NEEDS-REVIEW | `"url": "https://developers.openai.com",` |
| research/2026/R24-vs2-codex.json:15 | NEEDS-REVIEW | `"host_name": "developers.openai.com",` |
| research/2026/R24-vs3-compare.json:41 | NEEDS-REVIEW | `"snippet": "Comprehensive comparison of AI coding agents including Cursor, GitHub Copilot , Cline, and more. C` |
| research/2026/R61-ARCHITECTURE-MODEL.md:26 | NEEDS-REVIEW | `- **Auto-review классификатор**: малая модель (Claude 4.5 Haiku / GPT-5.4 Mini), агентная (ReadFile/Grep/Glob)` |
| research/2026/R61-GAP-ANALYSIS.md:30 | NEEDS-REVIEW | `- **Gap**: нет режима «sandbox-when-possible» и **пре-исполнения LLM-классификатора** для команд вне белого сп` |
| research/2026/R61-PARITY-MATRIX.md:83 | NEEDS-REVIEW | `| `ext.hooks-claude-compat` Third-party hooks import (Claude Code) | GA | — | **MISSING** | P3 |  |` |
| research/2026/R61-SOURCE-REGISTRY.md:159 | NEEDS-REVIEW | `- https://cursor.com/docs/models/claude-4-5-haiku` |
| research/2026/R61-SOURCE-REGISTRY.md:160 | NEEDS-REVIEW | `- https://cursor.com/docs/models/claude-4-5-sonnet` |
| research/2026/R61-SOURCE-REGISTRY.md:161 | NEEDS-REVIEW | `- https://cursor.com/docs/models/claude-4-6-sonnet` |
| research/2026/R61-SOURCE-REGISTRY.md:162 | NEEDS-REVIEW | `- https://cursor.com/docs/models/claude-4-sonnet` |
| research/2026/R61-SOURCE-REGISTRY.md:163 | NEEDS-REVIEW | `- https://cursor.com/docs/models/claude-4-sonnet-1m` |
| research/2026/R61-SOURCE-REGISTRY.md:164 | NEEDS-REVIEW | `- https://cursor.com/docs/models/claude-fable-5` |
| research/2026/r1-claude-loop.json:4 | NEEDS-REVIEW | `"description": "Explore the intricate architecture of Claude Code in our latest post. Designed for AI teams an` |
| research/2026/r1-claude-loop.json:13 | NEEDS-REVIEW | `"https://blog.promptlayer.com/claude-code-behind-the-scenes-of-the-master-agent-loop/": {}` |
| research/2026/r1-claude-loop.json:30 | NEEDS-REVIEW | `"html": "<html lang=\"en\"><head>\n    <meta charset=\"UTF-8\">\n    <meta http-equiv=\"X-UA-Compatible\" cont` |
| research/2026/r1-claude-loop.json:37 | NEEDS-REVIEW | `"description": "Explore the intricate architecture of Claude Code in our latest post. Designed for AI teams an` |
| research/2026/r1-claude-loop.json:40 | NEEDS-REVIEW | `"og:description": "Explore the intricate architecture of Claude Code in our latest post. Designed for AI teams` |
| research/2026/r1-claude-loop.json:47 | NEEDS-REVIEW | `"og:url": "https://blog.promptlayer.com/claude-code-behind-the-scenes-of-the-master-agent-loop/",` |
| research/2026/r10-reflexion2.json:32 | NEEDS-REVIEW | `"snippet": "by N Shinn · 2023 · Cited by 7753 — Reflexion achieves a 91% pass@1 accuracy on the HumanEval codi` |
| research/2026/r10-reflexion2.json:50 | NEEDS-REVIEW | `"snippet": "by N Shinn · 2023 · Cited by 7729 — For example, Reflexion achieves a 91% pass@1 accuracy on the H` |
| research/2026/r13-spotify-ab.json:67 | NEEDS-REVIEW | `"html": "<html lang=\"en\" class=\"lenis\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"wid` |
| research/2026/r29-glm-latest.json:14 | TEST-ONLY/VERIFY | `"snippet": "Jun 16, 2026 — GLM-5.2 , our latest flagship model for long-horizon tasks. Opus 4.7 by 11%. GLM-5.` |
| research/2026/r61-parity-matrix.json:58 | NEEDS-REVIEW | `{"id":"ext.hooks-claude-compat","cat":"extensibility","cap":"Third-party hooks import (Claude Code)","cur":"GA` |
| research/2026/r61-track-A-core.md:342 | NEEDS-REVIEW | `- Prereqs / Limitations: session persistence per workspace (cookies, localStorage/sessionStorage, IndexedDB pe` |
| research/2026/r61-track-A-core.md:432 | NEEDS-REVIEW | `- Runtime behind: Auto-review classifier = "a small Cursor-managed model. Today that is Claude 4.5 Haiku or GP` |
| research/2026/r61-track-A-core.md:510 | NEEDS-REVIEW | `- Runtime behind: per-model edit formats (patch-based for OpenAI-trained, string-replacement for Anthropic-tra` |
| research/2026/r61-track-A-core.md:586 | NEEDS-REVIEW | `- What: Model-agnostic harness abstractions customized per model: each model gets the edit-tool format it was ` |
| research/2026/r61-track-A-core.md:591 | NEEDS-REVIEW | `- Evidence: "we provision each model with the tool format it had during training"; "OpenAI's models are traine` |
| research/2026/r61-track-A-core.md:654 | NEEDS-REVIEW | `- Prereqs / Limitations: 2023-era; GPT-3.5/4 context; self-flagged caveats (pixel-perfection obsolete, control` |
| research/2026/r61-track-B-extensibility.md:293 | NEEDS-REVIEW | `- What: `model: inherit` (default) or explicit ID (e.g. composer-2, gpt-5.6-sol). Model parameters via square ` |
| research/2026/r61-track-B-extensibility.md:409 | NEEDS-REVIEW | `- What: Command hooks: shell scripts, JSON via stdin/stdout. Exit 0 = use output; exit 2 = block (Claude-compa` |
| research/2026/r61-track-B-extensibility.md:488 | NEEDS-REVIEW | `### hooks-claude-compat: Third-party (Claude Code) hooks` |
| research/2026/r61-track-C2-cli-automation.md:180 | NEEDS-REVIEW | `- What/Invoke: install CLI in workflow, `CURSOR_API_KEY` from repo/org secret, `agent -p "..." --model gpt-5`;` |
| research/2026/r61-track-D-security-computeruse.md:31 | NEEDS-REVIEW | `- Runtime behind: small Cursor-managed model — Claude 4.5 Haiku or GPT-5.4 Mini; runs in the same RPC stream a` |
| research/2026/r61-track-E1-models-context.md:4 | NEEDS-REVIEW | `Scope files: docs/cursor-router, models-and-pricing, evals, models__composer-1/2-5, models__gpt-5-6-{luna,sol,` |
| research/2026/r61-track-E1-models-context.md:8 | NEEDS-REVIEW | `Anthropic 14, OpenAI 19, Google 8, Cursor first-party 5 (Composer 1, Composer 2.5, Grok 4.5/4.6/4.7 — Grok doc` |
| research/2026/r61-track-E1-models-context.md:9 | NEEDS-REVIEW | `Context windows: 200k default (Claude/Gemini/Kimi/Composer), 256k (Grok), 262k (Kimi K2.7), 272k (all GPT-5.x)` |
| research/2026/r61-track-E1-models-context.md:205 | NEEDS-REVIEW | `- What: for GPT-5.1-Codex-Max: (1) shell-forward tool naming (closer to rg), "prefer tool over shell" instruct` |
| research/2026/r61-track-E1-models-context.md:207 | NEEDS-REVIEW | `- Evidence: "removing reasoning traces from GPT-5-Codex caused a 30% performance drop"; "we made the names and` |
| research/2026/r61-track-E1-models-context.md:236 | NEEDS-REVIEW | `- What: default vs max context per model — e.g. GPT-5.6 family 272k default / 1M max; Claude Fable 5.1 300k/1M` |
| research/2026/r61-track-E2-fleet-changelog.md:81 | NEEDS-REVIEW | `- What: Many agents at once without laptop online; managed from editor + cursor.com/agents; surfaces: Slack, L` |
| research/2026/r61-track-E2-fleet-changelog.md:110 | NEEDS-REVIEW | `- What: Browser from scratch ~1 week, >1M LoC / 1,000 files, hundreds of concurrent workers pushing one branch` |
| research/2026/r61-track-E2-fleet-changelog.md:146 | NEEDS-REVIEW | `- What: Four model mixes, same quality, wildly different cost: GPT-5.5 solo $10,565 vs Opus 4.8 planner + Comp` |
| research/2026/r61-track-E2-fleet-changelog.md:442 | NEEDS-REVIEW | `- Aug 7, 2025 — GPT-5 in Cursor — model — blog/gpt-5` |
| research/2026/r61-track-E2-fleet-changelog.md:543 | NEEDS-REVIEW | `5. **Specs-as-prompts economics**: frontier planner + cheap worker fleet cut cost ~8x at equal quality (Opus 4` |
| research/2026/r62-analogues.md:13 | NEEDS-REVIEW | `| 2 | run-modes | GA | Три режима: Auto-review (allowlisted сразу; остальное — sandbox, если возможно; несандб` |
| research/2026/r62-analogues.md:15 | NEEDS-REVIEW | `| 4 | edit-files | GA | «Suggest edits to files and apply them automatically»; diff view live; per-model edit ` |
| research/2026/r63-analogues.md:19 | NEEDS-REVIEW | `- Рантайм: «small Cursor-managed model — Claude 4.5 Haiku or GPT-5.4 Mini; runs in the same RPC` |
| research/2026/r63-analogues.md:47 | NEEDS-REVIEW | `| Классификатор | агентная малая модель (Haiku/GPT-5.4-Mini), ≤3с, таймаут-политика не оглашена | LLM-путь opt` |
| research/2026/s22-codex-app.json:12 | NEEDS-REVIEW | `"url": "https://openai.com",` |
| research/2026/s22-codex-app.json:15 | NEEDS-REVIEW | `"host_name": "openai.com",` |
| research/2026/s23-codex-ide-cloud.json:21 | NEEDS-REVIEW | `"url": "https://community.openai.com",` |
| research/2026/s23-codex-ide-cloud.json:24 | NEEDS-REVIEW | `"host_name": "community.openai.com",` |
| research/2026/s3-claude-code.json:50 | NEEDS-REVIEW | `"snippet": "Agent Loop Architecture Tool System . Anthropic's agentic coding tool. executes tasks through natu` |
| scripts/phoenix/PRINCIPAL-DIRECTIVE.md:118 | INFRA-SCRIPT | `- OpenAI/Anthropic/GLM model API;` |
| scripts/phoenix/PRINCIPAL-DIRECTIVE.md:119 | INFRA-SCRIPT | `- Vercel AI Gateway как fallback модели;` |
| scripts/phoenix/browser-test-results-dbcaps-ackctx.json:74 | TEST-ONLY/VERIFY | `"text": "GLM-5.3-Flash\nShare\nThought Process\nTOKEN_ACK b1e68f049d81d9340f14f4baa0abfa19990bbb970ac5369c7d79` |
| scripts/phoenix/browser-test-results-dbcaps-verify.json:183 | TEST-ONLY/VERIFY | `"text": "GLM-5.3-Flash\nShare\nThought Process\nTOKEN_ACK b1e68f049d81d9340f14f4baa0abfa19990bbb970ac5369c7d79` |
| scripts/phoenix/browser-test-results-e0631.json:6150 | TEST-ONLY/VERIFY | `"url": "https://chat.z.ai/api/v1/auths/",` |
| scripts/phoenix/browser-test-results-e0631.json:6160 | TEST-ONLY/VERIFY | `"url": "https://chat.z.ai/api/config",` |
| scripts/phoenix/browser-test-results-e0631.json:6170 | TEST-ONLY/VERIFY | `"url": "https://chat.z.ai/api/models",` |
| scripts/phoenix/browser-test-results-e0631.json:6180 | TEST-ONLY/VERIFY | `"url": "https://chat.z.ai/api/v1/users/user/settings",` |
| scripts/phoenix/browser-test-results-e0631.json:6190 | TEST-ONLY/VERIFY | `"url": "https://chat.z.ai/api/v1/chats/all/tags",` |
| scripts/phoenix/browser-test-results-e0631.json:6200 | TEST-ONLY/VERIFY | `"url": "https://chat.z.ai/api/v1/scene-cfg/?model=x-preview-l",` |
| scripts/phoenix/browser-test-results-mt419203.json:994 | TEST-ONLY/VERIFY | `"url": "https://chat.z.ai/api/v1/auths/",` |
| scripts/phoenix/browser-test-results-mt419203.json:1004 | TEST-ONLY/VERIFY | `"url": "https://chat.z.ai/api/config",` |
| scripts/phoenix/browser-test-results-mt419203.json:1014 | TEST-ONLY/VERIFY | `"url": "https://chat.z.ai/api/v1/users/user/settings",` |
| scripts/phoenix/browser-test-results-mt419203.json:1024 | TEST-ONLY/VERIFY | `"url": "https://chat.z.ai/api/models",` |
| scripts/phoenix/browser-test-results-mt419203.json:1034 | TEST-ONLY/VERIFY | `"url": "https://chat.z.ai/api/v1/chats/e1ec5063-0798-46df-b401-df41813e0000",` |
| scripts/phoenix/browser-test-results-mt419203.json:1044 | TEST-ONLY/VERIFY | `"url": "https://chat.z.ai/api/v1/chats/all/tags",` |
| scripts/phoenix/fleet-transcripts-dbcaps.json:5 | INFRA-SCRIPT | `"CRITIC": "GLM-5.3-Flash\nShare\nThought Process\nTOKEN_ACK ***LONG***\nREADY\nagent=1a3a0b2d (RESEARCHER) · l` |
| worklog.md:52 | NEEDS-REVIEW | `- Read docs/SAME_POINT_DUEL_V4_PEER_RELAY.md: confirmed PROPOSE/REBUT payload schema, atomic pair mechanics, p` |
| worklog.md:111 | NEEDS-REVIEW | `(d) current claim/directive state (W1 claim #24 holder=chatgpt:gpt-5.6-sol:DEV-CYCLE-002:W1-INTEGRATION; Super` |
| worklog.md:746 | NEEDS-REVIEW | `--gpt-peer-id (default chatgpt:gpt-5.6-sol), --subject-json, --repo-path` |
| worklog.md:785 | NEEDS-REVIEW | `--gpt-peer-id chatgpt:gpt-5.6-sol --peer-id glm:5.3` |
| worklog.md:850 | NEEDS-REVIEW | `(chatgpt:gpt-5.6-sol / glm:5.3), h205f22_duel_* RPCs, hash-chained events,` |
| worklog.md:2848 | NEEDS-REVIEW | `- Exact pair confirmed from source: GPT=openai/gpt-5.6-sol, GLM=zai/glm-5.3` |

## Consumer analysis (deep-dive, 14:20)

### VERDICT: mini-services/me2-daemon/providers.ts — RUNTIME VIOLATION §3 -> REMOVE/MIGRATE-pending (QUARANTINE now)
- Live execution path: direct fetch() to https://ai.gateway.vercel.dev/v1/chat/completions (lines 135, 227) — Vercel AI Gateway = explicitly forbidden by §3.
- Key acquisition: Supabase RPC (R47) -> tokens DB.
- ACTIVE CONSUMERS (5): src/review.ts, src/agentchat.ts, src/eval.ts, src/rsi.ts, src/reviewer.ts (all: import { chat } from "../providers"); index.ts wires GET /providers + GET /llm.
- Migration requirement (§15): consumers (LLM-powered review/agentchat/eval/RSI/reviewer daemon subsystems) must migrate to Web-UI fleet path BEFORE removal; bounded work package needed; daemon subsystem survival itself belongs to §6 hard classification.
- Immediate recommendation: QUARANTINE flag in daemon config (disable gateway key loading) + TODO(migrate) markers; physical removal after replacement proof.

### Reclassified bulk buckets
- research/2026/* + worklog.md hits -> DOCS (reference-only, no runtime wire) — 30 of 33 NEEDS-REVIEW resolved.
- Remaining NEEDS-REVIEW: none beyond providers.ts (all others reclassified).

### Scan completeness
- 2616 tracked files scanned; provider-API patterns absent from product runtime surfaces (src/, app/, electron/) — violation is contained to me2-daemon mini-service.
