// Canonical R81→R90 convergence roadmap (from the R80 cross-audit, 2026-09-26).
// Release authority verified live via Supabase development_plane read model.
export const RELEASE_AUTHORITY = {
  repository: "PatrickFrome/Compute",
  release_ref: "release/self-update-ambiguity-live-v2",
  release_sha: "cf747798a285f113ac3ae1563da4be8bd4e56705",
  verified_via: "supabase:compute_fabric_a2_browser_supervisor_state_h205f22.development_plane.devos_repo_read_model",
} as const;

export const DONOR_AUTHORITIES = {
  historical_me2_worklog: { ref: "sandbox/me2-os", sha: "56ba1b87e71d0e95c1adb8a2c4e5640629d4cfd8", relation: "UNRELATED_HISTORY" },
  desktop_donor: { ref: "work/desktop-web-conversation-integration-v1", sha: "7495ce9f4a7f5acfb54ce1e7d8c8a3a12a958e61", behind_release: 21, ahead: 7 },
  desktop_base: { ref: "me2/r78-desktop-from-scratch", sha: "8cf09ad", ahead: 2 },
} as const;

export interface RoadmapItem {
  round: string;
  title: string;
  goal: string;
  exit_gate: string;
  status: "IN_PROGRESS" | "PENDING";
  evidence?: string;
}

