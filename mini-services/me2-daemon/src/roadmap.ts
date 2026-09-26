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
}

export const ROADMAP: RoadmapItem[] = [
  {
    round: "R81",
    title: "AUTHORITY FREEZE",
    goal: "Одна доказанная source topology: convergence-ветка от exact release, классификация всех 618 веток, ротация утёкших credentials.",
    exit_gate: "618/618 веток классифицированы; unrelated history поддерживается аудитором; секретов в source/capsules нет.",
    status: "IN_PROGRESS",
  },
  {
    round: "R82",
    title: "SUPERVISOR LIVENESS",
    goal: "Закрыть P0: deterministic composer resolver, устранить supervisor_composer_not_unique и residual maintenance starvation.",
    exit_gate: "cycle_seq монотонно растёт; wake→effect→readback; нет maintenance timeout; restart не ломает цикл.",
    status: "PENDING",
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
    status: "PENDING",
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

export const RECOVERY_STATUS = {
  env_reset_detected: true,
  detected_at: "2026-09-26T06:20:00Z",
  restored: [
    { item: "secrets /home/z/.a2/supabase-cloud.env", state: "RESTORED" },
    { item: "secrets /home/z/.a2/cloudflare.env", state: "RESTORED" },
    { item: "secrets /home/z/.a2/supervisor.env", state: "RESTORED" },
    { item: "me2-daemon REST :3041 + WS :3040", state: "REBUILT" },
    { item: "hash-chained event log (anchor: mirror seq 90013992)", state: "REBUILT" },
    { item: "Mission Control console (src/app/page.tsx)", state: "REBUILT" },
    { item: "Supabase control-plane live readback", state: "VERIFIED" },
  ],
  blocked: [
    { item: "git push main:sandbox/me2-os", reason: "GITHUB_TOKEN_ADMIN отсутствует в /home/z/.a2/.github.env (env-reset)" },
    { item: "donor lineage recovery (sandbox/me2-os @ 56ba1b87)", reason: "нет GitHub-credentials; репозиторий приватный" },
    { item: "branch audit 618/618 (R81 gate)", reason: "требует GitHub API access" },
    { item: "credentials rotation (P0 security)", reason: "raw credentials в chat export; ротация — только у оператора" },
  ],
  pending_next: [
    "auto-mirror событий в me2_event_mirror_h205f22 (после ревью оператором anchor-записи)",
    "восстановление полного 47-action реестра из donor lineage",
    "R82: supervisor liveness fixes (ROLLOVER_AMBIGUOUS / composer_not_unique)",
  ],
} as const;
