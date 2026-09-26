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
  r83_watch: {
    built: "2026-09-26T10:15:00Z",
    module: "daemon src/mirror.ts stats_24h + консоль (0.67.0-r83watch)",
    mirror_stats_24h: "GET /mirror → stats_24h: DB-side агрегат прямо из PostgREST (select seq,type,ts — БЕЗ payload) за 24ч-окно по mirrored_at: rows / seq-диапазон / старейшая-свежайшая / top-8 типов; TTL 120s; live-проверка на старте: 421 строка #90013993…#90014413 (BUS_CLIENT_CONNECTED 176, DAEMON_BOOT 124, SANDBOX_EXEC 87)",
    console_draft_timeline: "полноценный timeline драфта из durable 24h-истории: canary-состояние кодируется цветом (rose=OVERSIZED / emerald=OK), провалы проб = разрывы (connectNulls=false — провал никогда не фейкает значение), порог 4000 — пунктир, downsample >140 точек с bucket-max (уровень отравления не усредняется); rose→emerald переход = живое доказательство очистки драфта оператором",
    mirror_auto_alert: "консоль: авто-тост + звук при переходе mirror state (null→error = destructive; true→false matches_state = destructive «live tail ≠ state»; восстановление = informative) — расхождение pipeline'а evidence больше не прячется в чипе карточки",
    audio_cues: "WebAudio-сигналы (без ассетов): 'gate' при смене current_gate exit-gate, 'milestone' на milestone-события hash-chain, 'alert' на mirror-расхождение; mute-тоггл в хедере (persist localStorage), скрытая вкладка не звучит",
    donor_keyboard: "Alt+1–5 — lane-фильтры донор-браузера (все/RO/TAB/GM/EMG), Alt+D — фокус поиска; дополняет '/' журнала событий",
  },
  r83_verify: {
    built: "2026-09-26T10:30:00Z",
    module: "daemon src/mirror.ts mirrorVerify + консоль (0.68.0-r83verify)",
    in_process_verifier: "POST /mirror/verify — порт verify-mirror.mjs ВНУТРИ демона: читает ВСЕ строки paged ascending от якоря и проверяет 4 проверки (seq-непрерывность от #90013992+1 / prev_hash-цепь до anchor.hash / пересчёт row-hash по документированной формуле / кросс-биндинги payload.local_seq+local_hash ↔ локальная цепь: hash+type/actor/subject+payload+ts); single-flight, cap 20k строк; ПРОГОН ПИШЕТСЯ в hash-chain как MIRROR_VERIFY (ok/rows/duration/violations) — оператору не нужен shell",
    live_first_run: "448 строк, 0 нарушений, все 4 проверки OK, 728ms, хвост #90014440 — контракт держит (совпадает с внешним verify-mirror.mjs)",
    last_verify_surface: "GET /mirror → last_verify (из journal) + readback draft.cleared_at (journal milestone ts) — консоль рендерит «последняя проверка» и marker на timeline",
    console_verify_panel: "кнопка «проверить контракт» (emerald) в Mirror-карточке + результат-панель: 4 чек-строки с ✓/✗ (seq-непрерывность / prev_hash-цепь / hash-пересчёт / кросс-биндинги с подсказками формулы), rows/head/duration chips, samples нарушений; «последняя проверка» из journal когда панель свёрнута",
    draft_milestone_marker: "DraftTimeline: вертикальная emerald ReferenceLine «драфт очищен» на первом сэмпле ≥ journal-cleared_at (категориальная ось — точный category-hit; edge-cases: до всех сэмплов → левый край, после всех → правый)",
    sound_levels: "3 уровня громкости (тихо 0.018 / средне 0.045 / громко 0.09) — кнопка ◦/◦◦/◦◦◦ в хедере рядом с bell, persist localStorage 'me2-sound-level', пробный сигнал milestone при переключении",
    event_class_chips: "журнал событий: class-фильтры milestone/evidence/lifecycle/ops (multi-select, живые счётчики, комбинируются с текстовым фильтром через AND, кнопка × классы для сброса)",
  },
  r83_autonomy: {
    built: "2026-09-26T11:00:00Z",
    module: "daemon src/mirror.ts auto-verify + src/report.ts + консоль (0.69.0-r83autonomy)",
    auto_verify_6h: "тихая само-проверка контракта каждые 6 ч: расписание выводится из durable journal (последний MIRROR_VERIFY), не из памяти — рестарт подхватывает отсчёт; защита от осиротевших поколений bun --hot: таймерный прогон отказывается исполняться, если в journal верификация свежеe interval−5 мин; payload.trigger различает operator/timer — консоль тостит только operator-прогоны",
    r82_report: "GET /r82/report (+ action r82.report) — before/after diff-отчёт R82: отравленный baseline (живоверифицирован при диагностике: ROLLOVER_AMBIGUOUS · TYPE_EFFECT_AMBIGUOUS · cycle 2109 · stale >31ч · драфт 28 432 chars · resync ~2.3k) против live сейчас, метрика-за-метрикой (8 метрик со статусами improved/pending/same) + timeline ключевых моментов из durable источников (journal milestones + GitHub completed_at); заполняется по мере схождения gate — материал release-готовности R89",
    publish_manifest_at: "releaseCi теперь несёт publish_manifest_completed_at (check-runs completed_at) — момент публикации self-update rail виден в timeline отчёта",
    cycle_resumed_at: "readback cycle.resumed_at (journal milestone ts) — консоль рендерит второй маркер на timeline драфта («cycle растёт»)",
    console_polish: "донор-браузер: per-lane лимит 8 + «показать ещё N» (limit при полном списке); Esc очищает+блерит донорский поиск (паритет с журнальным фильтром); sound-unlock при первом жесте (AudioContext.resume — первый сигнал больше не проглатывается); Mirror-карточка: чипы авто-проверки (последняя · следующая)",
  },
  r88_resilience_live: {
    built: "2026-09-26T14:10:00Z",
    module: "daemon src/planes.ts + /planes route + консоль (0.70.0-r88resilience)",
    incident: "env-reset #2 (2026-09-26T13:42Z, live): /home/z/.a2/ уничтожен вторично (первый — R81-PHASE0); уцелели source-tree (git), daemon, консоль, donor-реестр, песочница, worktrees; потеряны ВСЕ credential-плоскости + root data/ (edge-снапшоты — источник жив в PR #982) + локальная hash-chain (500+ событий — выжила в Supabase mirror #90013993..#90014496+, потому и строилась)",
    planes_module: "credential-plane liveness как first-class: planesStatus() проверяет СУЩЕСТВОВАНИЕ файлов + имена ключей (значения никогда не читаются/не логируются/не возвращаются); envResetState(): ≥2 missing = suspected env-reset (файлы предоставляются вместе — потеря одного = действие оператора, потеря двух+ = reset)",
    surfaces: "/health несёт planes+env_reset (дешево, без сети); GET /planes — детали per-plane; RECOVERY_STATUS стал динамическим recoveryStatus() — rebuilt-список вычисляется из живого состояния (planes + git + chain), а не закеширован из R81-PHASE0",
    fail_closed_verified: "все credential-зависимые поверхности деградируют machine-coded ошибками (github_no_token / controlplane_secrets_missing / edge_secrets_missing / mirror_secrets_missing) — QA agent-browser в degraded-режиме: 14 карточек, 0 JS-ошибок, ERR-состояния честные",
    console_degraded_ux: "глобальный EnvResetBanner (planes ✗/✓ чипы + выжившие локальные поверхности + инструкция восстановления); mirror-verify классификация: credentials-блокировка ≠ нарушение контракта (amber «не выполнена · секреты» вместо rose «нарушен»); mirror-alert классифицирует secrets_missing как env-degraded, не как divergence; footer chip env-reset; recovery-карточка динамическая",
    chain_continuity: "новая цепь начинается RECOVERY_GENESIS с тем же mirror-якорем #90013992 — контракт me2-mirror-v1 переживает N-е поколение daemon без разрыва ledger-пространства",
  },
} as const;

