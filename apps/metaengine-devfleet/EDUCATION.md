# DevFleet Education — E1–E3 isolated prototype

## Purpose
Education mode reuses DevFleet's native Electron ChatGPT view system for structured technical learning, while preserving the ordinary DevFleet development experience. This prototype is **not** an installed release or a professional certification system.

## Launch (from apps/metaengine-devfleet)
```powershell
npm ci
npm run start:education
```
Normal `npm start` retains development mode. Education mode has a separate Electron `userData` directory named `METAENGINE DevFleet Education`, which also separates ChatGPT sessions and the browser partition. Launch Education from the disposable development worktree, never by overwriting the installed DevFleet. Do not run the two modes with the same QA profile override.

## Implemented
- Three-column UI: editable hierarchical subject folders and owned GPT conversations at left, native GPT view in the middle, instructional context on the right.
- Fifteen seeded directions (technical mathematics, physics, electrical engineering, electronics, digital techniques, networks, optics, fiber cabling/splicing, testing, PON, safety, projects).
- Thirty fixed learning modules with explicit prerequisite IDs. User selects a module and copies an instructional prompt to their own GPT chat.
- One introductory deterministic multiple-choice question for 13 subjects, with correct answer verified in the trusted main process. **This is only a practice check, not evidence of real professional competence.**
- Student's manually authored per-module notes persist locally. Notes alone never mark skills mastered.
- Native ChatGPT conversation creation and binding to a specific folder, using the real DevFleet tab identity `tab_<uuid>`. Binding requires a live owned tab.
- Separate main-process local durable state: `education-state.json`. Atomic, bounded, serialized updates; no hosted database.
- Education-only preload exposes list/create/select and typed educational operations. It does **not** expose physical Send, conversation scraping, developer console, or arbitrary execution. Local RPC and Dev Console are not started in Education mode.

## Not in scope yet
- Validated Electron UI end-to-end with signed Windows installer;
- Cross-chat automatic understanding/reading of GPT conversation contents;
- PostgreSQL 17 migration; this alpha uses private local JSON to avoid changing existing database/runtime;
- Adaptive scheduler, spaced repetition, skill evidence, comprehensive independent examinations, labs and OTDR/OLTS simulator;
- Automated account login or imported ChatGPT message history.

## Known limitations
- Chats exist as real DevFleet-owned native tabs. If an old physical tab cannot restore, its curriculum binding persists as a reference but cannot be selected until recovery; no automatic replacement/resend.
- Native DevFleet has a 16-session capacity. Education does not bypass this limit.
- A single correct multiple-choice answer is shown only as a verified answer, not as mastery of a professional skill.
- This is a separate mode, not a separately installed Windows product with its own installer/application ID. Distinct packaging should come after independent Electron qualification.

## Testing
From app root run `npm test`; includes core persistence, tab-identity, hierarchy and cycle safety, assessment correctness, note persistence, curriculum consistency and IPC scope checks. CI/Electron visual checks remain separate acceptance gates.

## Files
- `src/education.html`: UI, no dynamic executable lesson content from GPT.
- `src/education-preload.cjs`: bounded education IPC.
- `src/education-core.mjs`: education store, quiz checking.
- `src/curriculum.mjs`: fixed curricula and prerequisite graph.
- `src/main.mjs`: standalone Education startup and IPC wiring.
- `src/chat-surface.mjs`: layout for Education center GPT view.
- `test/education-*.test.mjs`: regression tests.

## Next milestone (E4)
1. Run disposable-profile Electron startup/UI regression and check three-column physical WebContentsView bounds.
2. Add multi-item skill assessments with evidence provenance and an examiner that does not blindly trust chat prose.
3. Implement spaced repetition on proven answers and manual revision reports.
4. Create dedicated installer identity only after isolated packaging and native UI acceptance.
