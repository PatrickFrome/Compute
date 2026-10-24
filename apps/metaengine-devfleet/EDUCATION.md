# DevFleet Education — E1–E5 seeded technical-learning library

## Purpose and current status
Education mode adds a structured technical-learning workspace on top of DevFleet's native Electron ChatGPT view system. It is **not** a certified training system or an installed Windows release. Source branch is a Draft PR; do not merge or overwrite the live DevFleet/METAENGINE installation before the remaining acceptance gates.

## Launch from apps/metaengine-devfleet

```powershell
npm ci
# If Electron's binary is absent after npm ci because install scripts were blocked:
node node_modules/electron/install.js
npm run start:education
```

The pinned official Electron installer is checksum-backed; do **not** enable every package install script. Normal `npm start` retains development mode. Education uses its own `userData` path `METAENGINE DevFleet Education`, isolating browser storage and operator sessions. The currently opened development instance is not hot-reloaded by a source edit.

## Current implemented capabilities
- Three-column layout: nested subject folders and GPT tabs on the left, native ChatGPT WebContentsView in the middle, curriculum/reviews/notes/lab log and assessments on the right.
- 15 seeded technical directions and 30 curated lessons with prerequisite IDs.
- Create and bind GPT tabs using DevFleet-owned `tab_<uuid>` identities, with live-session checks and no automatic message sending or page scraping.
- A user-controlled lesson prompt; explicit copy of an aggregate of **locally verified practice results** between disciplines. No chat transcript is extracted.
- 26 fixed-answer practice questions (two in each of 13 subject areas), with answer keys held in the main process and not included in renderer snapshots.
- Per-question review tracking with a deterministic 1/3/7/14/30/60-day ladder (24-hour intervals measured against the local system clock in UTC timestamps). Correct early practice cannot accelerate a due date; a wrong answer resets the review to due-now.
- Review queue showing due, scheduled and untouched question counts; click an item to switch to its discipline.
- User-authored lesson notes and practice/laboratory reports (`analysis`, `simulation`, `physical`). All reports carry explicit `self_reported_unverified` provenance and **do not grant practical mastery**.
- Read-only cross-discipline context summaries share only counts of correctly answered local questions, attempts, review-due items and unverified lab reports. Sharing to a GPT chat is manual and opt-in.
- Local atomic serialized `education-state.json`; E1–E3 state is migrated additively in memory when `reviews` or `labs` did not yet exist. No Supabase, hosted DB or PostgreSQL mutations.
- Education-only preload exposes a narrow IPC surface. No physical Send, read/scrape, remote code execution, local RPC control plane or Dev Console in Education mode.

## E5: 120 prepared offline study chats

The seeded local learning catalog contains **exactly 120 distinct, manually curated Russian-language study threads**: eight in each of the 15 root subject folders. Each includes a beginner explanation, a real-world example, a self-directed exercise and a checking question. All are available locally immediately without creating or authenticating a ChatGPT conversation. The content lives in reviewed static modules `education-library-a/b/c.mjs`, combined by `education-library.mjs`, and is read-only; student notes and assessment attempts remain separate.

### How a learner uses it
1. Select a discipline in the left tree and open one of its eight prepared material chats (◇).
2. Read the offline material in the central panel. This is **curated content, not an AI-generated or persisted ChatGPT conversation**.
3. Press **Скопировать учебный материал для GPT** to get a structured explanatory teaching prompt, then **Открыть GPT для этой темы** to create an owned ChatGPT tab (or reopen an already linked active tab).
4. Paste the copied text manually in ChatGPT and send it yourself. The app does not automatically post, scrape, or assert that a new empty ChatGPT root has been persisted as a conversation.
5. A material chat can be linked to one owned native GPT tab using `material_id`. The original 16-native-tab limit remains, and a missing/ambiguous tab is never silently replaced.

As before, there is no automatic Send or chat content import. These 120 material chats are organized course starters, **not** 120 finished ChatGPT conversations or full teaching manuals. Further instruction depends on user-directed GPT discussion and real practice.

## Key evidence limitations
- One correct multiple-choice answer is a checked **practice answer**, not a skill certificate. The field `mastered` is retained for E1–E3 compatibility; consumers must not interpret it as professional mastery.
- User-entered lab reports are self-reported and unverified. No physical instrument, external attestation, supervisor proof or independently evaluated lab evidence exists yet.
- Device clock changes can shift offline review dates; no centralized trusted clock is introduced.
- Live ChatGPT login / persisted account restoration and manual end-user acceptance are still UNKNOWN.
- No independently installed or signed Education-specific Windows client exists yet, and the normal standalone DevFleet retains a 16-session maximum.
- Actual laboratory simulators, OTDR trace evaluation, rubric-based practical exams and native PG17 storage are future milestones.
- User-generated lesson notes and reports stay local; explicit shared context excludes their body text.

## Testing (E5)
```powershell
npm test
npm run smoke:education
```

The E5 isolated Windows run has 136/136 Node tests PASS and Electron smoke v2 PASS, including the full 120-item material list, changing the displayed offline lesson by clicking a different topic, trusted material-to-GPT-tab binding through both IPC and the visible «Открыть GPT» control, and no ChatGPT network activity. Smoke uses a disposable temporary profile, no ChatGPT network access, and verifies 15 subject folders, lesson panel, reviews UI, local study summaries, note IPC, practice-answer review creation, self-reported lab entry, tab binding, native center view geometry and profile isolation. Receipt: `%TEMP%\devfleet-education-smoke-receipt.json`. It is not evidence of real ChatGPT sign-in or a signed installer.

## Code ownership
- `src/education.html`: Education renderer and manual UX.
- `src/education-preload.cjs`: bounded Education IPC.
- `src/education-core.mjs`: journal and durable assessment/lab store, plus immutable E5 catalog projection and GPT bindings.
- `src/education-library.mjs` and `src/education-library-a/b/c.mjs`: 120 authored per-topic materials across 15 subjects.
- `src/education-review.mjs`: review ladder and bounded context summaries.
- `src/curriculum.mjs`: curated lessons/prerequisite definitions.
- `src/main.mjs`: Education startup, IPC and per-mode isolation.
- `src/chat-surface.mjs`: native GPT view layout.
- `test/education-*.test.mjs`, `scripts/education-electron-smoke.cjs`: tests/receipts.

## Next milestone E5
1. Native Windows user acceptance: verify actual ChatGPT sign-in, create/resume chat, manual material-to-GPT prompt copy and UI screenshot with an authorized Education profile.
2. Add **independent** multi-task assessment rubrics that require diverse performance evidence, not one MCQ or self-report.
3. Replace misleading `mastered`/progress labels across all interfaces with evidence level descriptors.
4. Implement an external-instrument evidence import process with explicit human verification for electronics/fiber practice.
5. Assess dedicated installer identity and isolated packaging; migrate education records to local PG17 only after a staged, proven mechanism is justified.