// R88-RESILIENCE: recovery state is now COMPUTED from live state (planes +
// daemon + chain), never cached from a past round — env-reset #2 (13:42Z)
// proved a static snapshot goes stale the moment the environment shifts.
// The R81-PHASE0 history note is preserved in `history`.
export function recoveryStatus(planes: { id: string; label: string; status: string }[], envReset: { suspected: boolean }) {
  const restored = [
    { item: "me2-daemon REST :3041 + WS :3040 (bun, zero-deps)", state: "ALIVE" },
    { item: "Mission Control console :3000 (14 карточек, degraded-honest)", state: "ALIVE" },
    { item: "hash-chained event log: RECOVERY_GENESIS → mirror anchor #90013992 (тот же ledger-контракт)", state: "REBUILT" },
    { item: "donor action manifest: 57 действий (4 lanes) из sandbox/me2-os @ 56ba1b87", state: "RECOVERED" },
    { item: "source-tree: git history пережила reset (worklog + все раунды R81→R83 в коммитах)", state: "ALIVE" },
    ...planes.filter((p) => p.status === "ok").map((p) => ({ item: `secrets ${p.label}`, state: "PRESENT" })),
  ];
  const blocked = [
    ...planes.filter((p) => p.status !== "ok").map((p) => ({
      item: `secrets ${p.label}`,
      reason: `${p.id}-плоскость деградирована: восстановить файл (perms 600) — все зависимые поверхности fail-closed с machine-coded ошибками`,
    })),
    { item: "credentials rotation (P0 security)", reason: "raw credentials в chat export; ротация — только у оператора" },
  ];
  return {
    env_reset_detected: envReset.suspected,
    detected_at: "2026-09-26T13:42:00Z",
    reset_count: 2,
    history: "env-reset #1: 2026-09-26 06:20Z (R81-PHASE0 — восстановление заняло раунд; donor lineage выжил в git); env-reset #2: 13:42Z — система деградировала ЧЕСТНО без ручного вмешательства (fail-closed все внешние поверхности, локальные живы)",
    restored,
    blocked,
    pending_next: [
      "восстановить /home/z/.a2/*.env (perms 600): .github.env (GITHUB_TOKEN_ADMIN) · supabase-cloud.env (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) · cloudflare.env (CF_API_TOKEN + CF_ACCOUNT_ID) · supervisor.env — после этого все surfaces восстановятся сами (pollers живые)",
      "R82-verify: live readback self-update (runtime версия сменится с 0.7.0-dev.36089462649.1 на новый digest; cycle_seq рост после очистки драфта оператором; ROOT_DRAFT_OVERSIZED в rollover_reason пока драфт не очищен)",
      "R83-merge: PR #982 (source-import) под ревью оператора → merge закрывает импорт-фазу; после — controlled promotion (deploy-from-repo) с re-verify digest + ротацией CF-токена",
      "полный donor bus (57 действий): реализация вместе с Browser control plane (R84–R86)",
    ],
  };
}
