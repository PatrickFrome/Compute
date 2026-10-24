# DevFleet Education — E1–E7 safe browser authorization and topic notebooks

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
3. Use **Продолжить с GPT в обычном браузере** by default: the app copies a current, structured teaching prompt and opens the official ChatGPT site in your default browser. The native embedded GPT view is experimental and may not support Google sign-in.
4. Paste the copied text manually in ChatGPT and send it yourself. The app does not automatically post, scrape, or assert that a new empty ChatGPT root has been persisted as a conversation.
5. A material chat can be linked to one owned native GPT tab using `material_id`. The original 16-native-tab limit remains, and a missing/ambiguous tab is never silently replaced.

As before, there is no automatic Send or chat content import. These 120 material chats are organized course starters, **not** 120 finished ChatGPT conversations or full teaching manuals. Further instruction depends on user-directed GPT discussion and real practice.

## E6: JavaScript diagnosis, richer lessons, and supported GPT handoff

**Observed:** On a disposable Windows Electron 44.0.0 (Chromium 152) diagnostic profile, JavaScript executed in both a local document and the ChatGPT page. ChatGPT returned HTTP 200 for its main resource and many JavaScript assets, and the read-only probe reported scripts present and an executing script engine. Electron's `webPreferences.javascript` default is `true` and we explicitly set `javascript:true` for the native ChatGPT view without weakening `webSecurity`. This does **not** identify the cause of the user's error message in their existing authorized session or prove that every embedded ChatGPT feature is supported. Do not spoof User-Agent, disable security or bypass an authentication/bot challenge.

**Stable recovery path:** The Education view now has a prominent `Продолжить с GPT в обычном браузере` button in both the material center and always-available right sidebar. Only after a deliberate student click, the trusted main process builds an instructional text exclusively from the selected seeded material plus checked assessment counts, copies it to the system clipboard, and opens the fixed URL `https://chatgpt.com/` in the system's regular browser. The learner **must paste and send it manually**; no account/session migration, DOM scraping or automated Send occurs. The native ChatGPT tab remains opt-in and marked *experimental*. Diagnostic button reports the native view's last load event and JavaScript preference, not content or browser credentials.

**Improved curriculum:** All 120 locally seeded lessons gain a subject-specific learning objective, four explained technical terms, additional conceptual explanation, a common misconception, a reflection question and recommended foundation sources. Four complex topics gain distinct deeper worked explanations: origin of voltage, SWIFT-style fusion alignment and quality checks, OTDR trace principles and optical link budget. The learning prompt includes the selected lesson, glossary, teaching guidance, safe worked exercises, source links and bounded verified practice counts. No lab self-report is silently elevated to a certified skill.

**Source trust:** The curriculum is prepared instructional content, not automatic verification of up-to-date standards or equipment-specific manuals. Students should verify standards and product-specific parameters using the linked primary sources. Official OpenAI API integration with authenticated automatic responses is a separate architecture/consent/billing decision, not enabled by this change.

## E7: Google login fix and personal notebooks for each tab

**Root cause of screenshot:** The screenshot shows a Google Account sign-in page inside the application's embedded Electron view, with a misleading message about JavaScript. The isolated Electron diagnostic confirms JavaScript works. Google's OAuth policy explicitly disallows authorization through untrusted embedded user agents; see https://support.google.com/accounts/answer/7675428 and https://developers.google.com/identity/protocols/oauth2/policies. Neither setting `javascript:true` nor modifying user-agent tokens can legitimately solve this authorization policy. Native Google OAuth navigations and popup requests are intercepted in Education mode; the app opens only the fixed official https://chatgpt.com/ root in the system browser, not the embedded OAuth URL containing possible state data. It shows a notice to the learner. Login completes in that browser; the app cannot silently inherit its cookies/session. No credential interception, CAPTCHA evasion, browser fingerprint spoofing or arbitrary external URL dispatch.

**Per-tab notebooks:** There is a local separate notebook for each of 120 authored topic tabs (`material_id`) and each actual owned GPT tab (`tab_id`). Linked GPT tabs remain separate notebooks, but the same topic's selected handoff may include both notebooks if the learner opts in. Each entry has a title, rich plain-text body, source label (`student` or `gpt_manually_copied`), date and stable ID. Add, edit, delete operations are validated and serialized, preserving old `education-state.json` records. The existing lesson notes remain untouched. A newly selected tab gets its own notebook; switching tabs must not expose notes from another.

