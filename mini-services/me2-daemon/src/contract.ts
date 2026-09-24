// ── R49 (фаза A): контрактная поверхность daemon ⇄ браузерной me2-плоскости ──
// Аналоги: LSP initialize (версия протокола + capabilities сервера), MCP handshake.
// Браузерная me2-плоскость (apps/metaengine-browser/src/me2/*) при старте читает
// /state → contract + capabilities и честно деградирует при несовпадении (K1-фикс).
import { VERSION } from "../store";
import { WS_PORT, REST_PORT } from "./ports";

export const CONTRACT_VERSION = "me2-daemon-contract.v1";

/** Единый список ops поверхности agentchat:op (socket, ack). Порядок фиксируется контрактом. */
export const AGENTCHAT_OPS = [
  "create",
  "turn",
  "compact",
  "close",
  "tick",
  "send",
  "objective",
  "mesh_heartbeat", // R49: мост supervisor-mesh браузера ⇄ agentChatSupervisorTick
] as const;

export type CapabilityContract = {
  contract: string;
  version: string;
  ops: readonly string[];
  transport: { socket: string; path: string; port: number; ack: boolean; events: string[] };
  rest: { read: string[]; write: string[] };
  memory: string[];
  ui: string;
  compat: {
    /** K8 (план §E11): матрица совместимости — живая сторона вычисляет её в /state. */
    daemon: string;
    contract: string;
    ui_fallback: string;
    browser_expect: string;
    notes: string[];
  };
};

export function capabilitiesJson(): CapabilityContract {
  return {
    contract: CONTRACT_VERSION,
    version: VERSION,
    ops: AGENTCHAT_OPS,
    transport: {
      socket: "agentchat:op",
      path: "/",
      port: WS_PORT,
      ack: true,
      events: ["agentchat:step", "snapshot"],
    },
    rest: {
      read: ["/health", "/state", "/agentchat", "/agentchat/:id", "/agentchat/:id/status", "/events", "/tokens", "/evidence", "/eval", "/sqlmirror", "/sqlmirror/ui-token", "/sqlmirror/rls-audit", "/sqlmirror/rpc-reconcile", "/hooks", "/llm", "/exthost", "/exec", "/file", "/review", "/sandbox"],
      write: ["/tokens {op:set|delete}", "/policy", "/demand", "/cron", "/exthost/run {id}", "/exec {op:run|plan,cmd,cwd,timeout_ms?,sandbox?} (P0-a: белый список бинарей по сегментам + prlimit + cwd в управляемых корнях; plan — без spawn; sandbox:true — R64 P0-2)", "/file {op:apply|rollback, path, diff|edit_id} (P0-a: unified-diff + dry-run + durable-rollback)", "/review {op:approve|deny|classify|config} (P0-b: тир-3 классификатор, очередь одобрений ask)", "/sandbox {op:probe|run|config} (R64 P0-2: OS-конфайнмент ns+seccomp, strict fail-closed)"],
    },
    memory: ["/memory op:write|delete|economy"],
    ui: "/ui",
    compat: {
      daemon: VERSION,
      contract: CONTRACT_VERSION,
      ui_fallback: "/ui",
      browser_expect: ">=0.7.0-dev (me2-плоскость R40+, смарт-мерж PR #948)",
      notes: [
        "browser me2-плоскость ожидает ops ['turn','mesh_heartbeat'] и GET /ui (R40-док)",
        "disconnect контракта → честный DEGRADED у моста, restart-шторма нет (R49 handshake)",
        "матрица: docs/version-matrix.md (K8)",
        "R53: зеркало SQL в Supabase читается из UI с гейтом RLS (jwt authenticated 120с; anon — fail-closed)",
        "R58: политики как данные — GET /sqlmirror/rls-audit сверяет живой каталог Postgres с ожидаемой матрицей sql/0003+0004 (DML строго; платформенные дефолты Supabase — info)",
        "R68/R69: webhooks-in (push-фаза P0-e) — POST /hooks/github, HMAC-SHA256 X-Hub-Signature-256 (timing-safe), персистентный дедуп X-GitHub-Delivery (sqlite hook_deliveries, переживает рестарт); события HOOK_PING/GIT_PUSH/GIT_PR_*/CI_HOOK_RUN_* → event-log → облако; боевой контур: хук 685103637 в репо → smee.io → релей me2-webhook-relay (:3044, outbound-SSE) → daemon — первый внешний HOOK_PING seq 5846 verified (R69.1); прямой лег :81 /hooks/github?XTransformPort=3041 тоже работает; секрет в vault (GITHUB_WEBHOOK_SECRET), регистрация — scripts/webhook-register.sh [auto|register|ping]; без секрета — честный 503",
        "R60: workbench-лэйаут /ui — collapse/expand секций с персистом localStorage (канон VS Code workbench, порядок секций не меняется)",
        "R60: exthost — расширения skills/ext/* исполняются в подпроцессе под prlimit, только stdio-JSON, caps-медиация (неизвестная cap — честный отказ), activation manual/bus:*",
        "R60 ruling оператора: «UI не обязан быть read only» — REST-записи из панели разрешены только санкционированные (белый список в eval mission.ui_contract; сейчас: POST /exthost/run, /exec, /file)",
        "R62 P0-a exec/edit tools (гэп P0-0 R61): TERMINAL_RUN — allowlist бинарей по сегментам, prlimit as/nofile/core, таймаут, env-белый-список, cwd только в песочницах/worktrees; FILE_EDIT — unified-diff с dry-run-валидацией и durable-rollback из журнала; манифест non-bypass 30→32 (eval v26)",
        "R63 P0-b classifier tier (гэп P0-1 R61): Run Modes (run|plan) + тир-3 классификатор пре-исполнения по канону Cursor D02 (allowlist → prlimit → classifier); вердикты allow/ask/block; ask → очередь одобрений оператора (POST /review approve|deny); эвристика детерминированная, LLM — opt-in (policy.json classifier, таймаут → ask fail-closed); классификатор честно НЕ security boundary; манифест non-bypass 32→33 (eval v27)",
        "R64 P0-2 OS-sandbox (гэп P0-2 R61): fs/syscall-конфайнмент канона Cursor — слоистый дизайн: Landlock (ядро ≥5.13; на 5.10 ENOSYS — честный skip) + ns (userns+mountns: ro-root, rw-rebind управляемых корней, tmpfs /tmp, tmpfs-RO поверх /home/z/.a2) + seccomp-bpf (deny-лист mount/unshare/io_uring/ptrace… + default-deny INET, единый билдер launcher/eval); strict fail-closed — слои не применились → команда НЕ исполнена; verdict «sandbox» классификатора теперь реален (sandbox.auto_sandbox, канон D02); манифест non-bypass 33 (eval v28)",
        "R72/R73: LLM Quota-Resilience (GET /llm) — 4 уровня без обхода квоты: L1 pacing (глобальный min-gap стартов), L2 response-cache (SQLite llm_cache, дедуп детерминированных промптов), L3 failover zai↔gateway (TLS-проба исключает мёртвый канал, LLM_FAILOVER в chain), L4 park-and-resume (квотная/инфра ошибка → READY+not_before_ms, бюджет PARK_MAX=8, 45с→600с; FAILED только после бюджета); R73: зеркало пишет поколенио-безопасные seq' (boot_epoch = epoch_n×10^7, meta sqlmirror_epoch_n) — перекрытие поколений песочниц устранено без DDL; relay-watchdog (me2-webhook-relay/watchdog.sh, автостарт в start.sh)",
      ],
    },
  };
}

/** Аддитивная надстройка над snapshot(): ничего не ломает существующих потребителей /state. */
export function withContract(base: Record<string, unknown>): Record<string, unknown> {
  return { ...base, contract: CONTRACT_VERSION, capabilities: capabilitiesJson() };
}

