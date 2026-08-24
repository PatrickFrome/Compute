const qs = new URLSearchParams(location.search);
const workspace = qs.get("workspace_id") || "063e3923-ef85-4226-9843-861ad4ec5a21";
const state = { events: [], byId: /* @__PURE__ */ new Map(), frontier: 0, filter: "ALL", selected: null, agents: { GPT: { startedAt: 0, lastSeen: 0, model: "", gap: 0 }, GLM: { startedAt: 0, lastSeen: 0, model: "", gap: 0 } }, authority: {}, semanticPoint: "—", mode: "COLLABORATE", conflict: "none", duel: "idle" };
const $ = (id) => document.getElementById(id);
$("workspaceLabel").textContent = workspace;
function text(v, f = "—") {
  return v === void 0 || v === null || v === "" ? f : String(v);
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function short(v, n = 12) {
  const s = text(v, "");
  return s.length > n ? s.slice(0, n) + "…" : s;
}
function payload(e) {
  return e && e.payload && typeof e.payload === "object" ? e.payload : {};
}
function summary(e) {
  const p = payload(e);
  for (const k of ["claim", "summary", "reasoning_summary", "message", "result", "question", "hypothesis", "plan"]) {
    const v = p[k];
    if (Array.isArray(v) && v.length) return v.map(String).join(" · ");
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  if (e.event_type === "TOOL_CALL") return text(p.tool || p.name, "tool call");
  if (e.event_type === "TOOL_RESULT") return text(p.summary || p.result_code, "tool result");
  return text(p.kind || p.status || e.event_type, "event");
}
function cls(e) {
  if (e.stale_frontier) return " stale";
  return "";
}
function category(e) {
  const t = text(e.event_type);
  if (/TOOL|FILE|PATCH|TEST/.test(t)) return "TOOLS";
  if (/EVIDENCE|ASSUMPTION|FALSIFIER|AUTHORITY/.test(t)) return "EVIDENCE";
  return "COGNITION";
}
function visible(e) {
  return state.filter === "ALL" || category(e) === state.filter;
}
function eventCard(e) {
  return `<article class="event-card${cls(e)}" data-event-id="${esc(e.event_id)}" data-agent="${esc(e.agent_id || e.agent || "SYSTEM")}"><div class="meta"><span class="etype">${esc(e.event_type)}</span><span>#${esc(e.commit_seq)}</span></div><div class="body">${esc(summary(e))}</div></article>`;
}
function renderAgents() {
  for (const agent of ["GPT", "GLM"]) {
    const events = state.events.filter((e) => (e.agent_id || e.agent) === agent && visible(e)).slice(-80).reverse();
    $(agent.toLowerCase() + "Stream").innerHTML = events.map(eventCard).join("") || '<div class="label">no committed events</div>';
    const a = state.agents[agent];
    $(agent.toLowerCase() + "Seen").textContent = `seen ${a.lastSeen || 0}`;
    $(agent.toLowerCase() + "Lag").textContent = `lag ${Math.max(0, state.frontier - (a.lastSeen || 0))}`;
    $(agent.toLowerCase() + "Frontier").textContent = `frontier ${a.lastSeen || 0}`;
    $(agent.toLowerCase() + "Model").textContent = a.model || "exact model pending";
  }
}
function renderTimeline() {
  const list = state.events.filter(visible).slice(-240);
  $("timeline").innerHTML = list.map((e) => {
    const agent = (e.agent_id || e.agent) === "GLM" ? "glm" : "gpt";
    const special = e.event_type === "SEMANTIC_CONFLICT" ? " conflict" : /DUEL/.test(text(e.event_type)) ? " duel" : "";
    return `<div class="timeline-row ${agent}${special}"><div class="timeline-card" data-event-id="${esc(e.event_id)}"><div class="tmeta">${esc(text(e.agent_id || e.agent))} · ${esc(short(e.event_hash, 10))}</div><div class="ttype">${esc(e.event_type)}</div><div class="ttext">${esc(summary(e))}</div></div><div class="seq"><span>${esc(e.commit_seq)}</span></div></div>`;
  }).join("") || '<div class="label">waiting for causal events</div>';
}
function renderHeader() {
  $("frontierBadge").textContent = `seq ${state.frontier || 0}`;
  $("semanticPoint").textContent = state.semanticPoint;
  $("mode").textContent = state.mode;
  $("conflictState").textContent = state.conflict;
  $("duelState").textContent = state.duel;
  const a = state.authority || {};
  $("authorityCheckpoint").textContent = short(a.checkpoint_id || a.semantic_checkpoint_id, 22);
  $("authorityGit").textContent = short(a.git_main_sha || a.github_sha, 16);
  $("authorityClaim").textContent = text(a.claim || a.claim_id) + " / " + text(a.directive || a.directive_id);
  $("executionCandidate").textContent = text(a.execution_candidate, "none");
  $("executorState").textContent = text(a.executor_state, "idle");
}
function render() {
  renderHeader();
  renderAgents();
  renderTimeline();
  bindCards();
}
function bindCards() {
  document.querySelectorAll("[data-event-id]").forEach((el) => el.onclick = () => openInspector(state.byId.get(el.dataset.eventId)));
}
function ingest(raw) {
  if (!raw || typeof raw !== "object" || !raw.event_id) return;
  if (state.byId.has(raw.event_id)) return;
  const seq = Number(raw.commit_seq || 0);
  state.frontier = Math.max(state.frontier, seq);
  state.events.push(raw);
  state.events.sort((a, b) => Number(a.commit_seq || 0) - Number(b.commit_seq || 0));
  state.byId.set(raw.event_id, raw);
  const agent = raw.agent_id || raw.agent;
  if (agent === "GPT" || agent === "GLM") {
    state.agents[agent].lastSeen = Math.max(state.agents[agent].lastSeen, Number(raw.seen_commit_seq || raw.commit_seq || 0));
    if (raw.model_provenance?.requested_model) state.agents[agent].model = raw.model_provenance.requested_model;
    if (raw.event_type === "MODEL_STARTED") state.agents[agent].startedAt = Date.parse(raw.created_at || (/* @__PURE__ */ new Date()).toISOString());
    if (raw.event_type === "MODEL_COMPLETED" || raw.event_type === "MODEL_INTERRUPTED") state.agents[agent].startedAt = 0;
  }
  if (raw.semantic_point) state.semanticPoint = raw.semantic_point;
  if (raw.event_type === "SEMANTIC_CONFLICT") state.conflict = text(payload(raw).state, "open");
  if (/DUEL/.test(text(raw.event_type))) state.duel = text(payload(raw).state, raw.event_type);
  render();
}
async function snapshot() {
  try {
    const r = await fetch(`/a2/api/snapshot?workspace_id=${encodeURIComponent(workspace)}`, { credentials: "same-origin" });
    if (!r.ok) throw new Error(`snapshot ${r.status}`);
    const body = await r.json();
    for (const e of Array.isArray(body.events) ? body.events : []) ingest(e);
    state.authority = body.authority || {};
    state.semanticPoint = body.semantic_point || state.semanticPoint;
    state.mode = body.mode || state.mode;
    if (body.peers) {
      for (const a of ["GPT", "GLM"]) if (body.peers[a]) Object.assign(state.agents[a], body.peers[a]);
    }
    paintHealth("causalHealth", "CAUSAL — synced", "good");
    paintHealth("authorityHealth", body.authority?.fresh === false ? "AUTHORITY — stale" : "AUTHORITY — fresh", body.authority?.fresh === false ? "bad" : "good");
    render();
  } catch (e) {
    paintHealth("causalHealth", "CAUSAL — unavailable", "bad");
    toast(String(e));
  }
}
function connect() {
  const after = state.frontier || 0;
  const es = new EventSource(`/a2/api/events?workspace_id=${encodeURIComponent(workspace)}&after=${after}`);
  es.onopen = () => paintHealth("liveHealth", "LIVE — connected", "good");
  es.onmessage = (m) => {
    try {
      const e = JSON.parse(m.data);
      if (e.type === "heartbeat") return;
      ingest(e);
    } catch {
    }
  };
  es.onerror = () => {
    paintHealth("liveHealth", "LIVE — reconnecting", "warn");
    es.close();
    setTimeout(connect, 1200);
  };
}
function paintHealth(id, label, kind) {
  const el = $(id);
  el.textContent = label;
  el.classList.remove("good", "warn", "bad");
  el.classList.add(kind);
}
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2600);
}
async function openInspector(e) {
  if (!e) return;
  state.selected = e;
  $("inspector").classList.add("open");
  $("inspector").setAttribute("aria-hidden", "false");
  $("inspectTitle").textContent = `${e.event_type} · #${e.commit_seq}`;
  await renderInspector("why");
}
async function renderInspector(tab) {
  const e = state.selected;
  if (!e) return;
  document.querySelectorAll(".inspect-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  const p = payload(e), vp = e.visibility_proof || p.visibility_proof || {}, mp = e.model_provenance || p.model_provenance || {};
  let html = "";
  if (tab === "why") {
    html = `<div class="inspect-section"><h4>Public reasoning</h4><pre>${esc(summary(e))}</pre></div><div class="inspect-section"><h4>Causal parents</h4><pre>${esc(JSON.stringify(e.parent_hashes || [], null, 2))}</pre></div>`;
    try {
      const r = await fetch(`/a2/api/events/${encodeURIComponent(e.event_id)}/ancestry`);
      if (r.ok) {
        const a = await r.json();
        html += `<div class="inspect-section"><h4>Ancestry</h4><pre>${esc(JSON.stringify(a, null, 2))}</pre></div>`;
      }
    } catch {
    }
  } else if (tab === "seen") {
    html = `<div class="inspect-section"><h4>Visibility proof</h4><div class="kv"><span>input frontier</span><span class="mono">${esc(text(vp.input_frontier_hash))}</span><span>seen commit seq</span><span>${esc(text(vp.seen_commit_seq))}</span><span>seen GPT seq</span><span>${esc(text(vp.seen_gpt_seq))}</span><span>seen GLM seq</span><span>${esc(text(vp.seen_glm_seq))}</span><span>context manifest</span><span class="mono">${esc(text(vp.context_manifest_sha256))}</span><span>stale frontier</span><span>${esc(text(e.stale_frontier, false))}</span></div></div><div class="inspect-section"><h4>Mandatory peer events included</h4><pre>${esc(JSON.stringify(vp.mandatory_peer_event_hashes || [], null, 2))}</pre></div>`;
  } else if (tab === "evidence") {
    html = `<div class="inspect-section"><h4>Evidence / assumptions / falsifiers</h4><pre>${esc(JSON.stringify({ evidence: p.evidence_used || p.evidence, assumptions: p.assumptions, falsifier: p.falsifier, tests: p.tests_required }, null, 2))}</pre></div>`;
  } else if (tab === "tool") {
    html = `<div class="inspect-section"><h4>Tool I/O</h4><pre>${esc(JSON.stringify({ tool: p.tool, arguments: p.arguments, input: p.input, result: p.result, error: p.error }, null, 2))}</pre></div>`;
  } else {
    html = `<div class="inspect-section"><h4>Hashes</h4><div class="kv"><span>event</span><span class="mono">${esc(text(e.event_hash))}</span><span>payload</span><span class="mono">${esc(text(e.payload_sha256))}</span><span>parents</span><span class="mono">${esc((e.parent_hashes || []).join("\n"))}</span></div></div><div class="inspect-section"><h4>Trusted ingress receipt</h4><pre>${esc(JSON.stringify(e.ingress_receipt || { status: "legacy_or_unverified" }, null, 2))}</pre></div><div class="inspect-section"><h4>Model provenance</h4><pre>${esc(JSON.stringify(mp, null, 2))}</pre></div>`;
  }
  $("inspectBody").innerHTML = html;
}
document.querySelectorAll(".filters button").forEach((b) => b.onclick = () => {
  state.filter = b.dataset.filter;
  document.querySelectorAll(".filters button").forEach((x) => x.classList.toggle("active", x === b));
  render();
});
document.querySelectorAll(".inspect-tabs button").forEach((b) => b.onclick = () => renderInspector(b.dataset.tab));
$("closeInspector").onclick = () => {
  $("inspector").classList.remove("open");
  $("inspector").setAttribute("aria-hidden", "true");
};
setInterval(() => {
  const now = Date.now();
  for (const agent of ["GPT", "GLM"]) {
    const a = state.agents[agent];
    const gap = a.startedAt ? Math.max(0, now - a.startedAt) : 0;
    a.gap = gap;
    const el = $(agent.toLowerCase() + "Gap");
    el.textContent = `${gap} ms`;
    el.parentElement.classList.toggle("warn", gap >= 5e3 && gap < 15e3);
    el.parentElement.classList.toggle("bad", gap >= 15e3);
  }
}, 250);
await snapshot();
connect();
