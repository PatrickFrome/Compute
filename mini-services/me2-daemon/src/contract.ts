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
      read: ["/health", "/state", "/agentchat", "/agentchat/:id", "/agentchat/:id/status", "/events", "/tokens", "/evidence", "/eval", "/sqlmirror", "/sqlmirror/ui-token"],
      write: ["/tokens {op:set|delete}", "/policy", "/demand", "/cron"],
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
// с самого daemon'а (:3040, path "/"); данные — read-only REST того же origin.
// Операторские ходы — через socket agentchat:op (ack), REST-операций не существует.
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
  section h2 { margin:0; padding:10px 14px; font-size:12.5px; font-weight:600; color:#d4d4d8; letter-spacing:.4px; text-transform:uppercase; border-bottom:1px solid #27272a; display:flex; gap:8px; align-items:center; }
  section h2 .n { margin-left:auto; color:#71717a; font-weight:500; text-transform:none; }
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
</header>
<main>
  <section aria-label="Флот чат-агентов">
    <h2>Флот <span class="n" id="fleet-n">—</span></h2>
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
  </section>
  <section aria-label="Река событий">
    <h2>Река <span class="n" id="river-n">—</span></h2>
    <div class="scroll" id="river" data-testid="mc-river" aria-live="polite"></div>
  </section>
  <section aria-label="SQL-зеркало с гейтом RLS" style="grid-column:1/-1">
    <h2>Зеркало SQL (Supabase · RLS) <span class="n" id="mirror-n">—</span></h2>
    <div class="scroll" id="mirror" data-testid="mc-mirror" style="max-height:32vh" aria-live="polite"></div>
  </section>
</main>
<footer>self-contained · 0 сборки · 0 внешних зависимостей · socket.io с daemon'а (:${WS_PORT}, path "/") · данные — read-only REST</footer>
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
    // R53: чтение SQL-зеркала из UI с гейтом RLS — короткоживущий JWT (120с) от daemon'а;
    // authenticated читает, anon-проба должна получить пусто/401 (fail-closed). Без долгоживущих ключей в UI.
    fetch(api("/sqlmirror/ui-token")).then(function(r){ return r.json(); }).then(function(j){
      var box=$("mirror");
      if(!j.ok){ box.innerHTML='<div class="row sub">RLS-канал честно недоступен: '+esc(j.reason)+" · зеркало state="+esc(j.mirror_state||"?")+" (секрет JWT не в vault'е)</div>"; $("mirror-n").textContent="канал n/a"; return; }
      var req=function(tok){
        return fetch(j.rest+"/"+j.table+"?select=seq,ts,type,actor,subject&order=seq.desc&limit=12", {headers:{apikey:tok,Authorization:"Bearer "+tok}})
          .then(function(r){ return r.text().then(function(t){ return {code:r.status,body:t}; }); });
      };
      Promise.all([req(j.token), req(j.anon_token)]).then(function(rs){
        var auth=rs[0], anon=rs[1];
        var rows=null; try { rows=JSON.parse(auth.body); } catch(e){}
        var anonRows=null; try { anonRows=JSON.parse(anon.body); } catch(e){}
        var leak=anon.code===200 && Array.isArray(anonRows) && anonRows.length>0;
        var html='<div class="row sub">state='+esc(j.mirror_state)+" · "+esc(j.table)+" · канал "+esc(j.channel||"?")+(j.ttl?" · ttl "+j.ttl+"с":"")+" · гейт RLS: строки видны только по политикам sql/0003</div>";
        if(auth.code===404){ html+='<div class="row sub">таблица отсутствует в облаке — миграции sql/0001..0003 не применены (WARMUP: зеркалирование ждёт DDL)</div>'; }
        else if(auth.code===401||auth.code===403){ html+='<div class="row sub">облако отвергло read-канал (401/403) — нужен sb_publishable_… ключ (vault SUPABASE_PUBLISHABLE_KEY) или включённые legacy JWT-ключи</div>'; }
        else if(Array.isArray(rows)){ html+=rows.map(function(r){ return '<div class="ev"><div class="ty">'+esc(r.type)+" · seq "+esc(r.seq)+" · "+esc(r.actor||"daemon")+(r.subject?" · "+esc(String(r.subject).slice(0,28)):"")+'</div><div class="pl">'+ago(r.ts)+" назад</div></div>"; }).join("")||'<div class="row sub">зеркало живо, строк пока нет</div>'; }
        else html+='<div class="row sub">неожиданный ответ зеркала: '+esc(String(auth.body).slice(0,120))+"</div>";
        html+='<div class="row sub">'+(leak?"⚠ anon ПРОЧИТАЛ строки — RLS-гейт НЕ работает (проверить sql/0003)":"RLS-гейт: anon → код "+anon.code+" "+esc(String(anon.body).slice(0,50))+" — fail-closed ✓")+"</div>";
        box.innerHTML=html;
        $("mirror-n").textContent=Array.isArray(rows)?(rows.length+" строк(и)"):"—";
      }).catch(function(){ $("mirror-n").textContent="ошибка облака"; });
    }).catch(function(){ $("mirror-n").textContent="ошибка"; });
  }

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

  loadHead(); loadFleet(); loadRiver(); loadMirror(); connectSocket(); openFromHash();
  setInterval(loadFleet, 4000); setInterval(loadHead, 15000); setInterval(loadRiver, 20000); setInterval(loadMirror, 30000);
  setInterval(function(){ var u=$("ch-upd"); u.textContent="обновлено "+new Date().toLocaleTimeString(); }, 1000);
})();
</script>
</body>
</html>`;
}
