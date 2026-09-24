/**
 * ME2 daemon — Approval-политики (R30, пункт C4 из research/2026/R24-AUDIT-ROADMAP.md §103).
 *
 * Замыкает C-линию производственного контура: C1 objectives → C2 handoffs → C3 reviewer
 * → **C4 approval** — ЕДИНОЕ место операторских гейтов на мутирующие операции:
 *
 *   fence_clear       — снятие durable fence (ME19; zero-authority: снимает только оператор);
 *   rsi_adopt         — принятие RSI-предложения в skills/ (ME8; авто-промоушен запрещён);
 *   authority_effect  — authority-операции уровня системы (selfupdate apply = смена живого кода).
 *
 * Принципы (наследуют философию ME2):
 *  - FAILS-CLOSED: неизвестный гейт → denied; нет политики → denied; нет согласия → denied.
 *    Дефолт всех политик — require_approval: новая мутирующая точка по умолчанию под гейтом.
 *  - ONE-ATTEMPT TOKEN: согласие расходуется (APPROVED → CONSUMED) — как durable fences,
 *    «никогда не разменивать exact identity на liveness»: один approve = одно исполнение.
 *  - TTL согласия 15 мин: оператор одобрил — операция должна случиться скоро, иначе EXPIRED.
 *  - ZERO-AUTHORITY: шина не получает новых действий (47/47) — гейты живут только в REST/UI.
 *  - Идемпотентные заявки: PENDING на (gate, subject) переиспользуется, спам не плодится.
 *
 * REST: GET /approvals, POST /approvals {op:request|approve|deny|policy} — вне шины. Механика ME27.
 */
import { db, emit, rid } from "../store";
import { recordSpan } from "./otel";

export const APPROVAL_GATES = ["fence_clear", "rsi_adopt", "authority_effect"] as const;
export type ApprovalGate = (typeof APPROVAL_GATES)[number];
export type ApprovalMode = "require_approval" | "auto_approve";
export type ApprovalStatus = "PENDING" | "APPROVED" | "DENIED" | "CONSUMED" | "EXPIRED";

const APPROVED_TTL_MS = 15 * 60 * 1000;   // согласие живёт 15 минут
const PENDING_TTL_MS = 24 * 60 * 60 * 1000; // заявка гаснет через сутки

db.exec(`
CREATE TABLE IF NOT EXISTS approval_policies (
  gate TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL DEFAULT 'system'
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  gate TEXT NOT NULL,
  subject TEXT NOT NULL,
  label TEXT NOT NULL,
  requested_by TEXT NOT NULL DEFAULT 'system',
  status TEXT NOT NULL DEFAULT 'PENDING',
  note TEXT,
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_approvals_gate ON approvals(gate, status, created_at);
CREATE INDEX IF NOT EXISTS idx_policies_gate ON approval_policies(gate);
`);

// Дефолт — fails-closed: все гейты требуют согласия (seed идемпотентный).
for (const g of APPROVAL_GATES) {
  db.query(`INSERT INTO approval_policies (gate, mode, updated_at, updated_by) VALUES (?,?,?,?)
    ON CONFLICT(gate) DO NOTHING`).run(g, "require_approval", Date.now(), "system_default");
}

export interface ApprovalPolicy { gate: string; mode: string; updated_at: number; updated_by: string }
export interface ApprovalRow {
  id: string; gate: string; subject: string; label: string; requested_by: string;
  status: ApprovalStatus; note: string | null; created_at: number; decided_at: number | null;
}

export interface GateDecision {
  allowed: boolean;
  reason: string;
  auto?: boolean;
  approval_id?: string;
  policy_mode?: ApprovalMode;
}

function getPolicy(gate: string): ApprovalPolicy | undefined {
  return db.query(`SELECT * FROM approval_policies WHERE gate=?`).get(gate) as ApprovalPolicy | undefined;
}

function findPending(gate: string, subject: string): ApprovalRow | undefined {
  return db.query(`SELECT * FROM approvals WHERE gate=? AND subject=? AND status='PENDING' ORDER BY created_at DESC LIMIT 1`)
    .get(gate, subject) as ApprovalRow | undefined;
}

