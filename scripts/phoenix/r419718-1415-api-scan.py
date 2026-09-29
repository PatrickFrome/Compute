#!/usr/bin/env python3
# r419718-1415-api-scan.py — PRINCIPAL-DIRECTIVE §3: repository-wide scan for model API/SDK
# fallback paths (forbidden runtime execution paths). Tracked files only. Preliminary
# classification: TEST-ONLY / INFRA-SCRIPT / DOCS / RUNTIME-CANDIDATE (needs consumer analysis).
import subprocess, re, json, datetime

OUT = "/home/z/my-project/scripts/me2-r28/api-sdk-scan-1408.md"
PAT = re.compile(
    r"(api\.openai|openai\.com|anthropic|chat/completions|api\.anthropic|claude-|gpt-4|gpt-3|gpt-5"
    r"|@ai-sdk|ai-sdk|vercel[ -]?ai|openrouter|deepseek|bigmodel|z\.ai/api|api/chat"
    r"|model_api|llm_api|llm-gateway|inference[_-]api|completion endpoint|OPENAI_API_KEY|ANTHROPIC_API_KEY)",
    re.IGNORECASE)
SRC_EXT = (".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs", ".json", ".sh", ".py", ".md")

files = subprocess.run(["git", "ls-files"], capture_output=True, text=True,
                       cwd="/home/z/my-project").stdout.splitlines()
hits = {}
for f in files:
    if not f.lower().endswith(SRC_EXT):
        continue
    try:
        with open(f"/home/z/my-project/{f}", encoding="utf-8", errors="replace") as fh:
            for i, line in enumerate(fh, 1):
                if PAT.search(line):
                    hits.setdefault(f, []).append((i, line.strip()[:160]))
    except OSError:
        continue

def classify(path):
    p = path.lower()
    if p.startswith(("audit/", "docs/", ".a2-backup")) or "readme" in p:
        return "DOCS"
    if "test" in p or "spec" in p or p.startswith("scripts/me2-r28/") or "browser-test-results" in p:
        return "TEST-ONLY/VERIFY"
    if p.startswith(("scripts/", "tools/")):
        return "INFRA-SCRIPT"
    if p.startswith(("src/", "app/", "lib/", "components/", "server/", "electron/")):
        return "RUNTIME-CANDIDATE"
    return "NEEDS-REVIEW"

table, by_class = [], {}
for f in sorted(hits):
    cls = classify(f)
    by_class[cls] = by_class.get(cls, 0) + 1
    for ln, text in hits[f][:6]:
        table.append(f"| {f}:{ln} | {cls} | `{text[:110]}` |")

now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
doc = [
    "# API/SDK Fallback Scan (PRINCIPAL-DIRECTIVE §3)",
    f"*gen {now} — tracked files scanned: {len(files)}; files with hits: {len(hits)}; total hit lines: {sum(len(v) for v in hits.values())}*",
    "",
    "## Classification summary",
    json.dumps(by_class, ensure_ascii=False, indent=0),
    "",
    "## Directive verdict frame",
    "- RUNTIME-CANDIDATE hits -> consumer analysis required, then REMOVE or MIGRATE (no silent API fallback allowed).",
    "- TEST-ONLY/VERIFY + INFRA-SCRIPT -> allowed only outside runtime dispatch path.",
    "- DOCS -> reference only.",
    "",
    "## Hits (first 6 lines per file)",
    "| Location | Class | Snippet |",
    "|---|---|---|",
    *table,
    ""]
with open(OUT, "w", encoding="utf-8") as fh:
    fh.write("\n".join(doc))
print(f"files_with_hits={len(hits)} classes={by_class}")
print("artifact:", OUT)