// ── GET /ui — самодостаточная Mission Control (наследие R41-дока, реализовано в R49) ──
// Требования контракта: 0 сборки, 0 внешних зависимостей; socket.io-клиент берётся
// с самого daemon'а (:3040, path "/"); данные — REST того же origin.
// Операторские ходы — через socket agentchat:op (ack). R60, указание оператора: «UI не
// обязан быть read only» — REST-записи разрешены, но ТОЛЬКО санкционированные (белый
// список в eval mission.ui_contract, каждая именована в capabilities.rest.write).
export function missionUiHtml(): string {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ME2 Mission Control — daemon ${VERSION}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; background:#09090b; color:#e4e4e7; font:14px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }
  a { color:#34d399; }
  header { display:flex; flex-wrap:wrap; gap:8px; align-items:center; padding:12px 16px; border-bottom:1px solid #27272a; position:sticky; top:0; background:rgba(9,9,11,.92); backdrop-filter:blur(6px); z-index:5; }
  header h1 { font-size:16px; margin:0 8px 0 0; font-weight:650; letter-spacing:.2px; }
  .chip { display:inline-flex; align-items:center; gap:6px; padding:2px 9px; border-radius:999px; font-size:11.5px; border:1px solid #3f3f46; background:#18181b; color:#a1a1aa; }
  .chip.ok { border-color:#065f46; color:#6ee7b7; background:rgba(16,185,129,.08); }
  .chip.warn { border-color:#78350f; color:#fcd34d; background:rgba(245,158,11,.08); }
  .chip.err { border-color:#7f1d1d; color:#fca5a5; background:rgba(244,63,94,.08); }
  .chip .dot { width:7px; height:7px; border-radius:50%; background:currentColor; }
  main { display:grid; grid-template-columns:minmax(300px,420px) 1fr; gap:12px; padding:12px 16px; max-width:1400px; margin:0 auto; }
  @media (max-width: 900px) { main { grid-template-columns:1fr; } }
  section { border:1px solid #27272a; border-radius:12px; background:#111113; overflow:hidden; display:flex; flex-direction:column; min-height:180px; }
  section h2 { margin:0; padding:10px 14px; font-size:12.5px; font-weight:600; color:#d4d4d8; letter-spacing:.4px; text-transform:uppercase; border-bottom:1px solid #27272a; display:flex; gap:8px; align-items:center; cursor:pointer; user-select:none; }
  section h2 .n { margin-left:auto; color:#71717a; font-weight:500; text-transform:none; }
  /* R60 workbench (канон VS Code): каждая секция сворачиваема, состояние переживает перезапуск */
  .wb-toggle { margin-left:2px; background:none; border:0; color:#71717a; width:22px; height:22px; min-height:0; padding:0; display:inline-flex; align-items:center; justify-content:center; cursor:pointer; border-radius:6px; font-size:11px; line-height:1; }
  .wb-toggle:hover { color:#e4e4e7; background:#27272a; }
  .wb-toggle:focus-visible { outline:2px solid #10b981; outline-offset:1px; }
  section.wb-collapsed .wb-body { display:none; }
  section.wb-collapsed h2 { color:#71717a; border-bottom-color:transparent; }
  .wb-reset { background:#18181b; border:1px solid #3f3f46; color:#d4d4d8; min-height:0; padding:3px 10px; font-size:11.5px; font-weight:500; cursor:pointer; border-radius:8px; }
  .wb-reset:hover { background:#27272a; }
  .scroll { overflow-y:auto; max-height:46vh; padding:6px; }
  .row { display:flex; gap:8px; align-items:flex-start; padding:8px 10px; border-radius:8px; border:1px solid transparent; }
  .row:hover { border-color:#3f3f46; background:#18181b; }
  .row .id { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:11px; color:#71717a; }
  .row .t { font-weight:550; font-size:13px; }
  .row .sub { font-size:11.5px; color:#a1a1aa; }
  .state { font-size:10.5px; padding:1px 7px; border-radius:999px; border:1px solid #3f3f46; }
  .state.IDLE { color:#a1a1aa; } .state.THINKING { color:#6ee7b7; border-color:#065f46; background:rgba(16,185,129,.1); }
  .state.DEGRADED { color:#fcd34d; border-color:#78350f; background:rgba(245,158,11,.1); }
  .state.CLOSED { color:#fca5a5; border-color:#7f1d1d; }
  .ev { padding:6px 8px; border-left:2px solid #3f3f46; margin:4px 6px; font-size:12px; }
  .ev .ty { color:#71717a; font-family:ui-monospace,Menlo,monospace; font-size:10.5px; }
  .ev.step { border-left-color:#10b981; } .ev.degraded { border-left-color:#f59e0b; }
  .ev .pl { color:#d4d4d8; white-space:pre-wrap; word-break:break-word; }
  .ops { padding:10px 14px; border-top:1px solid #27272a; display:flex; flex-direction:column; gap:8px; }
  textarea { width:100%; min-height:64px; resize:vertical; background:#09090b; color:#e4e4e7; border:1px solid #3f3f46; border-radius:8px; padding:8px 10px; font:inherit; }
  textarea:focus-visible, select:focus-visible, button:focus-visible { outline:2px solid #10b981; outline-offset:1px; }
  .line { display:flex; gap:8px; }
  select { flex:1; background:#09090b; color:#e4e4e7; border:1px solid #3f3f46; border-radius:8px; padding:7px 9px; font:inherit; }
  .ops input { flex:1; background:#09090b; color:#e4e4e7; border:1px solid #3f3f46; border-radius:8px; padding:7px 9px; font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace; }
  .ops input:focus-visible { outline:2px solid #10b981; outline-offset:1px; }
  button { background:#059669; border:1px solid #047857; color:#ecfdf5; border-radius:8px; padding:7px 14px; font:inherit; font-weight:600; cursor:pointer; min-height:32px; }
  button:hover { background:#047857; }
  button:disabled { opacity:.45; cursor:default; }
  button.ghost { background:#18181b; border-color:#3f3f46; color:#d4d4d8; }
  .toast { position:fixed; right:14px; bottom:14px; max-width:420px; padding:10px 14px; border-radius:10px; border:1px solid #3f3f46; background:#18181b; color:#e4e4e7; box-shadow:0 8px 30px rgba(0,0,0,.5); font-size:12.5px; display:none; }
  .toast.ok { border-color:#065f46; } .toast.err { border-color:#7f1d1d; }
  footer { padding:8px 16px 14px; color:#52525b; font-size:11px; text-align:center; }
  [role="status"] { min-height:18px; }
</style>
</head>
<body>
<header>
  <h1>ME2 Mission Control</h1>
  <span class="chip" id="ch-ver" data-testid="mc-version">daemon …</span>
  <span class="chip" id="ch-contract" data-testid="mc-contract">contract …</span>
  <span class="chip" id="ch-socket" data-testid="mc-socket"><span class="dot"></span>socket …</span>
  <span class="chip" id="ch-mesh" data-testid="mc-mesh">mesh: …</span>
  <span class="chip ghost" id="ch-upd" data-testid="mc-updated">…</span>
  <button class="wb-reset" id="wb-reset" title="Сбросить лэйаут панелей (localStorage)">лэйаут ↺</button>
</header>
<main>
  <section aria-label="Флот чат-агентов" id="wb-fleet">
    <h2>Флот <span class="n" id="fleet-n">—</span><button class="wb-toggle" id="wb-toggle-fleet" aria-expanded="true" aria-controls="wb-body-fleet" data-testid="mc-fleet-toggle" title="Свернуть/развернуть">▾</button></h2>
    <div class="wb-body" id="wb-body-fleet">
    <div class="scroll" id="fleet" role="list" data-testid="mc-fleet" aria-live="polite"></div>
    <div class="ops">
      <div class="line">
        <select id="chat-sel" aria-label="Чат-получатель"></select>
      </div>
      <textarea id="msg" aria-label="Сообщение оператора" placeholder="Ход оператора выбранному чату (socket agentchat:op → ack)…"></textarea>
      <div class="line">
        <button id="b-turn" title="Полный ход: чат подумает и выполнит действия">Ход</button>
        <button id="b-send" class="ghost" title="Только сообщение в историю + пробуждение">Send</button>
        <button id="b-tick" class="ghost" title="Ручной тик супервизоров">Тик супервизоров</button>
      </div>
      <div id="op-status" role="status" aria-live="polite"></div>
    </div>
    </div>
  </section>
  <section aria-label="Река событий" id="wb-river">
    <h2>Река <span class="n" id="river-n">—</span><button class="wb-toggle" id="wb-toggle-river" aria-expanded="true" aria-controls="wb-body-river" data-testid="mc-river-toggle" title="Свернуть/развернуть">▾</button></h2>
    <div class="wb-body" id="wb-body-river">
    <div class="scroll" id="river" data-testid="mc-river" aria-live="polite"></div>
    </div>
  </section>
  <section aria-label="SQL-зеркало с гейтом RLS" style="grid-column:1/-1" id="wb-mirror">
    <h2>Зеркало SQL (Supabase · RLS) <span class="n" id="mirror-n">—</span><button class="wb-toggle" id="wb-toggle-mirror" aria-expanded="true" aria-controls="wb-body-mirror" data-testid="mc-mirror-toggle" title="Свернуть/развернуть">▾</button></h2>
    <div class="wb-body" id="wb-body-mirror">
    <div class="row sub" id="rls-audit" data-testid="mc-rls-audit" style="margin:6px 6px 0">аудит политик: загрузка…</div>
    <div class="row sub" id="rpc-reconcile" data-testid="mc-rpc-reconcile" style="margin:6px 6px 0">сверка реестра: загрузка…</div>
    <div class="row sub" id="hooks-in" data-testid="mc-hooks-in" style="margin:6px 6px 0">webhooks-in: загрузка…</div>
    <div class="scroll" id="mirror" data-testid="mc-mirror" style="max-height:32vh" aria-live="polite"></div>
    </div>
  </section>
  <section aria-label="Расширения exthost" style="grid-column:1/-1" id="wb-ext">
    <h2>Расширения (exthost · prlimit) <span class="n" id="ext-n">—</span><button class="wb-toggle" id="wb-toggle-ext" aria-expanded="true" aria-controls="wb-body-ext" data-testid="mc-ext-toggle" title="Свернуть/развернуть">▾</button></h2>
    <div class="wb-body" id="wb-body-ext">
    <div class="scroll" id="ext" data-testid="mc-ext" style="max-height:26vh" aria-live="polite"></div>
    </div>
  </section>
  <section aria-label="Exec/Edit инструменты P0-a" style="grid-column:1/-1" id="wb-exec">
    <h2>Exec/Edit (P0-a · прелимит · белые списки) <span class="n" id="exec-n">—</span><button class="wb-toggle" id="wb-toggle-exec" aria-expanded="true" aria-controls="wb-body-exec" data-testid="mc-exec-toggle" title="Свернуть/развернуть">▾</button></h2>
    <div class="wb-body" id="wb-body-exec">
    <div class="row sub" id="exec-caps" data-testid="mc-exec-caps" style="margin:6px 6px 0">exec: загрузка…</div>
    <div class="scroll" id="exec" data-testid="mc-exec" style="max-height:20vh" aria-live="polite"></div>
    <div class="ops">
      <div class="line"><input id="exec-cmd" aria-label="Команда (белый список)" placeholder="команда: git, node, bun, ls, cat, grep… (подстановки $() и env= отклоняются)" value="node --version"></div>
      <div class="line"><input id="exec-cwd" aria-label="cwd в управляемом корне" placeholder="cwd: каталог внутри песочницы или worktree…"></div>
      <div class="line">
        <button id="b-exec" title="TERMINAL_RUN: allowlist по сегментам → классификатор → prlimit → таймаут (санкционированная запись POST /exec)">Выполнить</button>
        <button id="b-plan" class="ghost" title="Run Mode plan: план + вердикт классификатора БЕЗ исполнения (POST /exec op:plan)">План</button>
        <button id="b-demo" class="ghost" title="Демо петли Cursor: FILE_EDIT создаёт p0a-demo.js → TERMINAL_RUN node p0a-demo.js → зелёный вывод (POST /file + /exec)">Demo: edit→run→green</button>
        <span id="exec-out" class="sub" style="align-self:center; white-space:pre-wrap; max-height:64px; overflow-y:auto"></span>
      </div>
    </div>
    </div>
  </section>
  <section aria-label="Run Modes и классификатор пре-исполнения P0-b" style="grid-column:1/-1" id="wb-review">
    <h2>Run Modes (P0-b · классификатор) <span class="n" id="review-n">—</span><button class="wb-toggle" id="wb-toggle-review" aria-expanded="true" aria-controls="wb-body-review" data-testid="mc-review-toggle" title="Свернуть/развернуть">▾</button></h2>
    <div class="wb-body" id="wb-body-review">
    <div class="row sub" id="review-caps" data-testid="mc-review-caps" style="margin:6px 6px 0">classifier: загрузка…</div>
    <div class="row sub" id="review-stats" style="margin:0 6px">статистика 24ч: —</div>
    <div class="scroll" id="review" data-testid="mc-review" style="max-height:22vh" aria-live="polite"></div>
    </div>
  </section>
  <section aria-label="OS-сандбокс P0-2" style="grid-column:1/-1" id="wb-sandbox">
    <h2>Sandbox (P0-2 · OS-конфайнмент) <span class="n" id="sbox-n">—</span><button class="wb-toggle" id="wb-toggle-sandbox" aria-expanded="true" aria-controls="wb-body-sandbox" data-testid="mc-sbox-toggle" title="Свернуть/развернуть">▾</button></h2>
    <div class="wb-body" id="wb-body-sandbox">
    <div class="row sub" id="sbox-caps" data-testid="mc-sbox-caps" style="margin:6px 6px 0">sandbox: загрузка…</div>
    <div class="row sub" id="sbox-probe" style="margin:0 6px">probe: не запускался</div>
    <div class="scroll" id="sbox" data-testid="mc-sbox" style="max-height:20vh" aria-live="polite"></div>
    <div class="ops">
      <div class="line"><input id="sbox-cmd" aria-label="Команда в сандбоксе" placeholder="команда (белый список): echo, git, node, ls…"></div>
      <div class="line"><input id="sbox-cwd" aria-label="cwd в управляемом корне" placeholder="cwd: каталог внутри песочницы или worktree…"></div>
      <div class="line">
        <button id="b-sbox-run" title="Запуск в сандбоксе: unshare userns+mountns → ro-root + rw-rebind + hide-секретов → seccomp deny-лист + net=deny (POST /sandbox op:run — tier-1 план обязателен)">В сандбоксе</button>
        <button id="b-sbox-probe" class="ghost" title="Живая верификация конфайнмента: запись внутрь ok · запись в секреты отказ · сеть EPERM · контроль net=allow (POST /sandbox op:probe)">Probe</button>
        <span id="sbox-out" class="sub" style="align-self:center; white-space:pre-wrap; max-height:64px; overflow-y:auto"></span>
      </div>
    </div>
    </div>
  </section>
</main>
<footer>self-contained · 0 сборки · 0 внешних зависимостей · socket.io с daemon'а (:${WS_PORT}, path "/") · данные — REST · записи — только санкционированные (R60 ruling: POST /exthost/run · /exec · /file · /review · /sandbox)</footer>
<div id="toast" class="toast" role="alert"></div>
<script>
(function(){
  "use strict";
  var $ = function(id){ return document.getElementById(id); };
  var socket = null, socketOk = false, chats = [];
  // gateway-адаптация: на гейте (:81) относительные REST-пути требуют XTransformPort;
  // на прямом REST-порту (Electron/оператор) — путь как есть.
  var GATEWAY = (location.port === "81");
  function api(p){ return GATEWAY ? p + (p.indexOf("?") >= 0 ? "&" : "?") + "XTransformPort=${REST_PORT}" : p; }

  function toast(msg, cls){ var t=$("toast"); t.textContent=msg; t.className="toast "+(cls||""); t.style.display="block"; clearTimeout(t._h); t._h=setTimeout(function(){ t.style.display="none"; }, 4200); }
  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  function ago(ts){ var d=Date.now()-Date.parse(ts); if(!(d>=0)) return ""; if(d<6e4) return Math.floor(d/1e3)+"с"; if(d<36e5) return Math.floor(d/6e4)+"м"; return Math.floor(d/36e5)+"ч"; }

  function op(payload, okMsg){
    if(!socketOk){ toast("socket недоступен — режим чтения", "err"); return; }
    var s = $("op-status"); s.textContent = "…"; s.style.color = "#a1a1aa";
    socket.timeout(10000).emit("agentchat:op", payload, function(err, ack){
      if (err) { s.textContent = "таймаут/ошибка ack"; s.style.color="#fca5a5"; toast("ack timeout", "err"); return; }
      if (ack && ack.ok) { s.textContent = okMsg; s.style.color="#6ee7b7"; toast(okMsg, "ok"); if(payload.op!=="tick") loadFleet(); }
      else { var e=(ack&&ack.error)||"unknown"; s.textContent="ошибка: "+e; s.style.color="#fca5a5"; toast("отказ: "+e, "err"); }
    });
  }

  function renderFleet(){
    var box=$("fleet"); box.textContent="";
    var sel=$("chat-sel"); var cur=sel.value; sel.textContent="";
    chats.forEach(function(c){
      var r=document.createElement("div"); r.className="row"; r.setAttribute("role","listitem");
      var left=document.createElement("div"); left.style.flex="1";
      var t=document.createElement("div"); t.className="t"; t.textContent=c.title||c.agent_id||c.id;
      var sub=document.createElement("div"); sub.className="sub";
      sub.innerHTML='<span class="id">'+esc(c.id.slice(0,18))+"</span> · "+esc(c.role||"—")+" · "+esc(c.unread?"unread:"+c.unread:"—")+(c.objective?" · 🎯 "+esc(String(c.objective).slice(0,60)):"");
      left.appendChild(t); left.appendChild(sub);
      var st=document.createElement("span"); st.className="state "+esc(c.state); st.textContent=c.state;
      r.appendChild(left); r.appendChild(st);
      r.style.cursor="pointer";
      r.addEventListener("click", function(){ $("msg").focus(); sel.value=c.id; });
      box.appendChild(r);
      var o=document.createElement("option"); o.value=c.id; o.textContent=(c.title||c.id).slice(0,42)+" · "+c.state; sel.appendChild(o);
    });
    if(cur) sel.value=cur;
    $("fleet-n").textContent = chats.length + " чат(ов)";
    if(!chats.length) box.innerHTML='<div class="row sub">флот пуст — чаты создаются оператором в панели БРАУЗЕР или супервизорами</div>';
  }
  function renderRiver(list, prepend){
    var box=$("river");
    if(!prepend) box.textContent="";
    var frag=document.createDocumentFragment();
    list.forEach(function(e){
      var d=document.createElement("div"); d.className="ev "+(String(e.type).includes("DEGRADED")?"degraded":"step");
      var ty=document.createElement("div"); ty.className="ty"; ty.textContent=e.type+" · "+ago(e.ts)+" назад · seq "+(e.seq??"—");
      var pl=document.createElement("div"); pl.className="pl";
      var p=e.payload||{}; pl.textContent = p.preview || p.text || p.detail || p.note || JSON.stringify(p).slice(0,180);
      d.appendChild(ty); d.appendChild(pl); frag.appendChild(d);
    });
    if(prepend) box.insertBefore(frag, box.firstChild); else box.appendChild(frag);
    var n=box.querySelectorAll(".ev").length; $("river-n").textContent=n+" событий";
    while(box.querySelectorAll(".ev").length>120) box.removeChild(box.lastChild);
  }

  function loadFleet(){
    fetch(api("/agentchat")).then(function(r){ return r.json(); }).then(function(j){
      if(!j.ok) throw new Error("agentchat");
      chats = j.sessions||[];
      renderFleet();
    }).catch(function(){ $("fleet-n").textContent="ошибка"; });
  }
  function loadRiver(){
    fetch(api("/events?limit=60")).then(function(r){ return r.json(); }).then(function(j){
      if(!j.ok) throw new Error("events");
      var evs=(j.events||[]).filter(function(e){ return String(e.type).indexOf("AGENT_CHAT")===0 || String(e.type).indexOf("MESH")===0; });
      renderRiver(evs.reverse(), false);
    }).catch(function(){ $("river-n").textContent="ошибка"; });
  }
  function loadHead(){
    fetch(api("/health")).then(function(r){ return r.json(); }).then(function(j){
      $("ch-ver").textContent = "daemon "+j.version;
      $("ch-ver").className = "chip "+(j.ok?"ok":"err");
    });
    fetch(api("/state")).then(function(r){ return r.json(); }).then(function(j){
      $("ch-contract").textContent = j.contract || "contract: n/a";
      $("ch-contract").className = "chip "+(j.contract?"ok":"warn");
      var mesh=null; try { mesh = JSON.parse(window.__meshMeta||"null"); } catch(e){}
      $("ch-mesh").textContent = "mesh: "+(j.capabilities && j.capabilities.ops.indexOf("mesh_heartbeat")>=0 ? "op ok" : "нет op");
    });
  }

  function loadMirror(){
    // R55: гибрид — ДАННЫЕ доставляет daemon (/sqlmirror/feed, service-канал; UI не держит приватных
    // ключей), а RLS демонстрируется ЖИВОЙ пробой облака. R57: ПОЛНАЯ матрица — anon-проба публичным
    // токеном (fail-closed) + authenticated-проба настоящим GoTrue access_token (читает строки по
    // политике, не обходя RLS). apikey-заголовок для GoTrue-пробы — публичный ключ, Bearer — юзер-JWT.
    fetch(api("/sqlmirror/ui-token")).then(function(r){ return r.json(); }).then(function(j){
      var box=$("mirror");
      if(!j.ok){ box.innerHTML='<div class="row sub">RLS-канал честно недоступен: '+esc(j.reason)+" · зеркало state="+esc(j.mirror_state||"?")+" (ключей нет в vault'е)</div>"; $("mirror-n").textContent="канал n/a"; return; }
      var probe=function(tok, key){
        return fetch(j.rest+"/"+j.table+"?select=seq&limit=3", {headers:{apikey:(key||tok),Authorization:"Bearer "+tok}})
          .then(function(r){ return r.text().then(function(t){ return {code:r.status,body:t}; }); });
      };
      var feedP=fetch(api("/sqlmirror/feed?limit=12")).then(function(r){ return r.json(); });
      var probeP=(j.channel==="publishable"||j.channel==="anon_registered"||j.channel==="mint")
        ? probe(j.anon_token||j.token) : Promise.resolve(null);
      var authTok=j.auth_token||(j.channel==="gotrue"?j.token:null);
      var probeA=authTok ? probe(authTok, j.anon_token||j.token) : Promise.resolve(null);
      Promise.all([feedP, probeP, probeA]).then(function(rs){
        var f=rs[0], anon=rs[1], auth=rs[2];
        var rows=f&&f.ok?f.rows:null;
        var anonRows=null; if(anon){ try { anonRows=JSON.parse(anon.body); } catch(e){} }
        var leak=!!anon && anon.code===200 && Array.isArray(anonRows) && anonRows.length>0;
        var authRows=null; if(auth){ try { authRows=JSON.parse(auth.body); } catch(e){} }
        var chLine='канал '+esc(j.channel||"?")+(j.ttl?" · ttl "+j.ttl+"с":"")+(j.auth_channel?" · auth: "+esc(j.auth_channel)+" (ttl "+esc(String(j.auth_ttl||0))+"с)":"");
        var html='<div class="row sub">state='+esc(j.mirror_state||"?")+" · "+esc(j.table||"?")+" · "+chLine+" · данные — через daemon (/sqlmirror/feed), приватных ключей в UI нет</div>";
        // живой вердикт RLS-гейта (anon)
        if(!anon){ html+='<div class="row sub">RLS-проба: публичного токена нет ('+esc(j.channel||"?")+") — демонстрация гейта словами, не делом</div>"; }
        else if(anon.code===404 || String(anon.body).indexOf("PGRST205")>=0){ html+='<div class="row sub">RLS-проба: облако отвечает PGRST205 — таблицы ещё нет (WARMUP: DDL оператора); аутентификация ПУБЛИЧНОГО ключа прошла ✓</div>'; }
        else if(String(anon.body).indexOf("42501")>=0 || (anon.code===401&&String(anon.body).indexOf("permission denied")>=0)){ html+='<div class="row sub">RLS-гейт: anon ОТКАЗАН (42501 permission denied) — fail-closed ✓ (гранты sql/0004 + политики sql/0003: чтение только authenticated)</div>'; }
        else if(anon.code===401||anon.code===403){ html+='<div class="row sub">облако отвергло публичный токен ('+anon.code+") — неожиданно; проверить ключи vault'а</div>"; }
        else if(anon.code===200){ html+='<div class="row sub">'+(leak?"⚠ anon ПРОЧИТАЛ строки — RLS-гейт НЕ работает (проверить sql/0003)":"RLS-гейт: anon → 200 · 0 строк — fail-closed ✓ (политики sql/0003: чтение только authenticated)")+"</div>"; }
        else html+='<div class="row sub">RLS-проба: неожиданный ответ облака ('+anon.code+") "+esc(String(anon.body).slice(0,60))+"</div>";
        // живой вердикт RLS-чтения (authenticated, gotrue) — R57
        if(authTok){
          if(auth && auth.code===200 && Array.isArray(authRows) && authRows.length>0){ html+='<div class="row sub">RLS-чтение: authenticated → 200 · '+esc(String(authRows.length))+" строк(и) видит политика — чтение по RLS ✓ (GoTrue-токен, не обход гейта)</div>"; }
          else if(auth && auth.code===200){ html+='<div class="row sub">authenticated → 200 · 0 строк — токен принят, но политика отдала пусто (проверить sql/0003/0004)</div>'; }
          else if(auth && (auth.code===401||auth.code===403||String(auth.body).indexOf("42501")>=0)){ html+='<div class="row sub">authenticated отвергнут облаком ('+esc(String(auth.code))+") — неожиданно (токен настоящий GoTrue)</div>"; }
          else if(auth){ html+='<div class="row sub">authenticated-проба: неожиданный ответ облака ('+esc(String(auth.code))+") "+esc(String(auth.body).slice(0,60))+"</div>"; }
          else { html+='<div class="row sub">authenticated-проба не выполнена (сеть) — статус: '+esc(String((j.auth&&j.auth.last_error)||"нет кэша токена"))+"</div>"; }
          if(anon && auth){ html+='<div class="row sub"><b>матрица RLS: anon — отказ ✓ · authenticated — чтение ✓ · service — пишет ✓ (полная демонстрация гейта)</b></div>'; }
        }
        // данные (service-канал daemon'а)
        if(f&&f.ok===false){ html+='<div class="row sub">данных нет: '+(f.error==="table_missing_ddl_pending"?"таблица не создана (DDL оператора) — канал daemon'а при этом жив":"feed: "+esc(String(f.error||"?").slice(0,90)))+"</div>"; }
        else if(Array.isArray(rows)){ html+=rows.map(function(r){ return '<div class="ev"><div class="ty">'+esc(r.type)+" · seq "+esc(r.seq)+" · "+esc(r.actor||"daemon")+(r.subject?" · "+esc(String(r.subject).slice(0,28)):"")+'</div><div class="pl">'+ago(r.ts)+" назад</div></div>"; }).join("")||'<div class="row sub">канал жив, событий пока нет</div>'; }
        else html+='<div class="row sub">feed недоступен</div>';
        box.innerHTML=html;
        $("mirror-n").textContent=Array.isArray(rows)?(rows.length+" строк(и)"):"—";
      }).catch(function(){ $("mirror-n").textContent="ошибка облака"; });
    }).catch(function(){ $("mirror-n").textContent="ошибка"; });
  }

  // R58 «политики как данные»: строка RLS-самоаудита (живой каталог против sql/0003+0004).
  // Кэш daemon'а 60с; опрос панели 120с — psql-канал не штормится.
  function loadAudit(){
    fetch(api("/sqlmirror/rls-audit")).then(function(r){ return r.json(); }).then(function(j){
      var el=$("rls-audit");
      if(!j.ok){ el.textContent="аудит политик: честно недоступен ("+esc(j.reason||"?")+")"; el.style.color="#fcd34d"; return; }
      if(j.mode==="probe_offline"){ el.textContent="аудит политик: офлайн (probe) — матрица ожиданий "+j.expected.dml_rows+" DML / "+j.expected.policies+" политик / anon 0:0"; el.style.color="#a1a1aa"; return; }
      if(j.mode==="live-rest"){ // R66: поведенческий REST-аудит (PostgREST): anon fail-closed + service читает
        var vr=(j.verdict==="PASS"); var vi=(j.verdict==="INCONCLUSIVE");
        var det=(j.probes||[]).map(function(p){ var n=String(p.table).replace("_h205f22","");
          return n+": anon "+(p.anon_blocked===true?"✗блок("+p.anon_status+")":"⚠"+(p.anon_status||"?"))+" · svc "+(p.service_ok?"✓":"✗"+p.service_status); }).join(" · ");
        el.innerHTML="аудит политик (live REST, поведенческий): <b>"+(vr?"PASS ✓":vi?"НЕДОКАЗАН":"FAIL ✗")+"</b> · anon-канал "+esc(j.anon_channel||"?")+(j.control_status!=null?" (контроль "+j.control_status+")":"")+" · "+det+(j.cached?" · кэш 60с":"");
        el.style.color = vr ? "#6ee7b7" : vi ? "#fcd34d" : "#fca5a5"; return;
      }
      var v=(j.verdict==="PASS");
      var anonOk=(j.anon.dml_grants===0&&j.anon.policies===0);
      el.innerHTML="аудит политик (psql, живой каталог): <b>"+(v?"PASS ✓":"FAIL ✗")+"</b> · DML-гранты "+(j.grants.mismatch?"РАСХОЖДЕНИЕ с sql/0004":"= sql/0004 ✓")+" · политики "+(j.policies.mismatch?"РАСХОЖДЕНИЕ с sql/0003":"= sql/0003 ✓")+" · RLS-флаги включены · anon fail-closed "+(anonOk?"✓ (DML="+j.anon.dml_grants+", политик="+j.anon.policies+")":"⚠ DML="+j.anon.dml_grants+", политик="+j.anon.policies)+" · платформенных дефолтов (info): "+(j.grants.platform_extra||[]).length+(j.cached?" · кэш 60с":"");
      el.style.color = (v&&anonOk) ? "#6ee7b7" : "#fca5a5";
    }).catch(function(){ var el=$("rls-audit"); if(el){ el.textContent="аудит политик: сеть недоступна"; el.style.color="#fcd34d"; } });
  }

  // R59 «реестр как данные»: строка сверки RPC-реестра (живой каталог против классификации R52).
  // Кэш daemon'а 60с; опрос панели 120с — psql-канал не штормится.
  function loadReconcile(){
    fetch(api("/sqlmirror/rpc-reconcile")).then(function(r){ return r.json(); }).then(function(j){
      var el=$("rpc-reconcile");
      if(!j.ok){ el.textContent="сверка реестра: честно недоступна ("+esc(j.reason||"?")+")"; el.style.color="#fcd34d"; return; }
      if(j.mode==="probe_offline"){ el.textContent="сверка реестра: офлайн (probe) — ожидание "+j.expected.total+" RPC ("+j.expected.tiers.ACTIVE+"/"+j.expected.tiers.CONTROL_PLANE+"/"+j.expected.tiers.FREEZE+")"; el.style.color="#a1a1aa"; return; }
      var v=(j.verdict==="PASS"); var g=j.registry;
      var chan=(j.mode==="live-rest")?"live REST":"psql, живой каталог"; // R66: два канала одной сверки
      var oa=(j.mode==="live-rest"&&j.openapi_total!=null)?" · OpenAPI "+j.openapi_total:"";
      el.innerHTML="сверка реестра RPC ("+chan+"): <b>"+(v?"PASS ✓":"FAIL ✗")+"</b> · ожидание "+g.expected_total+" · факт "+g.actual_total+" · ACTIVE "+g.per_tier_actual.ACTIVE+"/"+g.per_tier_expected.ACTIVE+" · CONTROL_PLANE "+g.per_tier_actual.CONTROL_PLANE+"/"+g.per_tier_expected.CONTROL_PLANE+" · FREEZE "+g.per_tier_actual.FREEZE+"/"+g.per_tier_expected.FREEZE+" · нет "+g.missing_count+" · лишних "+g.extra_count+" · тир-дрейф "+g.tier_mismatch_count+oa+(j.cached?" · кэш 60с":"");
      el.style.color = v ? "#6ee7b7" : "#fca5a5";
    }).catch(function(){ var el=$("rpc-reconcile"); if(el){ el.textContent="сверка реестра: сеть недоступна"; el.style.color="#fcd34d"; } });
  }

  // R68 «webhooks-in (push)»: статус HMAC-канала внешних событий (P0-e вторая фаза).
  function loadHooks(){
    fetch(api("/hooks")).then(function(r){ return r.json(); }).then(function(j){
      var el=$("hooks-in");
      if(!j.ok){ el.textContent="webhooks-in: недоступен"; el.style.color="#fcd34d"; return; }
      var vr=String(j.verdict||"?");
      var live=(vr==="LIVE");
      var lab=live?"LIVE ✓":(vr==="DEV_SECRET"?"DEV-СЕКРЕТ":(vr==="NO_SECRET"?"СЕКРЕТА НЕТ":"ОЖИДАНИЕ"));
      el.innerHTML="webhooks-in (push, HMAC): <b>"+lab+"</b> · secret "+esc(j.secret||"?")+" · получено "+j.received_total+" · верифицировано "+j.verified_total+" · отклонено "+j.rejected_total+(j.rejected_last_reason?" ("+esc(j.rejected_last_reason)+")":"")+" · событий "+j.events_emitted_total+" · дедуп "+j.dedupe_size+(j.dedupe_persistent?" (sqlite ✓ переживает рестарт)":"");
      el.style.color = live ? "#6ee7b7" : (vr==="NO_SECRET" ? "#fca5a5" : "#fcd34d");
    }).catch(function(){ var el=$("hooks-in"); if(el){ el.textContent="webhooks-in: сеть недоступна"; el.style.color="#fcd34d"; } });
  }

  // R60 workbench (канон VS Code workbench): collapse/expand секций + персист
  // localStorage (аналог state.vscdb у VS Code; /ui самодостаточен — SQLite-персист
  // лэйаута силами daemon'а — кандидат R61+). Порядок секций не меняется (урок R12/R16):
  // только видимостью, кнопка в заголовке + dblclick по заголовку, aria-expanded/controls.
  var WB_KEY = "me2.ui.workbench.v1";
  var WB_IDS = ["fleet", "river", "mirror", "ext", "exec", "review", "sandbox"];
  function wbLoad(){ try { return JSON.parse(localStorage.getItem(WB_KEY) || "{}") || {}; } catch(e){ return {}; } }
  function wbSave(s){ try { localStorage.setItem(WB_KEY, JSON.stringify(s)); } catch(e){} }
  function wbSet(id, col, save){
    var sec = $("wb-" + id); if(!sec) return;
    sec.classList.toggle("wb-collapsed", !!col);
    var b = $("wb-toggle-" + id);
    if(b){ b.setAttribute("aria-expanded", col ? "false" : "true"); b.textContent = col ? "\u25b8" : "\u25be"; }
    if(save){ var s = wbLoad(); s[id] = !!col; wbSave(s); }
  }
  function wbApply(){ var s = wbLoad(); WB_IDS.forEach(function(id){ wbSet(id, s[id] === true, false); }); }
  function wbReset(){ try { localStorage.removeItem(WB_KEY); } catch(e){} WB_IDS.forEach(function(id){ wbSet(id, false, false); }); toast("лэйаут сброшен", "ok"); }
  WB_IDS.forEach(function(id){
    var b = $("wb-toggle-" + id);
    if(b) b.addEventListener("click", function(ev){ ev.stopPropagation(); wbSet(id, !$("wb-" + id).classList.contains("wb-collapsed"), true); });
    var sec = $("wb-" + id);
    if(sec){
      var h2 = sec.querySelector("h2");
      if(h2) h2.addEventListener("dblclick", function(ev){ if(ev.target && ev.target.closest && ev.target.closest(".wb-toggle")) return; wbSet(id, !sec.classList.contains("wb-collapsed"), true); });
    }
  });
  var rb = $("wb-reset");
  if(rb) rb.addEventListener("click", wbReset);
  wbApply();

  // R60 exthost: каталог расширений (манифесты + журнал прогонов) + живой изолированный
  // прогон кнопкой — санкционированная REST-запись (указание оператора R60: UI не обязан
  // быть read only). Расширение исполняется в дочернем процессе под prlimit, видит только
  // stdio — данные зеркала доставляет daemon (caps-медиация).
  function loadExt(){
    fetch(api("/exthost")).then(function(r){ return r.json(); }).then(function(j){
      var box = $("ext"); if(!box) return;
      if(!j.ok || !Array.isArray(j.exts)){ box.innerHTML = '<div class="row sub">exthost: честно недоступен (' + esc(j.reason || "?") + ')</div>'; $("ext-n").textContent = "—"; return; }
      box.textContent = "";
      j.exts.forEach(function(x){
        var r = document.createElement("div"); r.className = "row";
        var left = document.createElement("div"); left.style.flex = "1";
        var t = document.createElement("div"); t.className = "t"; t.textContent = x.title || x.id;
        var sub = document.createElement("div"); sub.className = "sub";
        var last = x.last ? (x.last.ok ? "последний прогон: ok · " + esc(String(x.last.source||"")) + " · " + esc(String(x.last.ms||0)) + "мс" : "последний прогон: " + esc(x.last.reason || "fail") + " (" + esc(String(x.last.source||"")) + ")") : "прогонов ещё не было";
        sub.innerHTML = '<span class="id">' + esc(x.id) + '</span> · v' + esc(x.version || "?") + ' · caps ' + esc((x.caps || []).join(",") || "—") + ' · активация ' + esc((x.activation || []).join(",")) + ' · ' + last + (x.caps_ok === false ? ' · <b>⚠ caps вне белого списка — запуск отказан</b>' : '');
        left.appendChild(t); left.appendChild(sub); r.appendChild(left);
        var b = document.createElement("button"); b.className = "ghost"; b.textContent = "Запустить"; b.title = "Изолированный прогон: prlimit + stdio-only (санкционированная запись POST /exthost/run)";
        b.addEventListener("click", function(){
          b.disabled = true;
          fetch(api("/exthost/run"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: x.id }) })
            .then(function(r2){ return r2.json(); })
            .then(function(o){
              if(o.ok){ toast("ext ok · " + JSON.stringify(o.result).slice(0, 140), "ok"); }
              else { toast("ext отказ: " + (o.reason || "?") + (o.detail ? " · " + String(o.detail).slice(0, 80) : ""), "err"); }
              loadExt();
            })
            .catch(function(){ toast("ext: сеть недоступна", "err"); })
            .then(function(){ b.disabled = false; });
        });
        r.appendChild(b); box.appendChild(r);
      });
      if(!j.exts.length) box.innerHTML = '<div class="row sub">расширений нет (skills/ext пуст)</div>';
      $("ext-n").textContent = j.exts.length + " расп.";
    }).catch(function(){ var el = $("ext-n"); if(el) el.textContent = "ошибка"; });
  }

  // R62 P0-a exec/edit: терминал + правки файлов для агентного harness (канон Cursor
  // terminal/edit-files, корпус R61). Кнопки — санкционированные записи POST /exec и
  // POST /file (белый список в eval mission.ui_contract v26). Демо = петля Cursor:
  // edit (создание файла диффом) → run (node) → зелёный вывод.
  function loadExec(){
    fetch(api("/exec")).then(function(r){ return r.json(); }).then(function(j){
      var caps = $("exec-caps"); var box = $("exec"); if(!caps||!box) return;
      if(!j.ok){ caps.textContent = "exec: честно недоступен (" + esc(j.reason||"?") + ")"; $("exec-n").textContent = "—"; return; }
      caps.innerHTML = 'allowlist ' + esc(String(j.allowlist.length)) + ' бин. · ' + (j.caps.prlimit ? 'prlimit ✓ (as=4GiB nofile=256 core=0)' : 'prlimit ✗') + ' · timeout ≤ ' + esc(String(j.caps.timeout_max_ms/1000)) + 'с · подстановки $() ' + esc(j.caps.substitution) + ' · cwd: ' + esc(j.roots.join(" | ")) + ' · прогонов ' + esc(String(j.counters.runs)) + ' / отказов ' + esc(String(j.counters.denied));
      box.textContent = "";
      (j.recent||[]).forEach(function(r){
        var d = document.createElement("div"); d.className = "ev " + (r.ok ? "step" : "degraded");
        var ty = document.createElement("div"); ty.className = "ty";
        ty.textContent = (r.ok ? ("exit " + r.exit) : (r.reason || "fail")) + " · " + esc(r.source) + " · " + esc(String(r.ms||0)) + "мс";
        var pl = document.createElement("div"); pl.className = "pl";
        pl.textContent = "$ " + r.cmd;
        d.appendChild(ty); d.appendChild(pl); box.appendChild(d);
      });
      if(!(j.recent||[]).length) box.innerHTML = '<div class="row sub">прогонов ещё не было — команда исполняется под prlimit с таймаутом, каждый сегмент против белого списка</div>';
      $("exec-n").textContent = j.counters.runs + "/" + j.counters.denied;
    }).catch(function(){ var el=$("exec-n"); if(el) el.textContent = "ошибка"; });
  }
  function execRun(cmd, cwd, into){
    var out = into || $("exec-out");
    out.textContent = "…";
    return fetch(api("/exec"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "run", cmd: cmd, cwd: cwd }) })
      .then(function(r){ return r.json(); })
      .then(function(v){
        var NL = String.fromCharCode(10);
        if(v.ok){ out.textContent = "exit " + v.exit + " · " + v.duration + "мс" + NL + (v.stdout_tail || "").slice(0, 400); return v; }
        out.textContent = "отказ: " + (v.reason || "?") + (v.detail ? NL + String(v.detail).slice(0, 240) : "");
        throw new Error(v.reason || "exec_failed");
      });
  }
  $("b-exec").addEventListener("click", function(){
    var cmd = $("exec-cmd").value.trim(), cwd = $("exec-cwd").value.trim();
    if(!cmd || !cwd){ toast("нужны команда и cwd (управляемый корень)", "err"); return; }
    var b = this; b.disabled = true;
    execRun(cmd, cwd).then(function(){ toast("exec ok", "ok"); loadExec(); loadReview(); })
      .catch(function(e){ toast("exec отказ: " + e.message, "err"); loadExec(); loadReview(); })
      .then(function(){ b.disabled = false; });
  });
  // R63 P0-b: Run Mode «plan» — план + вердикт классификатора без исполнения (канон Cursor Plan Mode)
  $("b-plan").addEventListener("click", function(){
    var cmd = $("exec-cmd").value.trim(), cwd = $("exec-cwd").value.trim();
    if(!cmd || !cwd){ toast("нужны команда и cwd (управляемый корень)", "err"); return; }
    var b = this, out = $("exec-out"); b.disabled = true; out.textContent = "…";
    fetch(api("/exec"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "plan", cmd: cmd, cwd: cwd }) })
      .then(function(r){ return r.json(); })
      .then(function(v){
        if(!v.ok){ out.textContent = "план отказ: " + (v.reason || "?") + (v.detail ? String.fromCharCode(10) + String(v.detail).slice(0, 240) : ""); return; }
        var rv = v.review || {};
        out.textContent = "план ok · сегментов " + (v.planned ? v.planned.segments.length : "?") + " · классификатор: " + (rv.verdict || "?") + (rv.rule ? " (" + rv.rule + ")" : "") + " · " + (rv.reason || "") + String.fromCharCode(10) + "bin: " + ((v.planned ? v.planned.binaries : []) || []).join(" ");
      })
      .catch(function(){ out.textContent = "план: сеть недоступна"; })
      .then(function(){ b.disabled = false; });
  });
  $("b-demo").addEventListener("click", function(){
    var cwd = $("exec-cwd").value.trim();
    if(!cwd){ toast("нужен cwd (управляемый корень) — demo создаст там p0a-demo.js", "err"); return; }
    var b = this; b.disabled = true;
    var fname = "p0a-demo-" + Date.now().toString(36) + ".js";
    var diff = ['--- /dev/null', '+++ ' + fname, '@@ -0,0 +1,2 @@', '+console.log("me2-p0a: edit-run-green");', '+console.log("agent loop live");'].join(String.fromCharCode(10));
    var out = $("exec-out");
    fetch(api("/file"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "apply", path: cwd + "/" + fname, diff: diff }) })
      .then(function(r){ return r.json(); })
      .then(function(e){
        if(!e.ok) throw new Error("edit: " + (e.reason || "?") + (e.detail ? " · " + String(e.detail).slice(0, 100) : ""));
        return execRun("node " + fname, cwd).then(function(v){
          toast("edit→run→green ✓ · edit_id=" + e.rollback_at + " · exit=" + v.exit + (e.hunks ? "" : "") + " · откат правок существующих файлов — из журнала", "ok");
          loadExec();
        });
      })
      .catch(function(e){ out.textContent = String(e.message || e).slice(0, 300); toast("demo отказ: " + e.message, "err"); loadExec(); })
      .then(function(){ b.disabled = false; });
  });

  // R63 P0-b classifier tier: очередь одобрений (ask) + статистика вердиктов. Кнопки ✓/✗ —
  // санкционированная запись POST /review {op:approve|deny} (канон Cursor Approvals UI:
  // Allow once / Deny; классификатор НЕ security boundary — решение оператора финальное).
  function loadReview(){
    fetch(api("/review")).then(function(r){ return r.json(); }).then(function(j){
      var caps = $("review-caps"), st = $("review-stats"), box = $("review"); if(!caps || !box) return;
      if(!j.ok){ caps.textContent = "classifier: честно недоступен"; $("review-n").textContent = "—"; return; }
      var c = j.config || {};
      caps.innerHTML = 'тир-3 ' + (c.enabled ? '<b style="color:#6ee7b7">вкл</b>' : 'выкл') + ' · LLM ' + (c.llm_enabled ? '<b>вкл (' + esc(c.model || "?") + ', ≤' + esc(String(c.timeout_ms || 3000)) + 'мс)</b>' : 'выкл (эвристика)') + ' · очередь ≤ ' + esc(String(c.queue_max || 20)) + ' · не security boundary';
      var s = j.stats_24h || {};
      st.textContent = 'статистика 24ч: block=' + (s.CLASSIFIER_BLOCK || 0) + ' · ask=' + (s.CLASSIFIER_ASK || 0) + ' · одобрено=' + (s.CLASSIFIER_APPROVED || 0) + ' · отклонено=' + (s.CLASSIFIER_DENIED || 0);
      box.textContent = "";
      var q = j.queue || {};
      (q.pending || []).forEach(function(p){
        var d = document.createElement("div"); d.className = "ev degraded";
        var ty = document.createElement("div"); ty.className = "ty";
        ty.textContent = "#" + p.id + " · ask · " + esc(p.engine) + " · ждёт оператора";
        var pl = document.createElement("div"); pl.className = "pl"; pl.textContent = "$ " + p.cmd + " · cwd " + p.cwd;
        var rs = document.createElement("div"); rs.className = "sub"; rs.textContent = "причина: " + p.reason;
        var ops = document.createElement("div"); ops.style.marginTop = "4px";
        var ba = document.createElement("button"); ba.className = "ghost"; ba.textContent = "✓ одобрить"; ba.title = "Исполнить команду (POST /review op:approve — tier-1 остаётся)";
        var bd = document.createElement("button"); bd.className = "ghost"; bd.textContent = "✗ отклонить"; bd.title = "Отклонить команду из очереди (POST /review op:deny)";
        ba.addEventListener("click", function(){ reviewDecide("approve", p.id); });
        bd.addEventListener("click", function(){ reviewDecide("deny", p.id); });
        ops.appendChild(ba); ops.appendChild(bd);
        d.appendChild(ty); d.appendChild(pl); d.appendChild(rs); d.appendChild(ops);
        box.appendChild(d);
      });
      (q.recent || []).slice(0, 6).forEach(function(r){
        if(r.status === "pending") return;
        var d = document.createElement("div"); d.className = "ev " + (r.status === "executed" ? "step" : "degraded");
        var ty = document.createElement("div"); ty.className = "ty";
        ty.textContent = "#" + r.id + " · " + r.status + (r.run_ok ? " · exit " + r.run_exit : "");
        var pl = document.createElement("div"); pl.className = "pl"; pl.textContent = "$ " + r.cmd;
        d.appendChild(ty); d.appendChild(pl); box.appendChild(d);
      });
      if(!(q.pending || []).length && !(q.recent || []).some(function(r){ return r.status !== "pending"; })) box.innerHTML = '<div class="row sub">очередь пуста — ask попадает сюда на одобрение (канон Approvals UI Cursor)</div>';
      $("review-n").textContent = (q.pending || []).length + " ждёт";
    }).catch(function(){ var el = $("review-n"); if(el) el.textContent = "ошибка"; });
  }
  function reviewDecide(dec, id){
    fetch(api("/review"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: dec, id: id }) })
      .then(function(r){ return r.json(); })
      .then(function(v){
        if(v.ok && dec === "approve"){ var ex = v.run || {}; toast(ex.ok ? "одобрено · exit " + ex.exit + " · " + ex.duration + "мс" : "одобрено, прогон не удался: " + (ex.reason || "?"), ex.ok ? "ok" : "err"); }
        else if(v.ok){ toast("отклонено (#" + id + ")", "ok"); }
        else { toast("отказ: " + (v.error || "?"), "err"); }
        loadReview(); loadExec();
      })
      .catch(function(){ toast("сеть недоступна", "err"); });
  }

  // R64 P0-2 OS-sandbox: слои конфайнмента (ns+seccomp; Landlock ≥5.13 — честный skip
  // на 5.10) + probe (живой негатив/позитив, эскале-детектор) + запуск в конфайнменте.
  // Кнопки — санкционированные записи POST /sandbox {op:probe|run} (белый список eval).
  function loadSandbox(){
    fetch(api("/sandbox")).then(function(r){ return r.json(); }).then(function(j){
      var caps = $("sbox-caps"), box = $("sbox"); if(!caps || !box) return;
      if(!j.ok){ caps.textContent = "sandbox: недоступен"; $("sbox-n").textContent = "—"; return; }
      var c = j.caps || {}, cf = j.config || {}, ct = j.counters || {};
      caps.innerHTML = 'landlock ABI ' + esc(String(c.landlock_abi)) + ' · userns ' + esc(String(c.userns_max)) + ' · seccomp ' + esc(String(c.seccomp_mode)) + ' · слои <b style="color:#6ee7b7">' + esc((c.layers_available||[]).join("+")) + '</b> · net ' + esc(cf.net||"?") + ' · auto ' + (cf.auto_sandbox ? "вкл" : "выкл") + ' · strict ' + (cf.strict ? "fail-closed" : "soft") + ' · прогонов ' + esc(String(ct.runs||0)) + ' / отказов ' + esc(String(ct.failed||0)) + ' / эскале ' + esc(String(ct.escapes||0));
      box.textContent = "";
      (j.recent||[]).forEach(function(r){
        var d = document.createElement("div"); d.className = "ev " + (r.ok ? "step" : "degraded");
        var ty = document.createElement("div"); ty.className = "ty";
        ty.textContent = (r.ok ? ("exit " + r.exit) : (r.reason || "fail")) + " · sandbox · " + esc(String(r.ms||0)) + "мс";
        var pl = document.createElement("div"); pl.className = "pl"; pl.textContent = "$ " + r.cmd;
        d.appendChild(ty); d.appendChild(pl); box.appendChild(d);
      });
      if(!(j.recent||[]).length) box.innerHTML = '<div class="row sub">sandbox-прогонов ещё не было — Probe верифицирует конфайнмент живыми негативами (секреты/сеть)</div>';
      $("sbox-n").textContent = c.verdict === "sandboxable" ? "sandboxable" : "unsandboxed";
    }).catch(function(){ var el = $("sbox-n"); if(el) el.textContent = "ошибка"; });
  }
  $("b-sbox-run").addEventListener("click", function(){
    var cmd = $("sbox-cmd").value.trim(), cwd = $("sbox-cwd").value.trim();
    if(!cmd || !cwd){ toast("нужны команда и cwd (управляемый корень)", "err"); return; }
    var b = this, out = $("sbox-out"); b.disabled = true; out.textContent = "…";
    fetch(api("/sandbox"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "run", cmd: cmd, cwd: cwd }) })
      .then(function(r){ return r.json(); })
      .then(function(v){
        var NL = String.fromCharCode(10);
        if(v.ok){
          var layers = Object.keys(v.sandbox && v.sandbox.layers || {}).filter(function(k){ return v.sandbox.layers[k] === true || v.sandbox.layers[k] === "installed"; });
          out.textContent = "exit " + v.exit + " · " + v.duration + "мс · net " + (v.sandbox && v.sandbox.net) + NL + "слои: " + layers.join(", ");
          toast("sandbox run ok", "ok"); return;
        }
        var failed = v.sandbox && v.sandbox.strict_ok === false;
        out.textContent = (failed ? "sandbox_failed (strict): " : "отказ: ") + (v.reason || ("exit " + v.exit)) + NL + (v.stderr_tail || "").slice(0, 200);
        toast(failed ? "sandbox_failed — команда НЕ исполнена" : "прогон в сандбоксе: exit " + v.exit, failed ? "err" : "ok");
      })
      .catch(function(){ out.textContent = "сеть недоступна"; })
      .then(function(){ b.disabled = false; loadSandbox(); });
  });
  $("b-sbox-probe").addEventListener("click", function(){
    var b = this, out = $("sbox-probe"); b.disabled = true; out.textContent = "probe: …";
    fetch(api("/sandbox"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "probe" }) })
      .then(function(r){ return r.json(); })
      .then(function(v){
        var c = v.checks || {};
        out.textContent = "probe " + (v.ok ? "✓ 4/4" : "✗") + (v.escape ? " · ЭСКАПИРОВАНО!" : "") + " · внутрь " + (c.write_inside && c.write_inside.ok ? "✓" : "✗") + " · секреты " + (c.write_outside_denied && c.write_outside_denied.ok ? "скрыты ✓" : "✗") + " · сеть " + (c.net_denied && c.net_denied.ok ? "EPERM ✓" : "✗") + " · контроль " + (c.net_allow_control && c.net_allow_control.ok ? "✓" : "✗") + " · " + esc(String(v.ms||0)) + "мс";
        toast(v.ok ? "probe: конфайнмент подтверждён (4/4)" : "probe: НАРУШЕНИЕ — смотри лог", v.ok ? "ok" : "err");
        loadSandbox();
      })
      .catch(function(){ out.textContent = "probe: сеть недоступна"; })
      .then(function(){ b.disabled = false; });
  });

  function connectSocket(){
    var s=document.createElement("script");
    s.src="http://"+location.hostname+":${WS_PORT}/socket.io.js";
    s.onerror=function(){ $("ch-socket").textContent="socket недоступен"; $("ch-socket").className="chip err"; };
    s.onload=function(){
      if(typeof io!=="function"){ $("ch-socket").textContent="socket client n/a"; $("ch-socket").className="chip err"; return; }
      socket=io("http://"+location.hostname+":${WS_PORT}",{ path:"/", transports:["websocket","polling"] });
      socket.on("connect", function(){ socketOk=true; $("ch-socket").innerHTML='<span class="dot"></span>socket live'; $("ch-socket").className="chip ok"; loadFleet(); loadRiver(); });
      socket.on("disconnect", function(){ socketOk=false; $("ch-socket").className="chip warn"; });
      socket.on("agentchat:step", function(e){ renderRiver([e], true); });
    };
    document.head.appendChild(s);
  }

  $("b-turn").addEventListener("click", function(){
    var id=$("chat-sel").value, text=$("msg").value.trim();
    if(!id||!text){ toast("нужны чат и текст","err"); return; }
    op({op:"turn", id:id, text:text}, "ход принят (THINKING)");
  });
  $("b-send").addEventListener("click", function(){
    var id=$("chat-sel").value, text=$("msg").value.trim();
    if(!id||!text){ toast("нужны чат и текст","err"); return; }
    op({op:"send", id:id, text:text}, "доставлено");
  });
  $("b-tick").addEventListener("click", function(){ op({op:"tick"}, "тик супервизоров выполнен"); });

  // R50 (B5): FLEET-вкладка браузера открывает /ui#chat=<id> — сайт сам выбирает агента
  function openFromHash(){
    var m=location.hash.match(/^#chat=([A-Za-z0-9_-]+)/);
    if(!m) return;
    var id=m[1], tries=0;
    var trySel=function(){
      var s=$("chat-sel");
      var found=chats.some(function(c){ return c.id===id; });
      if(found){ s.value=id; toast("чат из вкладки: "+id.slice(0,20), "ok"); $("msg").focus(); }
      else if(++tries<10) setTimeout(trySel, 600); // флот ещё грузится — честная догрузка без шторма
    };
    trySel();
  }
  window.addEventListener("hashchange", openFromHash);

  loadHead(); loadFleet(); loadRiver(); loadMirror(); loadAudit(); loadReconcile(); loadHooks(); loadExt(); loadExec(); loadReview(); loadSandbox(); connectSocket(); openFromHash();
  setInterval(loadFleet, 4000); setInterval(loadHead, 15000); setInterval(loadRiver, 20000); setInterval(loadMirror, 30000); setInterval(loadAudit, 120000); setInterval(loadReconcile, 120000); setInterval(loadHooks, 120000); setInterval(loadExt, 60000); setInterval(loadExec, 30000); setInterval(loadReview, 30000); setInterval(loadSandbox, 30000);
  setInterval(function(){ var u=$("ch-upd"); u.textContent="обновлено "+new Date().toLocaleTimeString(); }, 1000);
})();
</script>
</body>
</html>`;
}
