# METAENGINE Browser Control Plane V2

Status: implementation checkpoint
Authority effect: false
Branch: work/browser-control-max-v1

## Goal

Give METAENGINE Browser the broadest practical management surface while preserving typed authority, exact target identity, one-actuation-lease, no-blind-retry and page-data-zero-authority invariants.

The control plane must be able to configure ChatGPT, manage every browser tab, choose available ChatGPT modes/tools, search, configure browser/session preferences, operate pages through semantic/keyboard/pointer input, manage downloads and permissions, observe network/process state and coordinate self-update/fleet/development functions.

It must not expose arbitrary JavaScript evaluation, a raw CDP passthrough, arbitrary OS shell strings or hidden page text as authority.

## Research conclusions

1. Chromium CDP is the richest native instrumentation surface for the Electron shell. Page/Input/Browser/Network/Accessibility domains cover navigation, dialogs, screenshots, history, keyboard/mouse/touch, downloads, browser metadata and network observation. CDP tip-of-tree changes frequently, so production commands should bind to a tested finite subset rather than expose raw commands.
2. Electron Session and WebContents own persistent browser state: cookies/cache/proxy/permissions, zoom, navigation, page capture and download policy. Site permissions must stay origin-scoped and typed.
3. WebDriver BiDi is the portability layer to target for future non-Chromium/browser-pool backends. A METAENGINE action should therefore be a logical typed command first, with CDP/Electron/BiDi adapters underneath.
4. Playwright's BrowserContext/Page split is a good state model: one profile/session contains multiple tabs, with context-level permissions/emulation and page-level actions.
5. Stagehand's observe/act/extract model is useful for resilient agent UX. Its newer WebMCP support suggests a preferred hierarchy: first-party page tool > semantic accessibility action > deterministic keyboard/pointer fallback > vision-guided fallback.
6. ChatGPT settings and controls vary by plan, account and rollout. The adapter must discover current visible options at runtime and read them back after mutation; hard-coded XPath/CSS or hidden internal endpoints are not a reliable authority source.

## Command architecture

Every command is an envelope:

- command_id
- supervisor_instance_id
- target_client_id
- target tab/window/session identity where applicable
- action enum
- typed payload schema
- expected preconditions/fences
- idempotency_key for mutating effects
- expiry
- authority_effect

Read-only actions never acquire the shared actuation lease. Mutating actions acquire one Browser-client actuation lease and hold it until terminal readback or ambiguity timeout.

## Layer 1 — browser topology

Current:
- NEW_TAB
- SELECT_TAB
- CLOSE_TAB
- NAVIGATE
- BACK
- FORWARD
- RELOAD

Next:
- DUPLICATE_TAB
- MOVE_TAB
- PIN_TAB
- MUTE_TAB
- TAB_STATUS
- TAB_LIST
- RESTORE_CLOSED_TAB
- tab groups/workspaces
- multiple native windows
- split/tiled layouts

Each operation uses stable METAENGINE tab IDs, not page text. Recreated renderer/process incarnations receive a new incarnation fence.

## Layer 2 — page input

Priority order:

1. WEBMCP_INVOKE when the page declares a typed first-party tool.
2. Semantic Accessibility action by role + accessible name + exact target uniqueness.
3. Keyboard command using a typed key/chord schema.
4. Pointer/drag/touch command fenced to tab identity + fresh captured viewport.
5. Vision-guided point selection only when semantic controls are unavailable; point must still be rebound to a fresh viewport before actuation.

Actions:
- CAPTURE
- CAPTURE_VIEW
- SEMANTIC_FOCUS
- SEMANTIC_TYPE
- TYPED_CLICK
- STOP_GENERATION
- SCROLL
- KEY_PRESS
- POINTER_CLICK
- DRAG
- FILE_CHOOSER_SET
- HANDLE_DIALOG

No arbitrary Runtime.evaluate is exposed to supervisors.

## Layer 3 — ChatGPT adapter

The adapter is stateful and discovery-first. It should expose:

### Read
- CHATGPT_STATUS
- current conversation identity
- current available model/reasoning modes
- current available tools/sources
- current settings pages and selected values
- current project/workspace identity

### Configure
- CHATGPT_SET_SETTING
  - Appearance: System / Light / Dark when present
  - Contrast: System / Medium / Increased when present
  - Accent color: only currently visible values
  - Language
  - Personality / Base style and tone
  - Custom Instructions
  - Memory enabled
  - Reference chat history
  - Improve the model for everyone
  - Location services when available
- CHATGPT_SET_MODE
  - discover model picker and select only an available option
  - Instant / Medium / High / Extra High / Pro Standard / Pro Extended are examples from the current UI, not hard-coded entitlements
