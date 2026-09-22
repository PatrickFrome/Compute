// ME2 M2 — Code Graph v1 (deterministic, zero-dep).
// R16: закрывает пробел «Code Graph» из top-4 DEVOS-роадмапа (Worktree ✅ + Code Graph ← это + Snapshot Sandbox + command bus ✅).
//
// v1 — regex-tier: экспорты/импорты/LOC/рёбра по TS/TSX. Детерминированно, <100мс,
// без зависимостей. tree-sitter-tier (уточненные символы вызовов) — drop-in v2: тот же
// контракт REST, другой extractor. Честно помечено в /codegraph -> tier:"regex-v1".
//
// Read-only скан репо; кэш по mtime-подписи + TTL 30s; лимит 400 файлов (анти-цикл).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, resolve, sep } from "node:path";

const REPO = "/home/z/my-project";
const ROOTS = [join(REPO, "src"), join(REPO, "mini-services", "me2-daemon")];
const SKIP_DIRS = new Set(["node_modules", ".next", "data", "db", "browser-data", "browser-data-hf", ".git"]);
const MAX_FILES = 400;
const TTL_MS = 30_000;

export interface CGFile {
  path: string;              // от корня репо, posix
  loc: number;
  symbols: string[];         // экспорты (fn/const/class/type/interface/default)
  importsInternal: string[]; // внутренние рёбра (пути от корня репо)
  importsExternal: string[]; // пакеты (npm)
  inbound: number;
}
export interface CGSummary {
  ok: true;
  tier: "regex-v1";
  generatedAt: string;
  scanMs: number;
  files: number;
  symbols: number;
  edges: number;
  externalImports: number;
  orphans: string[];                      // 0 inbound (entrypoints отфильтрованы)
  topFanIn: { path: string; inbound: number }[];
  topFanOut: { path: string; outbound: number }[];
  externalTop: { pkg: string; n: number }[];
  truncated: boolean;
}

interface Cache {
  sig: string;
  at: number;
  files: Map<string, CGFile>;
  summary: CGSummary;
}
let cache: Cache | null = null;

function walk(dir: string, out: string[], depth = 0): void {
  if (out.length >= MAX_FILES || depth > 12) return;
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (out.length >= MAX_FILES) return;
    const p = join(dir, name);
    let st: ReturnType<typeof statSync>;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
      walk(p, out, depth + 1);
    } else if ((name.endsWith(".ts") || name.endsWith(".tsx")) && !name.endsWith(".d.ts")) {
      out.push(p);
    }
  }
}

function normRel(abs: string): string {
  return abs.slice(REPO.length + 1).split(sep).join("/");
}