export const ROADMAP: RoadmapItem[] = [
  {
    round: "R81",
    title: "AUTHORITY FREEZE",
    goal: "Одна доказанная source topology: convergence-ветка от exact release, классификация всех веток, ротация утёкших credentials.",
    exit_gate: "Все remote heads классифицированы; unrelated history поддерживается аудитором; секретов в source/capsules нет.",
    status: "IN_PROGRESS",
    evidence: "621/621 heads классифицированы (read-only-lineage-audit SUCCESS @ 5a1c6178); UNRELATED_HISTORY поддержан; PR #968 draft/mergeable; осталось: ротация credentials (оператор).",
  },
  {
    round: "R82",
    title: "SUPERVISOR LIVENESS",
    goal: "Закрыть P0: deterministic composer resolver, устранить supervisor_composer_not_unique и residual maintenance starvation.",
    exit_gate: "cycle_seq монотонно растёт; wake→effect→readback; нет maintenance timeout; restart не ломает цикл.",
    status: "IN_PROGRESS",
    evidence: "LIVE-ДИАГНОЗ ЗАВЕРШЁН (2026-09-26, через command fastlane): runtime .36089462649.1 = release head cf747798 (посылка R80-аудита «старый код» ОПРОВЕРГНУТА). Полная причинная цепочка: capped conversation → отравленный account-draft 28.7k chars (растёт от каждой попытки) + blank-zombie tabs (navigation deadline) + atomic-save race. Фиксы: PR #981 (root-draft canary, blank-tab commit proof + close-by-proof, unique-tmp writeJson; 3 новых теста + 39 смежных зелёные). MERGED: PR #981 влит в release (head e7fccd08, CI 8/8 SUCCESS) — verified-dev-release rail опубликовал манифест; SELF_UPDATE LANDED live: runtime .36228915117.1 (dev_plane = e7fccd08, milestone #298/#316). CANARY АКТИВЕН: rollover_reason = ROOT_DRAFT_OVERSIZED — драфт больше НЕ растёт от попыток. Операторское действие остаётся: однократная ручная очистка драфта на chat.z.ai (Ctrl+A+Delete в new-chat композере). HARDENING (2026-09-26, 0.64.0): milestone-дедупликация перенесена в durable event log (рестарт демона больше не дублирует события); oppo-сэмплер ловит свежие rollover-табы в момент старта (periodic 5-мин гнался за короткоживущими табами); draftCleared стал историческим фактом (sticky); CYCLE_GROWTH live-data-first (текущий cycle_seq > baseline = доказательство); R82_DRAFT_CLEARED доопределяется из роста cycle_seq (успешный rollover требует чистого драфта).",
  },
  {
    round: "R83",
    title: "EDGE CONVERGENCE",
    goal: "Repo == deployed backend: квалифицировать v14 canary, Postgres NOTIFY, result receipt, emergency routes, controlled promotion.",
    exit_gate: "production Edge digest/source binding соответствует candidate; signed E2E + rollback PASS.",
    status: "IN_PROGRESS",
    evidence: "LIVE-КВАЛИФИКАЦИЯ (2026-09-26, CF API read-only): 3 workers @ metaengine-d9186d31.workers.dev. ФАЙНДИНГ: 2/2 registry workers (fabric-worker-h205f21r4 v15 dispatch gateway; h205f22-aop1 v64 операторный DO + SUPABASE_SERVICE_ROLE_KEY + GitHub writes) БЕЗ source-of-truth в репо (маркеры отсутствуют в main/release 4471/donor 1627). Живые скрипты сняты в evidence (data/edge/ + EDGE_SNAPSHOT). ИМПОРТ РЕАЛИЗОВАН (2026-09-26): PR #982 (work/r83-edge-source-import-v1 @ ad5e01c6c1 → release, 23 файлов +4631/−0 под edge/, Git Data API без force-push) — fabric 7/7 модулей VERBATIM (byte-идентичны live v15, normalized digest 9c55419e37b04d41); aop1 VERBATIM-бандл 95,200 bytes (digest 29b36254b0b4cb4f, wrangler main → bundle/index.js) + 8 recovered-сечений // src/* для ревью; wrangler.jsonc из live settings (DO ComputeFabricSupervisor, workflows, queues, vars; секреты ТОЛЬКО именами в secrets_hint — значений в репо нет); PROVENANCE.json digest-binding + tools/verify-digests.mjs (promotion gate: cd edge && node tools/verify-digests.mjs → == LIVE для обоих). Digest-контракт верифицирован дважды: на сборке и на испущённом дереве. Статус трекается live (edge.import-status). Промоушн (deploy-from-repo) по-прежнему заблокирован до: ревью оператора + re-verify + ротации CF-токена. СРОК ЗАКРЫТИЯ: merge PR #982 под ревью оператора. EVIDENCE-MIRROR РЕАЛИЗОВАН (2026-09-26, 0.66.0): auto-mirror событий daemon → me2_event_mirror_h205f22 — контракт me2-mirror-v1 (продолжение seq-пространства якоря #90013992, payload = {mirror, local_seq, local_hash, event} как jsonb string-scalar, hash-формула документирована и верифицируема от readback, fail-closed reconcile против живого tail, батчи 100/запрос, анти-каскад MIRROR_SYNC ≥5) — durable evidence больше не требует ручной anchor-записи оператором.",
  },
  {
    round: "R84",
    title: "DESKTOP CONVERGENCE",
    goal: "Семантический перенос desktop donor (me2/r78 ×2 + PR #967 ×5) на current release base; связать WebContentsView с canonical BrowserCell/CDP identity.",
    exit_gate: "native conversation UI использует ту же tab/target/generation authority, что execution kernel.",
    status: "PENDING",
  },
  {
    round: "R85",
    title: "SINGLE INSTALLED RUNTIME",
    goal: "Installer бандлит me2-daemon + runtime; один lifecycle owner; version unification (0.57.1 vs 0.43.0 устранён).",
    exit_gate: "clean Windows без Bun/Node/dev tools запускает весь runtime.",
    status: "IN_PROGRESS",
    evidence: "R85-волна (18 коммитов, 06:41–06:51Z): standalone daemon payload/staging, unify package/runtime versions @ 7ca55f7e, BOM-free manifest, platform-safe data path, parse-safe PowerShell staging, packaged daemon survives self-update; CI re-qualifying @ 2c28aa85.",
  },
  {
    round: "R86",
    title: "AUTONOMOUS CLOSED LOOP",
    goal: "roadmap → task → lease → agent → verified submit → readback → accepted result → next task без AMBIGUOUS/TTL тупиков.",
    exit_gate: "fresh multi-agent tasks заканчиваются verified results.",
    status: "PENDING",
  },
  {
    round: "R87",
    title: "BRAIN / MEMORY / RSI",
    goal: "Cognitive cursor convergence (RESYNC_REQUIRED закрыт), bounded durable memory, selective salvage RSI PR.",
    exit_gate: "local delta frontier ↔ accepted cloud cursor сходятся измеримо; restart retains memory.",
    status: "PENDING",
  },
  {
    round: "R88",
    title: "RESILIENCE / UPDATE",
    goal: "Crash/restart/outage tolerance: Browser, Compute, Supervisor, daemon, Supabase, Sentinel; N→N+1 self-update + rollback.",
    exit_gate: "после каждой fault-class useful closed loop восстанавливается без blind retry.",
    status: "PENDING",
  },
  {
    round: "R89",
    title: "RELEASE QUALIFICATION",
    goal: "Испытывать именно установленный продукт: exact-SHA CI, packaged-runtime E2E, clean install, upgrade, chaos, long soak.",
    exit_gate: "все mandatory gates terminal PASS на одном неизменном SHA.",
    status: "PENDING",
  },
  {
    round: "R90",
    title: "RELEASE SEAL",
    goal: "Freeze source, installer hash/SBOM/provenance, release manifest, post-install smoke.",
    exit_gate: "TESTED ARTIFACT == RELEASED ARTIFACT; после seal ни одного release-relevant change.",
    status: "PENDING",
  },
];

