# E11 standalone website verification

## Source scope
Only `apps/devfleet-education-web` is new. Existing desktop DevFleet/METAENGINE source and running installations are not replaced. Catalog: 15 subjects and 120 authored Russian topics retained from the existing curriculum; this release does not claim a fresh deep research audit of every topic.

## Completed checks
- `npm test`: 24/24 Node tests PASS on Windows Node 24.19.0. Also passes in the Linux development environment.
- `npm run build`: dependency-free static build PASS.
- `scripts/browser-smoke.cjs`: PASS in Chromium 152.0.7977.54, served over HTTP with no preload, Node integration, third-party scripts or API requests. Electron is used only as the existing test browser, not as a site runtime dependency.
- Responsive material-above-chat layout tested with target content sizes 1440x960, 1024x768 and 390x844. Windows DPI produced actual CSS widths 1440, 1026 and 392; document widths matched, with no horizontal overflow.
- Per-topic notebooks and drafts; default-private notebook context; opt-in only for selected topic; editing plain text; inert script-shaped content; Undo; interactive Ohm-law calculator; manually reviewed JSON patch; reading marks; reload persistence; default-hidden drawer; and offline reload after initial service-worker installation: PASS.
- Browser console errors: zero. GPT calls: zero. Third-party requests in the controlled smoke: zero.

## Not claimed
No embedded or automatic ordinary ChatGPT conversation, no verified GPT-6 Pro selection, no API use, and no automatic cloud synchronization. Real ChatGPT replies are not part of the browser smoke. Data remains inside the current browser/origin and requires export/import to move. Imported old desktop notes are mapped or retained as archive records; old live-edit journals, images and browser cookies are not automatically migrated.

Public deployment must include only static authored catalog/source. Never include any personal journal, API key, authorization cookie or test browser profile.
