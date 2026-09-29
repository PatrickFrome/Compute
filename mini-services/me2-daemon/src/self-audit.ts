// ── R59 «Аудит как цикл»: периодический самоаудит из daemon-цикла ──
//
// Роль (план R58→R59): RLS-аудит (sql/0003+0004) и сверка RPC-реестра (R52) —
// не разовые пробы раундов, а ПОСТОЯННЫЙ внутренний цикл daemon'а (не внешний cron —
// приказ оператора R55-5 касается cron-джоб, внутренние интервалы daemon'а — канон
// системы: sqlmirror 15с, supervisor 60с). Период 20 минут: psql-канал не штормится
// (кэш модулей 60с сверху).
//
// Событийная семантика — узор Kubernetes reconcile (edge-triggered поверх
// level-triggered): событие шины ТОЛЬКО на переходе состояния (unknown/ПASS → FAIL =
// *_FAIL; FAIL → PASS = *_RECOVERED). Ровный PASS не шумит — река не засоряется
// («quiet is healthy» — тот же принцип, что у kubectl get events: норма не событие).
//
// Zero-authority: цикл только наблюдает и говорит; решения и шину не трогает.
// 47-инвариант не трогается (новых действий шины нет — события есть, действия нет).
import { emit } from "../store";
import { runRlsAuditAsync } from "./rls-audit";
import { runRpcReconcileAsync } from "./rpc-reconcile";

const DEFAULT_INTERVAL_MS = 20 * 60_000; // 20 минут — спокойный период самоаудита
let timer: ReturnType<typeof setInterval> | null = null;
let busy = false;
const prev: { rls: string; rpc: string } = { rls: "unknown", rpc: "unknown" };

function transition(
  kind: "rls" | "rpc",
  verdict: "PASS" | "FAIL",
  detail: Record<string, unknown>,
): void {
  const before = prev[kind];
  prev[kind] = verdict;
  if (verdict === "FAIL" && before !== "FAIL") {
    emit(kind === "rls" ? "RLS_AUDIT_FAIL" : "RPC_RECONCILE_FAIL", detail, null, null);
  } else if (verdict === "PASS" && before === "FAIL") {
    emit(kind === "rls" ? "RLS_AUDIT_RECOVERED" : "RPC_RECONCILE_RECOVERED", detail, null, null);
  }
  // ровный PASS (before=PASS/unknown) — молчание: норма не событие
}

/** Один прогон самоаудита (RLS + реестр). Никогда не бросает. */
export async function selfAuditOnce(reason: string): Promise<{ rls: string; rpc: string }> {
  if (busy) return { ...prev };
  busy = true;
  try {
    const rls = await runRlsAuditAsync();
    if (rls.ok && "verdict" in rls && (rls.verdict === "PASS" || rls.verdict === "FAIL")) {
      transition("rls", rls.verdict, {
        verdict: rls.verdict, reason,
        grants_mismatch: rls.grants?.mismatch ?? null,
        policies_mismatch: rls.policies?.mismatch ?? null,
        anon: rls.anon ?? null,
        ran_at: rls.ran_at,
      });
    }
    const rpc = await runRpcReconcileAsync();
    if (rpc.ok && "verdict" in rpc && (rpc.verdict === "PASS" || rpc.verdict === "FAIL")) {
      transition("rpc", rpc.verdict, {
        verdict: rpc.verdict, reason,
        expected_total: rpc.registry?.expected_total ?? null,
        actual_total: rpc.registry?.actual_total ?? null,
        missing: rpc.registry?.missing_count ?? null,
        extra: rpc.registry?.extra_count ?? null,
        tier_mismatch: rpc.registry?.tier_mismatch_count ?? null,
        ran_at: rpc.ran_at,
      });
    }
    return { ...prev };
  } catch {
    return { ...prev }; // честная деградация: состояние не меняем, цикл живёт дальше
  } finally {
    busy = false;
  }
}

/** Запуск периодического цикла. Идемпотентен (повторный вызов не плодит таймеры). */
export function startSelfAuditLoop(intervalMs: number = DEFAULT_INTERVAL_MS): void {
  if (timer) return;
  timer = setInterval(() => {
    void selfAuditOnce("periodic");
  }, intervalMs);
  timer.unref?.();
  // первый прогон сразу после бута, но не блокируя старт (best-effort, async)
  void selfAuditOnce("boot");
}

/** Тестовая проекция: текущее известное состояние без прогона. */
export function selfAuditStatus(): { rls: string; rpc: string; running: boolean; interval_ms: number } {
  return { ...prev, running: timer !== null, interval_ms: DEFAULT_INTERVAL_MS };
}