/** Резолв импорта → внутренний путь от корня репо, или null если внешний/не найден. */
function resolveImport(fromAbs: string, spec: string): string | null {
  let base: string | null = null;
  if (spec.startsWith("@/")) base = join(REPO, "src", spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../")) base = resolve(dirname(fromAbs), spec);
  if (!base) return null;
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")];
  for (const c of candidates) {
    try {
      const st = statSync(c);
      if (st.isFile()) return normRel(c);
    } catch { /* next */ }
  }
  return null;
}

const RE_IMPORT = /(?:import\s+(?:[\s\S]*?)\s+from\s+|import\s+|export\s+(?:[\s\S]*?)\s+from\s+|require\(\s*|import\(\s*)["']([^"']+)["']/g;
const RE_SYMBOLS = [
  /^export\s+(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm,
  /^export\s+(?:declare\s+)?const\s+([A-Za-z_$][\w$]*)/gm,
  /^export\s+(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gm,
  /^export\s+(?:type|interface)\s+([A-Za-z_$][\w$]*)/gm,
  /^export\s+default\s+(?:async\s+)?(?:function|class)?\s*([A-Za-z_$][\w$]*)?/gm,
];

function scanFiles(force: boolean): Cache {
  if (cache && !force && Date.now() - cache.at < TTL_MS) return cache;

  // mtime-подпись: count+sum мтимов (дёшево, детерминированно)
  const paths: string[] = [];
  for (const r of ROOTS) walk(r, paths);
  let sig = `${paths.length}:`;
  let sigSum = 0;
  for (const p of paths) { try { sigSum = (sigSum + statSync(p).mtimeMs) % Number.MAX_SAFE_INTEGER; } catch { /* skip */ } }
  sig += sigSum.toString(36);
  if (cache && cache.sig === sig && Date.now() - cache.at < 15 * 60_000) { cache.at = Date.now(); return cache; }

  const t0 = Date.now();
  const files = new Map<string, CGFile>();
  const absToRel = new Map<string, string>();
  const truncated = paths.length >= MAX_FILES;
  for (const abs of paths) {
    const rel = normRel(abs);
    absToRel.set(abs, rel);
    let src = "";
    try { src = readFileSync(abs, "utf8"); } catch { continue; }
    const importsInternal = new Set<string>();
    const importsExternal = new Set<string>();
    for (const m of src.matchAll(RE_IMPORT)) {
      const spec = m[1];
      if (!spec || spec.startsWith("node:")) continue;
      const resolved = resolveImport(abs, spec);
      if (resolved && resolved !== rel) importsInternal.add(resolved);
      else if (!resolved && !spec.startsWith(".")) importsExternal.add(spec.split("/")[0].replace(/^@[^/]+\//, "").split("@")[0] || spec);
    }
    const symbols = new Set<string>();
    for (const re of RE_SYMBOLS) for (const m of src.matchAll(re)) if (m[1]) symbols.add(m[1]); else symbols.add("default");
    files.set(rel, {
      path: rel, loc: src.split("\n").length, symbols: [...symbols],
      importsInternal: [...importsInternal], importsExternal: [...importsExternal], inbound: 0,
    });
  }
  // рёбра → inbound
  let edges = 0;
  for (const f of files.values()) {
    f.importsInternal = f.importsInternal.filter((t) => files.has(t));
    for (const t of f.importsInternal) { const tf = files.get(t); if (tf) { tf.inbound++; edges++; } }
  }
  // входные точки, у которых inbound==0 легитимно (роуты/entrypoints)
  const ENTRY = /(^|\/)(page|layout|route|index|worker|screencast|provider)\.(ts|tsx)$/;
  const orphans = [...files.values()].filter((f) => f.inbound === 0 && !ENTRY.test(f.path)).map((f) => f.path).sort();
  const topFanIn = [...files.values()].sort((a, b) => b.inbound - a.inbound).slice(0, 10).map((f) => ({ path: f.path, inbound: f.inbound }));
  const topFanOut = [...files.values()].sort((a, b) => b.importsInternal.length - a.importsInternal.length).slice(0, 10)
    .map((f) => ({ path: f.path, outbound: f.importsInternal.length }));
  const extCount = new Map<string, number>();
  let externalImports = 0;
  let symbols = 0;
  for (const f of files.values()) {
    symbols += f.symbols.length;
    for (const e of f.importsExternal) { extCount.set(e, (extCount.get(e) ?? 0) + 1); externalImports++; }
  }
  const externalTop = [...extCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([pkg, n]) => ({ pkg, n }));

  const summary: CGSummary = {
    ok: true, tier: "regex-v1", generatedAt: new Date().toISOString(),
    scanMs: Date.now() - t0, files: files.size, symbols, edges, externalImports,
    orphans, topFanIn, topFanOut, externalTop, truncated,
  };
  cache = { sig, at: Date.now(), files, summary };
  return cache;
}

export function codegraphSummary(force = false): CGSummary {
  return scanFiles(force).summary;
}

/** Impact-анализ: кто тянет файл транзитивно (reverse closure по import-рёбрам). */
export function codegraphImpact(rawFile: string): {
  ok: true; file: string; found: boolean; direct: string[]; transitive: string[]; inboundRoot: number; note?: string;
} {
  const c = scanFiles(false);
  const raw = String(rawFile ?? "").split(sep).join("/").replace(/^\/+/, "");
  // допускаем запрос без расширения: raw, raw.ts, raw.tsx, raw/index.*
  const candidates = [raw, `${raw}.ts`, `${raw}.tsx`, `${raw}/index.ts`, `${raw}/index.tsx`];
  let target = null as CGFile | null;
  for (const cand of candidates) {
    const byAbs = c.files.get(normRel(resolve(join(REPO, cand))));
    if (byAbs) { target = byAbs; break; }
    const byRel = c.files.get(cand);
    if (byRel) { target = byRel; break; }
  }
  if (!target) {
    return { ok: true, file: raw, found: false, direct: [], transitive: [], inboundRoot: 0,
      note: "файл вне графа (не найден или вне src/ и mini-services/me2-daemon)" };
  }
  // reverse adjacency: target → импортёры
  const rev = new Map<string, string[]>();
  for (const f of c.files.values()) for (const t of f.importsInternal) {
    const arr = rev.get(t) ?? []; arr.push(f.path); rev.set(t, arr);
  }
  const direct = [...new Set(rev.get(target.path) ?? [])].sort();
  const seen = new Set<string>([target.path]);
  const queue = [...direct];
  while (queue.length) {
    const cur = queue.shift() as string;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const up of rev.get(cur) ?? []) if (!seen.has(up)) queue.push(up);
  }
  seen.delete(target.path);
  const transitive = [...seen].sort();
  return { ok: true, file: target.path, found: true, direct, transitive, inboundRoot: target.inbound };
}

export function codegraphFileList(prefix: string, limit = 30): { path: string; loc: number; inbound: number; symbols: number }[] {
  const c = scanFiles(false);
  const p = String(prefix ?? "").toLowerCase();
  return [...c.files.values()].filter((f) => f.path.toLowerCase().includes(p)).slice(0, limit)
    .map((f) => ({ path: f.path, loc: f.loc, inbound: f.inbound, symbols: f.symbols.length }));
}