**Dynamic link within supported boundaries:** Every time a learner opens/copies the GPT instructional prompt, main process assembles the **current** lesson and study evidence. If the separate **include notebook** checkbox is checked, it also adds up to eight recent notes from that topic and its bound GPT tab. With the box off, private notebook text is excluded. In both cases, text is only copied to clipboard and the student manually pastes/sends it in the official browser. The system does NOT read back ChatGPT answers, write into Google accounts or independently synchronize external ChatGPT histories. An answer can be pasted by the student into the tab notebook with explicit `gpt_manually_copied` provenance (not independently verified).

**Testing:** Native Google OAuth blocking is covered by allowlist/URL-rejection tests. Independent per-topic, per-GPT-tab persistence, source provenance, editing/deletion, concurrent writes, explicit sharing and legacy migration have targeted tests. The Electron UI smoke tests typed notebook IPC and switching from one topic notebook to another, in a disposable profile without any ChatGPT request or Google login.

## Key evidence limitations
- One correct multiple-choice answer is a checked **practice answer**, not a skill certificate. The field `mastered` is retained for E1–E3 compatibility; consumers must not interpret it as professional mastery.
- User-entered lab reports are self-reported and unverified. No physical instrument, external attestation, supervisor proof or independently evaluated lab evidence exists yet.
- Device clock changes can shift offline review dates; no centralized trusted clock is introduced.
- Live ChatGPT login / persisted account restoration and manual end-user acceptance are still UNKNOWN.
- No independently installed or signed Education-specific Windows client exists yet, and the normal standalone DevFleet retains a 16-session maximum.
- Actual laboratory simulators, OTDR trace evaluation, rubric-based practical exams and native PG17 storage are future milestones.
- User-generated lesson notes and reports stay local; explicit shared context excludes their body text.

## Testing (E7)
```powershell
npm test
npm run smoke:education
```

The E7 isolated Windows run has 148/148 Node tests PASS and Electron smoke v2 PASS, including the full 120-item material list, changing the displayed offline lesson by clicking a different topic, trusted material-to-GPT-tab binding through both IPC and the visible «Открыть GPT» control, and no ChatGPT network activity. Smoke uses a disposable temporary profile, no ChatGPT network access, and verifies 15 subject folders, lesson panel, reviews UI, local study summaries, note IPC, practice-answer review creation, self-reported lab entry, tab binding, native center view geometry and profile isolation. Receipt: `%TEMP%\devfleet-education-smoke-receipt.json`. It is not evidence of real ChatGPT sign-in or a signed installer.

## Code ownership
- `src/education.html`: Education renderer and manual UX.
- `src/education-preload.cjs`: bounded Education IPC.
- `src/education-core.mjs`: journal and durable assessment/lab store, plus immutable E5 catalog projection and GPT bindings.
- `src/education-library.mjs` and `src/education-library-a/b/c.mjs`: 120 authored per-topic materials across 15 subjects.
- `src/education-review.mjs`: review ladder and bounded context summaries.
- `src/education-lesson-depth.mjs`: teaching objectives, glossary, expansion paragraphs, spotlight explanations, allowlisted references.
- `src/education-handoff.mjs`: trusted, bounded user-initiated GPT prompt construction, with optional per-tab notes.
- `src/education-auth-routing.mjs`: strict Google OAuth embedded route check and fixed external ChatGPT URL.
- `src/curriculum.mjs`: curated lessons/prerequisite definitions.
- `src/main.mjs`: Education startup, IPC and per-mode isolation.
- `src/chat-surface.mjs`: native GPT view layout.
- `test/education-*.test.mjs`, `scripts/education-electron-smoke.cjs`: tests/receipts.

## Next milestone E8
1. Native Windows user acceptance: verify actual ChatGPT sign-in, create/resume chat, manual material-to-GPT prompt copy and UI screenshot with an authorized Education profile.
2. Add **independent** multi-task assessment rubrics that require diverse performance evidence, not one MCQ or self-report.
3. Replace misleading `mastered`/progress labels across all interfaces with evidence level descriptors.
4. Implement an external-instrument evidence import process with explicit human verification for electronics/fiber practice.
5. Assess dedicated installer identity and isolated packaging; migrate education records to local PG17 only after a staged, proven mechanism is justified.