// Verified remote evidence (R81-PHASE1, GitHub API readback 2026-09-26 ~06:55Z).
// Источник: api.github.com check-runs для указанных SHA — не пересказ оператора.
export const CONVERGENCE_EVIDENCE = {
  verified_at: "2026-09-26T06:55:00Z",
  branch: "work/r81-browser-release-convergence-v1",
  pr: 968,
  release_base: "cf747798a285f113ac3ae1563da4be8bd4e56705",
  sha_5a1c6178: {
    sha: "5a1c6178a1212e8f1d4b50606ff1c0c4c3e71ad4",
    checks_total: 32,
    result: "31 SUCCESS + 1 cancelled",
    gates_closed: [
      "windows-nsis-package-smoke",
      "installed-ui-72-activation-race-soak",
      "windows-installed-chat-qualification",
      "windows-final-runtime-activation",
      "read-only-lineage-audit (621/621 heads)",
      "brain-endurance-1m-128-cells-128-agents",
      "fleet-scale-2000-tasks-2048-peers",
      "continuous-brain-100k",
      "fleet-chaos-seed ×8",
    ],
    cancelled: ["windows-published-n-to-one-build-target (срезан следующей волной коммитов — нужен повторный терминальный прогон)"],
  },
  r85_wave: {
    commits: 18,
    span: "2026-09-26T06:41Z…06:51Z",
    head: "2c28aa85f16ccee094efd5e45146b042a5895b9d",
    themes: [
      "standalone daemon payload + staging + fenced scheduler",
      "unify ME2 daemon package and runtime versions",
      "BOM-free UTF-8 manifest, platform-safe data path, parse-safe PowerShell staging",
      "packaged daemon survives exact physical self-update",
      "daemon data/lifecycle bound to Browser profile",
    ],
    ci: "re-qualifying (25 checks queued/in_progress на момент проверки)",
  },
  live_runtime_gap:
    "installed Browser ROLLOVER_AMBIGUOUS (cycle 2109, >57h). ДИАГНОЗ ЗАВЕРШЁН 2026-09-26: (1) установленная сборка = release head cf747798 — это НЕ старый код; (2) корневая причина — отравленный account-draft на root-поверхности (28.7k chars, синтетически неочищаемый: клавиши игнорируются, Enter отказывает, 'New Chat' сохраняет драфт, send-кнопка nameless) + blank-zombie tabs от navigation deadline + atomic-save race. Фикс: PR #981; разблокировка: однократная ручная очистка драфта оператором.",
  r82_exit_gate: {
    built: "2026-09-26T08:20:00Z",
    mechanism: "daemon /readback + консольная карточка R82 EXIT GATE: детерминированная stage-машина (RELEASE_CI → MANIFEST → SELF_UPDATE → CANARY → OPERATOR_CLEAR → CYCLE_GROWTH → R82_CLOSED), каждая стадия верифицируется против живых данных",
    baselines: { extension_version: "0.7.0-dev.36089462649.1", dev_plane_head: "cf747798", merge_head: "e7fccd08", cycle_seq: 2109 },
    draft_sampler: "READ-ONLY CAPTURE: периодический 5 мин (ring buffer 48 сэмплов = 4h) + R82-HARDEN oppo-сэмплер (монитор детектирует новый rollover_attempt → мгновенная проба живого attempt-таба, rate-limit 60s); milestone-события R82_DRAFT_CLEARED / R82_SELF_UPDATE_LANDED / R82_CYCLE_RESUMED пишутся в hash-chain однократно ЗА ВСЁ ВРЕМЯ (дедуп — сам durable log, рестарт-безопасно)",
    live_at_build: "release CI на e7fccd08: 34/38 success, 4 in_progress (publish-exact-verified-target PENDING); runtime = baseline (self-update ещё не подхвачен)",
  },
  mirror_contract: {
    built: "2026-09-26T09:30:00Z",
    module: "daemon src/mirror.ts (R83-MIRROR, 0.66.0)",
    table: "me2_event_mirror_h205f22",
    marker: "me2-mirror-v1",
    chain: "продолжение seq-пространства recovery-якоря #90013992 (v0.57.1 tail): первая строка = 90013993 с prev_hash = anchor.hash — один непрерывный ledger через разрыв поколений daemon",
    payload: "jsonb string-scalar {mirror, local_seq, local_hash, event} — byte-exact readback (донорская конвенция v0.57.1)",
    hash: "sha256(JSON.stringify({seq, ts-canonical, type, actor, subject, payload, prev_hash, daemon_version})) — те же поля, что local eventHash; ts каноникализуется Date→toISOString — переживает timestamptz round-trip",
    cross_binding: "payload.local_seq + payload.local_hash ↔ локальная цепь: local_hash уже криптографически коммитит payload события, mirror-верификатору не нужно пере-сериализовывать jsonb",
    fail_closed: "расхождение живого tail со state (foreign rows / hash mismatch / truncation) → sync отказывается писать, требует ручного reconcile оператора",
    cadence: "boot через 15s + таймер 120s + operator POST /mirror/sync; single-flight; state cursor обновляется после каждого подтверждённого батча",
  },
} as const;

