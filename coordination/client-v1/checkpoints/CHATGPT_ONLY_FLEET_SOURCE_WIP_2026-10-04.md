# ChatGPT-only fleet source checkpoint — 2026-10-04

Status: **SOURCE_WIP / NOT QUALIFIED / DO NOT PACKAGE OR PROMOTE**.

This isolated work started at PR #1103 source `b4688d5ae7318fed58fa5e898e867e974ae28915`, qualified ancestor `b677c356b5dd3de09192dc4e7e6145b9ac361d37`. The user's later handoff identifies successor `3782b73b3f00a9d7eacaa42a4017010cfb374ba6`; fresh GitHub read confirms all 22 workflows completed SUCCESS, including Self Update run `37198104691` and Package Smoke producer `37198104703`. That remote candidate has not been changed by this checkpoint.

The later candidate still classifies `semanticPlatform === AGENT_PLATFORM_ID` as the old PRE_TYPE-only lane, despite `AGENT_PLATFORM_ID=CHATGPT`. Its green matrix therefore does not prove the requested two-phase ChatGPT submit contract. This repair must be reconciled onto that successor before any new reservation.

Implemented locally:

- Active ChatGPT and literal legacy GLM identifiers are separate. ChatGPT submits by type without submission, exact draft hash/length and fresh Send readback, then one fenced Send effect. No Enter-to-click fallback or automatic replay after unknown effect.
- Native production command policy denies legacy GLM inference mutations and z.ai routing under another platform label; historical reads remain possible.
- Independent agent conversation claims survive restart/generation invalidation. Duplicate claims are refused; conflicting restored claims hold both agents. New records declare OPENAI/CHATGPT.
- ME2 new agents, model commands, API sessions, Brain, Reviewer, demand and executor pool use OpenAI identifiers and provider metadata. Closed session and event history remain unchanged. Active legacy identities are migration inputs only.
- API transport requires positive terminal nonempty completion. Web search requires completed tool execution and real source provenance. Legacy classifiers cannot invoke bare `zai`.
- Sovereign A/B uses separate OpenAI contexts and IDs; legacy ledger actor labels remain compatibility aliases. Separate API credentials are required before leasing. API use has `tariff_dependency=true`.
- Source CI is wired for the migration branch on Linux/Windows, with isolated ME2 policy and transport tests, Sovereign request tests and compatibility contracts. No fresh package identity was reserved.

Evidence available at checkpoint:

- ME2 policy: 12/12 PASS, 55 assertions, isolated SQLite/temp workspaces, no network.
- ME2 transport: 19/19 PASS, 74 assertions, mocked upstream only.
- Sovereign: 8/8 behavioral tests, TypeScript and three Python contracts PASS.
- Chat Control Plane: 46 Python contract tests PASS.
- Browser focused source/devos/native run: 485/485 PASS; production legacy policy: 10/10 PASS.
- Four edited workflow YAML files parse successfully.
- First broad Browser diagnostic: 4069 tests, 4054 PASS, 15 FAIL, 0 skipped, 292111.9594 ms. This run overlapped ongoing test-harness repairs. It is failure evidence, not qualification. Remaining old Enter/fallback source assertions, Supervisor ambiguity/hydration mocks and a local RSI evaluator timing failure must be resolved and the final source rerun.

The original version `0.7.0-dev.37153249506.1` is consumed by the b677 producer. The later candidate version `0.7.0-dev.37210000001.1` is likewise consumed. Neither may be relabeled or rebuilt after source changes. A future reservation must update package.json, both lockfile version fields and the authoritative convergence reservation atomically after source-green.

Next: reconcile source repairs onto the later candidate plus exact legacy-root retirement slice `3a67fedd42568f8f4923fac1a53d1081f98d53a2`; resolve regressions, qualify source, reserve one fresh identity, then qualify a single physical producer. Live version/auth/fleet/task/critic evidence must be read afresh after installation. Pasted live Supabase/client observations are historical until independently read back.

Research: [OpenAI model catalog](https://developers.openai.com/api/docs/models), [GPT-6.1 Sol API capabilities](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [OpenAI web-search contract](https://developers.openai.com/api/docs/guides/tools-web-search). Browser account-selected ChatGPT model is not an exact serving-model claim; daemon API credentials are separate from Browser sign-in.

User communication rule: after each completed development step, report result, tests, exact SHA/CI where known, remaining uncertainty and next action.
