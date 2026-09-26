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
    evidence: "Source-фиксы в ветке (ghost-tab retire по destroyed proof; idle-work после пустого command turn; CI all-green @ 5a1c6178). Live readback ОТКРЫТ: installed runtime всё ещё ROLLOVER_AMBIGUOUS, cycle 2109 — ждёт exact-head installer.",
  },
  {
    round: "R83",
    title: "EDGE CONVERGENCE",
    goal: "Repo == deployed backend: квалифицировать v14 canary, Postgres NOTIFY, result receipt, emergency routes, controlled promotion.",
    exit_gate: "production Edge digest/source binding соответствует candidate; signed E2E + rollback PASS.",
    status: "PENDING",
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
    "installed Browser остаётся ROLLOVER_AMBIGUOUS (cycle_seq 2109, TYPE_EFFECT_AMBIGUOUS, stale >32h) — закрытие R82 требует exact-head installer → установку → положительный live readback",
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
    "R82: физический installed readback (exact-head installer после терминального CI на 2c28aa85+)",
    "R83: квалификация v14 Edge canary (после R82 proof) — production v13 всё ещё pinned к d8b239e7",
    "полный donor bus (57 действий): реализация вместе с Browser control plane (R84–R86)",
    "auto-mirror событий в me2_event_mirror_h205f22 (после ревью оператором anchor-записи)",
  ],
} as const;