export const RECOVERY_STATUS = {
  env_reset_detected: true,
  detected_at: "2026-09-26T06:20:00Z",
  restored: [
    { item: "secrets /home/z/.a2/supabase-cloud.env", state: "RESTORED" },
    { item: "secrets /home/z/.a2/cloudflare.env", state: "RESTORED" },
    { item: "secrets /home/z/.a2/supervisor.env", state: "RESTORED" },
    { item: "secrets /home/z/.a2/.github.env (GITHUB_TOKEN_ADMIN, PAT)", state: "RESTORED" },
    { item: "me2-daemon REST :3041 + WS :3040", state: "REBUILT" },
    { item: "hash-chained event log (anchor: mirror seq 90013992)", state: "REBUILT" },
    { item: "Mission Control console (src/app/page.tsx)", state: "REBUILT" },
    { item: "Supabase control-plane live readback", state: "VERIFIED" },
    { item: "donor action manifest: 57 действий (4 lanes) из sandbox/me2-os @ 56ba1b87", state: "RECOVERED" },
    { item: "branch audit gate: 621/621 heads, read-only-lineage-audit SUCCESS @ 5a1c6178", state: "VERIFIED" },
    { item: "git push main:sandbox/me2-os (donor history сохранён merge -s ours)", state: "RESTORED" },
  ],
  blocked: [
    { item: "credentials rotation (P0 security)", reason: "raw credentials в chat export; ротация — только у оператора" },
  ],
  pending_next: [
    "R82-verify: live readback self-update (runtime версия сменится с 0.7.0-dev.36089462649.1 на новый digest; cycle_seq рост после очистки драфта оператором; ROOT_DRAFT_OVERSIZED в rollover_reason пока драфт не очищен)",
    "R83-merge: PR #982 (source-import) под ревью оператора → merge закрывает импорт-фазу; после — controlled promotion (deploy-from-repo) с re-verify digest + ротацией CF-токена",
    "полный donor bus (57 действий): реализация вместе с Browser control plane (R84–R86)",
  ],
} as const;