function findApprovedToken(gate: string, subject: string): ApprovalRow | undefined {
  const row = db.query(`SELECT * FROM approvals WHERE gate=? AND subject=? AND status='APPROVED' ORDER BY decided_at DESC LIMIT 1`)
    .get(gate, subject) as ApprovalRow | undefined;
  if (!row) return undefined;
  // TTL: просроченное согласие гасим на месте (fails-closed)
  if (row.decided_at && Date.now() - row.decided_at > APPROVED_TTL_MS) {
    db.query(`UPDATE approvals SET status='EXPIRED' WHERE id=? AND status='APPROVED'`).run(row.id);
    return undefined;
  }
  return row;
}

/** ЕДИНАЯ ТОЧКА ГЕЙТА. Все мутирующие операции с политикой обязаны проходить здесь.
 *  Fails-closed: unknown gate / нет политики / нет живого согласия → denied. */
export function gateCheck(gate: string, subject: string, label: string, requestedBy = "system"): GateDecision {
  const t0 = Date.now();
  const subj = String(subject ?? "").slice(0, 200);
  const lab = String(label ?? subj).slice(0, 200);

  if (!(APPROVAL_GATES as readonly string[]).includes(gate)) {
    return { allowed: false, reason: `unknown_gate:${gate}` }; // fails-closed, заявку не плодим
  }
  const policy = getPolicy(gate);
  if (!policy) return { allowed: false, reason: "policy_missing" }; // самовосстановление seed только на boot

  if (policy.mode === "auto_approve") {
    recordSpan("approval.gate", { "me2.gate": gate, "me2.auto": true }, t0);
    return { allowed: true, reason: "auto_approve", auto: true, policy_mode: policy.mode };
  }

  // require_approval: живой токен?
  const token = findApprovedToken(gate, subj);
  if (token) {
    db.query(`UPDATE approvals SET status='CONSUMED' WHERE id=? AND status='APPROVED'`).run(token.id);
    emit("APPROVAL_CONSUMED", { id: token.id, gate, subject: subj }, null, null);
    recordSpan("approval.gate", { "me2.gate": gate, "me2.consumed": token.id }, t0);
    return { allowed: true, reason: "approved_token_consumed", approval_id: token.id, policy_mode: policy.mode };
  }

  // Нет токена: переиспользуем PENDING или создаём (идемпотентно)
  let pending = findPending(gate, subj);
  if (!pending) {
    const id = rid("apr");
    db.query(`INSERT INTO approvals (id,gate,subject,label,requested_by,status,created_at) VALUES (?,?,?,?,?,'PENDING',?)`)
      .run(id, gate, subj, lab, requestedBy, Date.now());
    pending = findPending(gate, subj);
    emit("APPROVAL_REQUESTED", { id, gate, subject: subj, label: lab }, null, null);
  }
  recordSpan("approval.gate", { "me2.gate": gate, "me2.denied": true, "me2.pending": pending?.id ?? "?" }, t0,
    { status: "WARNING", message: `approval_required: ${gate}/${subj}` });
  return { allowed: false, reason: "approval_required", approval_id: pending?.id, policy_mode: policy.mode };
}

/** Явная заявка от оператора/UI (кнопка «запросить»). */
export function approvalRequest(gate: string, subject: string, label: string, requestedBy = "operator"): ApprovalRow {
  const d = gateCheck(gate, subject, label, requestedBy);
  if (d.allowed) {
    // auto_approve или токен уже есть — заявка не нужна
    return { id: d.approval_id ?? "auto", gate, subject, label, requested_by: requestedBy, status: "CONSUMED", note: d.reason, created_at: Date.now(), decided_at: Date.now() };
  }
  const row = findPending(gate, String(subject).slice(0, 200));
  if (!row) throw new Error("approval_request_failed");
  return row;
}

/** Решение оператора. Только PENDING → APPROVED/DENIED (one-way). */
export function approvalDecide(id: string, decision: "APPROVED" | "DENIED", note?: string): ApprovalRow {
  const row = db.query(`SELECT * FROM approvals WHERE id=?`).get(id) as ApprovalRow | undefined;
  if (!row) throw new Error("approval_not_found");
  if (row.status !== "PENDING") throw new Error(`invalid_state_${row.status}`);
  db.query(`UPDATE approvals SET status=?, note=?, decided_at=? WHERE id=?`)
    .run(decision, note ? String(note).slice(0, 200) : null, Date.now(), id);
  emit(decision === "APPROVED" ? "APPROVAL_APPROVED" : "APPROVAL_DENIED", { id, gate: row.gate, subject: row.subject, note: note ?? null }, null, null);
  recordSpan("approval.decide", { "me2.id": id, "me2.decision": decision }, Date.now());
  const updated = db.query(`SELECT * FROM approvals WHERE id=?`).get(id) as ApprovalRow;
  return updated;
}

