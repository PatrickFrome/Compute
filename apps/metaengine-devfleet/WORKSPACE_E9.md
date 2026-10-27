# Education E9 — lesson workspace and dynamic modules

## Workspace
The lesson screen has two permanent vertically stacked regions: a scrollable lesson reader above and a topic-bound direct GPT chat below. Drag the divider or use its arrow keys; Home resets its height. The left course tree has topic search, collapses inactive topic lists, and moves legacy browser controls behind a disclosure. The right drawer starts **closed on every launch/reload** and opens only through Notebook, Progress, Settings or the related chat buttons. Escape closes it and returns focus.

The bottom chat inherits E8's separate topic histories, drafts, revision checks, no-blind-retry policy, local persistence and optional notebook context. Topic selection alone does not make a model call. Ctrl+Enter submits the current draft. Prompt shortcuts only fill the composer; they do not send. Selected text in the upper reader can be brought into a question.

## Dynamic modules
In addition to E8's five editable text fields, the official Responses JSON schema accepts bounded `block_ops`. Supported kinds: text, callout, formula, checklist, table, quiz, diagram, image, and ohm_lab. These are reviewed local components with data, **not arbitrary generated JavaScript/HTML plug-ins**. Diagram nodes/edges are rendered with native SVG primitives, not a model SVG string. Tables and quizzes use DOM/textContent. The Ohm-law component is a virtual ideal-resistor calculation restricted to 0–24 V and 1–1,000,000 ohms; it is not an instruction to construct a physical circuit.

An answer can add/update/remove/reorder blocks. Up to 20 blocks per lesson, 12 operations per response, bounded node/row/text counts and total page size. Only the current topic can change. Module and text changes are committed together after expected-revision comparison and validation. Undo restores both, without deleting chat history. Old E8 journals acquire empty `blocks`/`before_blocks` fields additively. Model-generated questions and answer keys are explicitly unverified and never grant professional competence or silently alter assessment scores.

## Images
The student imports PNG/JPEG through the native OS file picker. Header dimensions and an 8 MiB bound are checked before native decoding; images are limited to 16 million pixels, normalized/downscaled to at most 2048×2048 PNG, and stored by SHA256 in the app's private profile. At most 12 registered images per topic. The renderer and model never choose disk paths or URLs. An image block references only an asset ID registered to that topic; reads verify ownership and file digest.

The model receives image **metadata only** (asset ID, title, dimensions), not pixels. It can embed an existing imported image and choose its caption but must not claim to have visually inspected it. This version does **not** generate photorealistic raster images or browse/download arbitrary illustrations. It can create diagrams from approved node/edge data. Student imports and model-generated modules remain different provenance classes.

## Verification
- Full standalone Node tests: 182 passing (170 existing + 12 module/asset tests).
- E8 production live-chat Electron smoke: passing with deterministic provider, no real API calls.
- New `scripts/education-workspace-smoke.cjs`: real Electron 44, production IPC/store/transport and deterministic Responses envelope. It checks upper/lower geometry at 980×760, 1366×768 and 1480×960; default-hidden drawer, open/Escape/reload behavior, keyboard divider, topic search, delayed-topic isolation, 5 rendered module kinds, actual PNG decoding, calculator and quiz interaction, atomic text+module Undo, durable reopening and disconnect.
- The native image fixture is test-only and uses the production asset store. Native file-picker selection is not automated by the smoke.
- Screenshots inspected from the disposable smoke profile; mock responses are labeled as test outputs.

Run `npm test`, `npm run smoke:education`, `npm run smoke:education-live`, and `npm run smoke:education-workspace` after installing the pinned dependencies. In local development the already-qualified pinned Electron executable may launch the same scripts from an isolated worktree. No paid API requests, production profile changes, real-account login, signed installer or model-specific structured-output compatibility are claimed by these tests.

## Remaining acceptance
Live account/model compatibility and teaching quality require the student's configured API connection and an explicitly submitted request. The E9 preview is separate from E7/E8 installations; copied learning journals are snapshots, not bidirectional profile synchronization. Legacy embedded ChatGPT is a fallback and does not gain authority to change lessons. Its native viewport is constrained to the upper reader rather than covering the bottom tutor or controls.
