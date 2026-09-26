#!/usr/bin/env python3
# ev-topo-reorder.py — EV-TOPO: группировка 15 панелей в 3 домена Runtime/Convergence/Evidence.
# Физически переставляет сегменты внутри <main> и оборачивает их в sticky-секции.
import re, sys

PATH = "/home/z/my-project/src/app/page.tsx"
src = open(PATH, encoding="utf-8").read()
lines = src.split("\n")

# --- locate <main> open and </main> close ---
main_open = main_close = None
for i, ln in enumerate(lines):
    if '<main className="mx-auto grid' in ln:
        main_open = i
    if ln.strip() == "</main>" and main_open is not None and main_close is None:
        main_close = i
if main_open is None or main_close is None:
    sys.exit("FATAL: main boundaries not found")

body = lines[main_open + 1 : main_close]

# --- split body into segments at panel comment markers ---
segs, cur = [], None
for ln in body:
    s = ln.strip()
    if s.startswith("{/* ---") and s.endswith("*/}"):
        if cur:
            segs.append(cur)
        cur = [ln]
    elif cur is not None:
        cur.append(ln)
if cur:
    segs.append(cur)

# trim trailing blank lines of each segment
def rtrim(seg):
    while seg and seg[-1].strip() == "":
        seg.pop()
    return seg

segs = [rtrim(s) for s in segs if any(x.strip() for x in s)]

# --- key each segment ---
keyed = {}
for seg in segs:
    text = "\n".join(seg)
    m = re.search(r'id="p-([a-z0-9]+)"', text)
    if m:
        key = m.group(1)
    elif "P0/P1 разрывы" in text:
        key = "gapmatrix"
    elif "Worktrees · Песочница" in text:
        key = "worktrees"
    elif "Восстановление после env-reset" in text:
        key = "recovery"
    else:
        sys.exit(f"FATAL: unknown segment, first line: {seg[0].strip()[:80]}")
    if key in keyed:
        sys.exit(f"FATAL: duplicate key {key}")
    keyed[key] = seg

expected = {"daemon","donors","supabase","github","qual","r82","exitgate","edge","monitor","roadmap","events","mirror","gapmatrix","worktrees","recovery"}
missing = expected - set(keyed)
if missing:
    sys.exit(f"FATAL: missing segments: {missing}")

# --- domain header template ---
def header(num, ident, title, subtitle, tagline):
    return [
        f'        {{/* {"═"*30} DOMAIN {num} · {ident} (EV-TOPO: доменная топология UI-аудита Phase-2) */}}',
        f'        <section id="{ident}" aria-labelledby="{ident}-h" className="col-span-full scroll-mt-24">',
        f'          <div className="sticky top-16 z-[5] -mx-1 flex items-center gap-2.5 rounded-lg border border-zinc-800/80 bg-zinc-950/90 px-3 py-2 shadow-lg shadow-black/30 backdrop-blur-md md:top-[96px]">',
        f'            <span className="font-mono text-[10px] font-bold tracking-[0.2em] text-teal-400">{num}</span>',
        f'            <h2 id="{ident}-h" className="min-w-0 shrink-0 text-[11px] font-bold uppercase tracking-[0.22em] text-zinc-100">{title}</h2>',
        f'            <span className="hidden shrink-0 text-[10px] text-zinc-500 sm:inline">{subtitle}</span>',
        f'            <span className="ml-1 h-px min-w-6 flex-1 bg-gradient-to-r from-zinc-700/80 to-transparent" />',
        f'            <span className="hidden shrink-0 font-mono text-[9px] text-zinc-600 lg:inline">{tagline}</span>',
        f'          </div>',
        f'          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">',
    ]

def close_header():
    return ["          </div>", "        </section>"]

def domain(num, ident, title, subtitle, tagline, keys):
    out = header(num, ident, title, subtitle, tagline)
    for k in keys:
        out.extend(keyed[k])
        out.append("")
    # drop trailing blank
    while out and out[-1].strip() == "":
        out.pop()
    out.extend(close_header())
    return out

runtime    = domain("01", "sec-runtime",  "Runtime",     "исполнение · 5 панелей",  "демон · доноры · edge · песочница · монитор", ["daemon","donors","edge","worktrees","monitor"])
convg      = domain("02", "sec-conv",     "Convergence", "сходимость · 6 панелей",  "квалификация · r82 · exit gate · разрывы · роадмап · события", ["qual","r82","exitgate","gapmatrix","roadmap","events"])
evidence   = domain("03", "sec-evidence", "Evidence",    "артефакты · 4 панели",    "supabase · github · mirror · восстановление", ["supabase","github","mirror","recovery"])

new_main_open = '      <main className="mx-auto w-full max-w-7xl flex-1 space-y-5 p-4">'
new_body = []
for i, d in enumerate([runtime, convg, evidence]):
    if i:
        new_body.append("")
    new_body.extend(d)

out = lines[:main_open] + [new_main_open] + new_body + lines[main_close:]
open(PATH, "w", encoding="utf-8").write("\n".join(out))
print(f"OK: main rebuilt, {len(lines)} -> {len(out)} lines; domains=3 panels=15")
