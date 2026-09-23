// ME2 M7 — OTel-lite (R16): span-буфер в OTLP-JSON совместимой форме.
// Зависимостей нет: OTLP — это просто JSON поверх HTTP. /spans/otlp отдаёт
// resourceSpans-документ, который принимают OTLP-эндпоинты (jaeger-all-in-one,
// otelcol) и конвертеры в Perfetto (perfetto.dev → OpenTelemetry → Perfetto).
//
// Командные спаны — instrumentation в runCommand (commands.ts), таск-жизненный
// цикл — мост onEvent в index.ts. Ring 1000, счётчики по имени (n/err/avg ms).
//
// Это честный lite: экспорт push (OTLP exporter → внешний collector) не шлём —
// sandbox изолирован; /spans/otlp готов к pull-сбору. Upgrade до push — v2.

export type SpanStatus = "OK" | "ERROR";

export interface OtelSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: "INTERNAL" | "CLIENT" | "SERVER";
  startUnixNano: string;
  endUnixNano: string;
  durationMs: number;
  status: { code: SpanStatus; message?: string };
  attributes: Record<string, string | number | boolean>;
}

export interface SpanStat { name: string; n: number; err: number; avgMs: number; maxMs: number }

const RING_CAP = 1000;
const ring: OtelSpan[] = [];
const stats = new Map<string, { n: number; err: number; ms: number; max: number }>();
let dropped = 0;
let startedAt = new Date().toISOString();

function hex(len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}
function nano(ms: number): string { return (BigInt(Math.round(ms)) * 1_000_000n).toString(); }

export function recordSpan(
  name: string,
  attrs: Record<string, string | number | boolean>,
  startMs: number,
  opts: { status?: SpanStatus; message?: string; parent?: string; kind?: OtelSpan["kind"]; endMs?: number } = {},
): OtelSpan {
  const endMs = opts.endMs ?? Date.now();
  const span: OtelSpan = {
    traceId: hex(32), spanId: hex(16), parentSpanId: opts.parent ?? null,
    name, kind: opts.kind ?? "INTERNAL",
    startUnixNano: nano(startMs), endUnixNano: nano(endMs),
    durationMs: Math.max(0, endMs - startMs),
    status: { code: opts.status ?? "OK", ...(opts.message ? { message: opts.message.slice(0, 300) } : {}) },
    attributes: attrs,
  };
  if (ring.length >= RING_CAP) { ring.shift(); dropped++; }
  ring.push(span);
  const st = stats.get(name) ?? { n: 0, err: 0, ms: 0, max: 0 };
  st.n++; if (span.status.code === "ERROR") st.err++;
  st.ms += span.durationMs; st.max = Math.max(st.max, span.durationMs);
  stats.set(name, st);
  return span;
}

/** Мост событий → спаны (task lifecycle; COMMAND_* уже покрыты runCommand-спанами). */
export function onDaemonEvent(type: string, data: Record<string, unknown>, taskId?: string | null): void {
  if (type !== "TASK_DONE" && type !== "TASK_FAILED" && type !== "TASK_LEASED") return;
  const err = type === "TASK_FAILED";
  recordSpan(`task.${type.slice(5).toLowerCase()}`, {
    "me2.task_id": String(taskId ?? data.parent ?? "?"),
    ...(data.cause ? { "me2.cause": String(data.cause) } : {}),
    ...(data.error ? { "me2.error": String(data.error).slice(0, 200) } : {}),
    ...(data.steps ? { "me2.steps": Number(data.steps) } : {}),
  }, Date.now(), err ? { status: "ERROR", message: String(data.error ?? data.cause ?? "task_failed") } : {});
}

/** OTLP-JSON (trace) — форма из спецификации proto → JSON mapping. */
export function toOtlp(limit = 200): {
  resourceSpans: {
    resource: { attributes: { key: string; value: Record<string, string> }[] };
    scopeSpans: { scope: { name: string; version: string }; spans: unknown[] }[];
  }[];
} {
  const slice = ring.slice(-Math.max(1, Math.min(limit, RING_CAP)));
  const spans = slice.map((s) => ({
    traceId: s.traceId, spanId: s.spanId,
    ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}),
    name: s.name, kind: s.kind,
    startTimeUnixNano: s.startUnixNano, endTimeUnixNano: s.endUnixNano,
    attributes: Object.entries(s.attributes).map(([key, v]) => ({
      key, value: typeof v === "number" ? { intValue: String(v) } : typeof v === "boolean" ? { boolValue: v } : { stringValue: v },
    })),
    status: { code: s.status.code === "ERROR" ? 2 : 1, ...(s.status.message ? { message: s.status.message } : {}) },
  }));
  return {
    resourceSpans: [{
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: "me2-daemon" } },
          { key: "service.version", value: { stringValue: "otel-lite-r16" } },
          { key: "me2.started_at", value: { stringValue: startedAt } },
        ],
      },
      scopeSpans: [{ scope: { name: "me2.command-bus", version: "0.16.0" }, spans }],
    }],
  };
}

export function otelStatus(): {
  ok: true; spans: number; dropped: number; ringCap: number; startedAt: string;
  stats: SpanStat[]; format: string;
} {
  return {
    ok: true, spans: ring.length, dropped, ringCap: RING_CAP, startedAt,
    format: "OTLP-JSON (GET /spans/otlp)",
    stats: [...stats.entries()].map(([name, s]) => ({
      name, n: s.n, err: s.err, avgMs: s.n ? Math.round(s.ms / s.n) : 0, maxMs: s.max,
    })).sort((a, b) => b.n - a.n),
  };
}