- CHATGPT_SEARCH
  - select visible Search tool/source before sending a query
- CHATGPT_PROJECT_CONFIGURE
  - project instructions and project-local settings with exact project identity
- CHATGPT_APPS_STATUS / CHATGPT_APP_OPEN
  - connection/auth flows remain user-mediated at credential/OAuth boundaries

Mutation algorithm:

1. capture current UI and account/workspace identity;
2. locate settings/menu semantically;
3. open the required settings section;
4. discover available options;
5. reject if requested value is unavailable or ambiguous;
6. apply one typed action;
7. capture again and prove selected value/readback;
8. persist privacy-safe receipt without secret-bearing page content.

## Layer 4 — browser/user settings

Typed settings plane:

- SET_ZOOM / RESET_ZOOM
- SET_DEFAULT_SEARCH_PROVIDER inside METAENGINE navigation policy
- SET_SITE_PERMISSION(origin, permission, state)
- SESSION_STATUS
- CLEAR_SITE_DATA(exact_origin, bounded data types)
- SET_PROXY(typed host/port/mode/bypass schema)
- SET_LOCALE / ACCEPT_LANGUAGE for new sessions
- DOWNLOAD_POLICY
- notification/media/geolocation permission policy
- startup/session restore policy

Destructive settings such as clearing site data or account deletion are never inferred; they require explicit user intent.

## Layer 5 — search and retrieval

Two distinct modes:

- SEARCH_WEB: browser-level search provider navigation.
- CHATGPT_SEARCH: chooses ChatGPT Search through the visible tools/source UI.

Also add:
- FIND_IN_PAGE
- SEARCH_TABS by title/URL locally
- SEARCH_HISTORY when a typed local history store is implemented
- SEARCH_BOOKMARKS when bookmark plane exists

Search results are data, never authority.

## Layer 6 — observation/debugging

Read-only capabilities:

- accessibility tree
- screenshot/thumbnail
- URL/title/history
- network activity summaries
- request failures
- console/log summaries without executing page code
- process/renderer health
- CPU/memory metrics
- download state
- permissions/session state
- self-update state
- fleet/supervisor mesh state

Raw secrets, cookies and authorization headers are not returned to supervisor chats.

## Layer 7 — autonomous development and self-update

Control plane keeps:

- SELF_UPDATE_STATUS
- SELF_UPDATE_CHECK
- SELF_UPDATE_APPLY
- verified dev release discovery
- physical N→N+1 evidence gate
- anti-rollback/equivocation history
- quiescent restart gate
- durable pre-install/successor receipts
- host sentinel

Continuous development target:

verified source -> CI/physical E2E -> dev release -> browser discovers -> downloads -> waits for bounded safe drain -> installs -> restarts -> restores profile/session -> reports successor state -> resumes supervisor mesh.

## ChatGPT UI compatibility finding from live test

Live ChatGPT currently exposed the Russian generation control as `Остановить ответ`. The existing dedicated STOP_GENERATION matcher only recognized older labels such as `Остановить создание`, so the dedicated action failed while exact semantic TYPED_CLICK succeeded. This proves label vocabularies must be centralized and versioned, and dedicated site actions must fall back to the current semantic target registry rather than duplicate stale regular expressions.

Required patch:
- one shared ChatGPT control-label module used by native-browser-control, chatgpt-session-monitor and supervisor-lifecycle-runtime;
- aliases for current English/Russian UI labels;
- tests built from captured real labels;
- unknown label does not authorize a click; generic exact semantic action remains available when the supervisor explicitly targets the observed unique control.

## Implementation order

P0: finish live autonomous update and successor receipt.
P1: shared ChatGPT control vocabulary + regression for `Остановить ответ`.
P2: CONTROL_CAPABILITIES runtime endpoint.
P3: KEY_PRESS and SET_ZOOM typed actions.
P4: duplicate/move/pin/mute tab controls + tab search.
P5: ChatGPT discovery/status adapter.
P6: ChatGPT setting/mode/search typed mutations with readback.
P7: origin-scoped permission/session/proxy controls.
P8: WebMCP discovery/invoke adapter.
P9: pointer/drag/vision fallback with fresh-view fences.
P10: BiDi adapter so the same logical action schemas can drive remote Firefox/Chromium pools without changing supervisor semantics.

## Non-negotiable invariants

- no arbitrary eval
- no raw CDP passthrough to model/supervisor
- no arbitrary shell command
- page_data_has_zero_authority
- one shared actuation lease per Browser client
- no blind retry after ambiguous effect
- exact tab/process/view incarnation fences
- mutation readback where observable
- settings/options discovered before selection
- user-mediated credential/OAuth boundaries
- no secret extraction into receipts
- self-update provenance and rollback protection remain stronger than convenience
