# Light website workspace — E12

Scope: ONLY `apps/devfleet-education-web`. No desktop app code, profiles, installations or running app processes were modified. Browser testing uses headless Chrome in a disposable test profile, not Electron.

## User interface
- Light warm-white surfaces, soft sage accents, mostly borderless navigation and subtle separators.
- Only four visible concepts: topics, lesson, notebook and ordinary ChatGPT handoff.
- Lesson above chat; adjustable divider. Topic list at left, off-canvas on a narrow screen. The per-topic notebook is closed on initial load and reload; it opens as a sidecar or a mobile overlay.
- No learning-test controls, exam widgets, completion counters, progress meters, grading panels, dashboard, settings page or version/API badges. Existing quiz blocks are not rendered. Theory, examples, deeper explanations, glossary and sources remain.
- Lesson edits/images/Undo and chat binding/context/manual patch actions moved into small contextual menus. Backup download/import remains under the notebook menu.
- Unsaved notebook drafts follow their topic within the session. Saved notes and chat-question drafts persist in the existing IndexedDB journal.

## Compatibility and boundaries
The database name, journal store, schema, all 120 topic IDs and original catalog remain unchanged. Legacy reading/progress and quiz data are retained in backups but not shown; no personal browser records are deleted by the update. New quiz/check/exercise patches are rejected by the UI. Developer regression checks are retained: the request removed learning tests from the website, not engineering verification.

The ordinary ChatGPT integration is unchanged: a user click copies context and opens a normal chat separately. This site does not generate an answer, read the user's ChatGPT conversation or verify the selected model. Notebook content is included only when checked. No API calls or third-party tracking were introduced.

## Verification
- 28 Node regression tests passed on Node 24 (Windows) and Node 22 (local build).
- Dependency-free static build passed.
- `node scripts/light-browser-smoke.mjs`: PASS in actual Chrome without preload/Node page access. Disposable-profile checks cover light background, 1440/1024/390/320 CSS-width layouts without overflow, material above chat, initially hidden notebook, notebook persistence and cross-topic isolation, question drafts, unsaved note drafts, notebook opt-in, legacy state preservation and offline reload.
- Four website screenshots reviewed: desktop reading, desktop notebook, mobile reading and mobile notebook. No real ChatGPT calls, no user credentials and no desktop-app mutations.

Deployment must be verified independently against the source SHA. The new service-worker cache version updates public assets only; IndexedDB is not cleared or renamed.
