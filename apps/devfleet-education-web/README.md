# Current website: E12 light workspace

Only topics, lessons, notebooks and chats remain in the user interface. Learning tests/progress were removed; existing local data is preserved. See LIGHT_UI_E12.md for the redesign and current verification. The E11 notes below describe the initial port and are retained for historical context.

# DevFleet Education Web — E11

Standalone browser-first technical academy, extracted from the authored DevFleet Education curriculum. No Electron installation, API key, backend, or npm dependency is needed at runtime. The site includes 15 subjects and 120 Russian learning topics, original explanations, exercises, glossaries and source links. This is a website port, **not a new independent deep research review of every lesson**.

## Run

Node.js 22+ is needed only for development/build tooling:

```sh
npm test
npm run build
npm start
# http://127.0.0.1:4173/
```

Deploy `dist/` to a static HTTPS host. On Vercel select this directory as Root Directory, framework Other, build `node scripts/build.mjs`, output `dist`. Do not deploy the desktop user's profile or the rest of the METAENGINE repository.

## Interaction

The upper region is the lesson; the lower region prepares work with a regular ChatGPT conversation. The separator supports pointer and keyboard resizing. Right notebook/settings panel is hidden on startup. Each topic has independent notes, draft, optional ChatGPT conversation link, reading mark, images and manual page revisions. Reading marks are not assessment or competence certificates.

ChatGPT opens in a separate ordinary browser tab; a lesson-specific prompt is copied only after a deliberate click. The learner pastes and sends it in ChatGPT. Model availability and selection are not verified by this site. It does not use API billing, scrape answers, proxy authentication, embed ChatGPT in an iframe, or claim automatic chat-to-page synchronization. The current OpenAI sign-in/partner integrations are a separate configuration decision, not activated here.

Students can request a JSON lesson patch, paste it into the site, inspect changed fields, explicitly apply it and undo it. Only bounded plain text and declarative local modules are supported; no generated HTML/JS/CSS executes. Imported PNG/JPEG images are dimension checked before decoding, reduced to at most 1600px and stored locally. Quizzes and calculations are learning aids, not professional certification.

## Personal data

IndexedDB stores personal data **inside this browser and website origin**. There is no cloud account/sync. Preview domains, localhost, other browsers and devices each have separate data. Download a backup before changing the site address or clearing browser data. The service worker caches only trusted public site assets for offline reading after an initial load, never external conversations. No analytics or third-party fonts/scripts are used.

Use Settings → Import to restore this website's JSON backup or `education-state.json` from the desktop application. Material-keyed notebook records and notebooks linked by the old tab→material relation are mapped to topics. Unmatched and old module-level notes are retained as archive records and included in exports, not silently deleted. Legacy attempt/review/lab records are retained for export, but the new reading indicator does not reclassify them as qualified skills. Old desktop live-state revisions, image asset folders, native browser sessions and cookies are not migrated by this first import. API key/config files are rejected.

Imports replace only this website's local journal after a preview and confirmation; a backup of the previous journal is downloaded first. Tests cover parsing, stale revisions, literal text, cross-topic isolation and transaction validation. Do not import private journals into the Git repository or deployment files.

## Provenance

Catalog authored-source snapshot: `6faae4ed1760f325ed3d900ca38e06c03d877cb5` (curriculum retained through desktop E10). No credentials, device account details, or personal notes are bundled.