/** Смена политики оператором (operator-configurable гейты в одном месте). */
export function policySet(gate: string, mode: string, by = "operator"): ApprovalPolicy {
  if (!(APPROVAL_GATES as readonly string[]).includes(gate)) throw new Error(`unknown_gate:${gate}`);
  if (mode !== "require_approval" && mode !== "auto_approve") throw new Error("bad_mode");
  db.query(`UPDATE approval_policies SET mode=?, updated_at=?, updated_by=? WHERE gate=?`).run(mode, Date.now(), by, gate);
  const p = getPolicy(gate) as ApprovalPolicy;
  emit("APPROVAL_POLICY_SET", { gate, mode, by }, null, null);
  recordSpan("approval.policy", { "me2.gate": gate, "me2.mode": mode }, Date.now());
  return p;
}

function sweepExpired(): void {
  try { db.query(`UPDATE approvals SET status='EXPIRED' WHERE status='PENDING' AND created_at < ?`).run(Date.now() - PENDING_TTL_MS); } catch { /* не критично */ }
}

export function approvalsStatus(): {
  ok: true;
  policies: ApprovalPolicy[];
  pending: ApprovalRow[];
  recent: ApprovalRow[];
  stats: { total: number; pending: number; approved: number; denied: number; consumed: number; expired: number };
} {
  sweepExpired();
  const policies = db.query(`SELECT * FROM approval_policies ORDER BY gate`).all() as ApprovalPolicy[];
  const pending = db.query(`SELECT * FROM approvals WHERE status='PENDING' ORDER BY created_at DESC LIMIT 20`).all() as ApprovalRow[];
  const recent = db.query(`SELECT * FROM approvals WHERE status!='PENDING' ORDER BY COALESCE(decided_at, created_at) DESC LIMIT 15`).all() as ApprovalRow[];
  const cnt = db.query(`SELECT status, COUNT(*) AS n FROM approvals GROUP BY status`).all() as Array<{ status: string; n: number }>;
  const stats = { total: 0, pending: 0, approved: 0, denied: 0, consumed: 0, expired: 0 };
  for (const c of cnt) { stats.total += Number(c.n); (stats as Record<string, number>)[c.status.toLowerCase()] = Number(c.n); }
  return { ok: true, policies, pending, recent, stats };
}

export function approvalsVerdict(): { verdict: "WORKS" | "CAVEAT"; evidence: string } {
  try {
    const t1 = db.query(`SELECT name FROM sqlite_master WHERE type='table' AND name='approval_policies'`).get();
    const t2 = db.query(`SELECT name FROM sqlite_master WHERE type='table' AND name='approvals'`).get();
    if (!t1 || !t2) return { verdict: "CAVEAT", evidence: "таблицы approval_* отсутствуют" };
    const s = approvalsStatus();
    const badGates = s.policies.filter((p) => !(APPROVAL_GATES as readonly string[]).includes(p.gate));
    const badModes = s.policies.filter((p) => p.mode !== "require_approval" && p.mode !== "auto_approve");
    if (s.policies.length !== APPROVAL_GATES.length || badGates.length || badModes.length) {
      return { verdict: "CAVEAT", evidence: `политики неканоничны: ${s.policies.length}/${APPROVAL_GATES.length}` };
    }
    return {
      verdict: "WORKS",
      evidence: `гейты=${s.policies.map((p) => `${p.gate}:${p.mode === "auto_approve" ? "auto" : "gate"}`).join(",")}; заявок=${s.stats.total} (pending=${s.stats.pending}); FAILS-CLOSED: unknown→denied`,
    };
  } catch (e) {
    return { verdict: "CAVEAT", evidence: `approvals сломан: ${e instanceof Error ? e.message : String(e)}`.slice(0, 180) };
  }
}
