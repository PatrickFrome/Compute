# metaengine-h205f22-aop1 (operator authority worker)

Live worker v64 (compat 2026-08-21, observability on). The live script is a
**single esbuild bundle** — the original per-module TypeScript source was lost
before this import, so this directory imports the bytes that production
actually runs:

- `bundle/index.js` — verbatim live module (95,380 bytes). `wrangler.jsonc`
  `main` points here: a repo deploy equals live bytes exactly.
- `recovered/00-preamble.js` — esbuild runtime helpers + hoisted imports
  (`__defProp`, `__name`, `cloudflare:workers` import).
- `recovered/src-*.ts` — verbatim `// src/*` section slices of the bundle
  (`supabase`, `github`, `executor`, `duel_microstep`, `peer_relay_v4`,
  `duel_db_wake`, and `index` — the entry, which esbuild emits last).
  These are **review artifacts**: readable, greppable, diffable — but not
  standalone-valid modules (they share the bundle scope).

Bindings (from live settings): DO `AOP_SUPERVISOR` → class
`ComputeFabricSupervisor`; workflow `AOP_RUN_WORKFLOW` → class
`AopRunWorkflow` (name `metaengine-h205f22-aop-run`); queue producer
`AOP_WAKE_QUEUE` → `metaengine-h205f22-aop-wake`; vars `AOP_MODEL`,
`DUEL_MAX_OUTPUT_TOKENS`, `SUPABASE_URL`; six `secret_text` bindings listed
in `wrangler.jsonc` (`secrets_hint`).

Reconstruction of true per-module source (with real imports/exports) is a
follow-up under operator review — until then the bundle IS the source of
truth, digest-bound to live `29b36254b0b4cb4f`.
