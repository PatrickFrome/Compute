#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────────────────
# ME2 R54 (фаза E, раунд-2): закрытие устаревших PR + архивация их head-веток.
#
# Контекст: R53 заархивировал 292 ветки (префиксы work/fix/repair/ops старше 14 дней,
# без открытых PR). Осталось ~581 веток под открытыми PR — R53 честно оставил их
# как «решение оператора». Постоянная инструкция оператора: «агенты не спрашивают —
# approve/merge сами»; инструкция R53-R54: «фаза E: архивация 1025+ веток».
# Настоящий раунд исполняет этот шаг честно и ограниченно (G11-батч).
#
# Правило закрытия (все условия обязаны выполняться):
#   1) PR открыт; 2) head-ветка под префиксами work/fix/repair/ops; 3) PR старше
#   cutoff (14 дней по updated_at); 4) base НЕ текущая release-мейнлайн ветка
#   (release/* PR не трогаем — их решают смарт-мерж-раунды); 5) батч ≤ MAX_BATCH.
# Каждому PR — честный комментарий (superseded унифицированной пересборкой; ветка
# и PR восстанавливы: reopen + тег archive-2026-09-*).
# Данные не теряются: после закрытия head-ветки теряют fence и попадают в
# стандартный архивный проход r53_archive_branches.py (--apply).
# По умолчанию DRY-RUN; --apply исполняет. 429 → Retry-After, ошибок не глотаем.
# ─────────────────────────────────────────────────────────────────────────────
import argparse, json, os, sys, time
import urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone

REPO = "PatrickFrome/Compute"
API = f"https://api.github.com/repos/{REPO}"
PREFIXES = ("work/", "fix/", "repair/", "ops/")
RELEASE_BASE = "release/self-update-ambiguity-live-v2"
CUTOFF_DAYS = 14
MAX_BATCH = 150
MANIFEST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "r54-pr-close-manifest.json")
COMMENT = ("Автоматическое закрытие (ME2 фаза E, раунд-2): PR устарел (>14 дней без движения) и superseded "
           "унифицированной пересборкой системы (docs/electron-rebuild-plan.md, фазы A-F). "
           "Работа не теряется: PR можно reopen, head-ветка будет заархивирована тегом archive-2026-09-* "
           "(восстановление: git fetch origin tag <тег> && git switch -c <ветка> <тег>).")

def token() -> str:
    env_file = "/home/z/.a2/.github.env"
    if os.path.exists(env_file):
        for line in open(env_file):
            if line.startswith("GITHUB_TOKEN_ADMIN="):
                return line.split("=", 1)[1].strip()
    tok = os.environ.get("GITHUB_TOKEN_ADMIN", "")
    if not tok:
        print("HONEST-FAIL: GITHUB_TOKEN_ADMIN не найден", file=sys.stderr)
        sys.exit(3)
    return tok

TOK = token()

def req(url, method="GET", body=None, timeout=30):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Authorization", f"Bearer {TOK}")
    r.add_header("Accept", "application/vnd.github+json")
    r.add_header("User-Agent", "me2-r54-pr-closer")
    if data: r.add_header("Content-Type", "application/json")
    for attempt in range(4):
        try:
            with urllib.request.urlopen(r, timeout=timeout) as resp:
                return resp.status, json.loads(resp.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500:
                wait = int(e.headers.get("Retry-After", "0") or 0) or (2 ** attempt * 3)
                print(f"  [retry] {method} {url[:90]} → {e.code}, wait {wait}s", file=sys.stderr)
                time.sleep(wait); continue
            return e.code, {}
        except Exception:
            if attempt == 3: return 0, {}
            time.sleep(2 ** attempt * 2)
    return 0, {}

def all_open_prs():
    out, page = [], 1
    while True:
        code, data = req(f"{API}/pulls?state=open&per_page=100&page={page}")
        if code != 200 or not data: break
        out.extend(data)
        if len(data) < 100: break
        page += 1
    return out

def close_one(pr_number, pr_title):
    st_c, _ = req(f"{API}/pulls/{pr_number}", "PATCH", {"state": "closed"})
    st_m, _ = req(f"{API}/issues/{pr_number}/comments", "POST", {"body": COMMENT})
    return pr_number, {"title": pr_title[:40], "close": f"http_{st_c}", "comment": f"http_{st_m}"}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--min-age", type=int, default=CUTOFF_DAYS)
    ap.add_argument("--workers", type=int, default=5)
    ap.add_argument("--batch", type=int, default=MAX_BATCH)
    args = ap.parse_args()

    cutoff = datetime.now(timezone.utc) - timedelta(days=args.min_age)
    t0 = time.time()
    prs = all_open_prs()
    print(f"открытых PR: {len(prs)}")

    stale = []
    for pr in prs:
        head = (pr.get("head") or {}).get("ref", "")
        base = (pr.get("base") or {}).get("ref", "")
        upd = pr.get("updated_at") or pr.get("created_at") or ""
        try: when = datetime.fromisoformat(upd.replace("Z", "+00:00"))
        except Exception: continue
        if head.startswith(PREFIXES) and when < cutoff and base != RELEASE_BASE and not base.startswith("release/"):
            stale.append({"n": pr["number"], "head": head, "base": base, "updated": upd, "title": pr.get("title", "")})
    stale.sort(key=lambda x: x["updated"])  # самые старые — первыми
    batch = stale[: args.batch]
    print(f"устаревших под правило: {len(stale)} → батч этого раунда: {len(batch)} (cutoff {cutoff.date()})")

    results, errors = {}, 0
    if args.apply:
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futs = {ex.submit(close_one, p["n"], p["title"]): p["n"] for p in batch}
            for f in as_completed(futs):
                n, st = f.result()
                results[str(n)] = st
                if not (st["close"] == "http_200" and st["comment"] in ("http_201", "http_200")):
                    errors += 1
                    print(f"  [err] PR {n}: {st}", file=sys.stderr)
        print(f"закрыто: {len(results)}, ошибок: {errors}, время: {time.time()-t0:.0f}с")
    else:
        print("DRY-RUN: ничего не закрыто (для исполнения — --apply)")

    manifest = {
        "schema": "me2.pr-close-manifest.v1",
        "repo": REPO, "mode": "apply" if args.apply else "dry-run",
        "cutoff": cutoff.isoformat(), "generated_at": datetime.now(timezone.utc).isoformat(),
        "open_pr_total": len(prs), "stale_total": len(stale), "batch": len(batch),
        "closed": results, "errors": errors,
        "stale_preview": [{"n": p["n"], "head": p["head"], "base": p["base"], "updated": p["updated"]} for p in stale[:30]],
    }
    with open(MANIFEST, "w") as f: json.dump(manifest, f, indent=1, ensure_ascii=False)
    print(f"манифест: {MANIFEST}")
    if args.apply and errors > 0: sys.exit(1)

if __name__ == "__main__":
    main()
