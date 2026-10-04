# ChatGPT fenced fleet successor — local green checkpoint

Status: **LOCAL SOURCE GREEN / REMOTE CI PENDING / NO NEW INSTALLER**.

Branch: `work/chatgpt-only-fenced-submit-v2`. This successor includes qualified PR #1103 source `3782b73b3f00a9d7eacaa42a4017010cfb374ba6`, exact legacy-root retirement `3a67fedd42568f8f4923fac1a53d1081f98d53a2`, and reconciled repair checkpoint `b66597983cc239b6e77a249f508856cabc108a63`. The nine three-way conflicts were resolved explicitly. The qualified PR #1103 remains unchanged; its fresh head read is still `3782b73b…`.

## Resulting behavior

- Active ChatGPT and legacy GLM identities are separate. Fleet, task cycle and Supervisor submit one draft without sending, capture its exact tab/target/origin/hash/length and unique Send, then perform one fenced Send. The native boundary rechecks the draft and runtime before activation. No Enter fallback after unknown effect.
- Restored unknown wakes and rollover sends retain durable intent. A different empty root, exact draft, STOP/idle state, elapsed time or eight no-progress cycles cannot authorize replacement or replay. A rollover target is persisted before submission. Only a current exact pending attempt with a durable pre-Send failure may enter bounded cleanup/recovery; this proof cannot be attached later to an unknown attempt or a different ID.
- Independent ChatGPT conversation ownership survives restart and generation invalidation. Conflicting restored claims hold both agents. Production command fences deny GLM/Z.ai execution even if a command relabels its platform. Legacy observations and checkpoints remain readable.
- ME2 new agents, commands, sessions and active evaluator paths use OpenAI models and explicit provider/platform metadata. Closed legacy sessions and history remain unchanged. API replies require a terminal nonempty completion; web search requires completed tool/assistant output and source evidence.
- Sovereign retains canonical PRIMARY/CRITIC roles, historical DB wire aliases and the retired V2 tombstone. Two independent hosted OpenAI request contexts require separate API credentials. Provider-shaped `/gpt/*` and `/glm/*` execution stays HTTP 410. API evidence declares `platform=OPENAI_API` and `tariff_dependency=true`.
- The source-only CI branch now checks Browser on Linux/Windows, isolated ME2 policy/transport files, Sovereign types/behavior/contracts, and Windows source visual evidence. A frozen Sovereign dependency lock is included. No physical producer or release authority is added to that workflow.

## Verification

Frozen local source was checked with Node 24.19.0 and official Bun baseline 1.3.3. Remote CI pins Node 24.21.0 and Bun 1.3.3; local success does not substitute for that CI or physical packaging.

- Full Browser: **4087 PASS / 0 FAIL / 0 SKIP**, exit 0, 244839.0917 ms.
- Full TAP evidence SHA-256: `71a7f7d17a71f22d80458fba7ae2d51afe01ce74a8d9cb2c14c09981109013f8`; local artifact `outputs/chatgpt-successor-full-regression-v2.tap` in the task workspace.
- ME2 policy: 12/12 PASS, 55 assertions; transport/search: 19/19 PASS, 74 assertions. Separate processes isolate SQLite/module/fetch state. All upstream responses are mocked; no paid model calls or cloud changes.
- Sovereign types PASS; 8/8 behavioral tests and three Python compatibility contracts PASS.
- Chat Control Plane: 43 Python tests PASS plus 9 Browser Operator debugger integration tests PASS.
- Four edited workflow YAML files parse; source-only authority guard and staged diff whitespace check PASS.
- Earlier 4069-test diagnostic and its 15 failures remain documented in the WIP checkpoint. They were resolved through actual two-phase fixtures, readback-only unknown-effect expectations and durable pre-Send recovery. The unrelated RSI 140 ms evaluator bound was not relaxed; the unchanged test passed in the final full run.

## Installer and live boundary

`0.7.0-dev.37210000001.1` is consumed by the immutable `3782b73b…` Package Smoke producer `37198104703`. This source branch intentionally retains that metadata during source qualification; **do not open a physical-package PR or rebuild that identity**. After remote source-green, reserve one fresh version atomically in package.json, both lockfile version fields and the first authoritative convergence reservation. Package Smoke must be the sole producer, and all physical consumers must bind its same head/digest.

The prior installer remains qualified on the recorded 22-workflow matrix, but it does not prove this new two-phase implementation. Its EXE digest is `afbc22d3186ba36d4af597d5a6cc1db32465a85b2185a80e7601ae5c07564d8b`.

A fresh read-only Supabase catalog query for `xpeibufgzjknrhbhpffp` again returned permission denied. No new database/Edge/live fleet state was confirmed or changed. Historical 48/48 legacy tabs, v27 canary, closed generations and active lease counts in pasted reports are not current live proof.

Next acceptance chain: remote Linux/Windows source-green → one fresh physical candidate → terminal same-head installer/Installed Chat/Final Runtime/Self Update/soak → installation → fresh authenticated ChatGPT target bindings for at least four independent roles → harmless useful task, critic barrier and durable result, with zero active GLM effects and no duplicate submission. Do not mass-close USER tabs or infer usefulness from green source tests.

Research references: [OpenAI models](https://developers.openai.com/api/docs/models), [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [web-search tools](https://developers.openai.com/api/docs/guides/tools-web-search). Browser sign-in and API credentials are separate; a Browser-selected model label is not an exact hidden serving-model claim.

Communication rule: report each completed step with result, verification, exact SHA/CI where available, remaining uncertainty and the next step.
