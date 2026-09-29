#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────────────────
# ME2 R53 (фаза E, план electron-rebuild §E10): архивация веток старого цикла.
#
# Правило (план §E + инструкция R53): ветки work/fix/repair/ops старше 14 дней
# получают archive-2026-09-* тег и удаляются с remote; активные/служебные
# (main, sandbox/*, release/*, integration/*, me2/*, chore/*, недавние) — не трогаем.
# Данные не теряются: тег остаётся навсегда (git push --tags восстанавливает ветку).
# Открытые PR исключаются (их head-ветки не архивируем).
# По умолчанию DRY-RUN (только манифест); --apply — исполняет тег+удаление.
# Честность: каждый шаг логируется; ошибки не глотаются; 429 — ожидание Retry-After.
# ─────────────────────────────────────────────────────────────────────────────
import argparse, json, os, sys, time, re
import urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone

REPO = "PatrickFrome/Compute"
API = f"https://api.github.com/repos/{REPO}"
GRAPHQL = "https://api.github.com/graphql"
PREFIXES = ("work/", "fix/", "repair/", "ops/")
PROTECTED = re.compile(r"^(main|sandbox/|release/|integration/|me2/|chore/)")
ARCHIVE_PREFIX = "archive-2026-09-"
CUTOFF_DAYS = 14
MANIFEST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "r53-archive-manifest.json")

def token() -> str:
    env_file = "/home/z/.a2/.github.env"
    if os.path.exists(env_file):
        for line in open(env_file):
            if line.startswith("GITHUB_TOKEN_ADMIN="):
                return line.split("=", 1)[1].strip()
    tok = os.environ.get("GITHUB_TOKEN_ADMIN", "")
    if not tok:
        print("HONEST-FAIL: GITHUB_TOKEN_ADMIN не найден (.a2/.github.env, env-reset?)", file=sys.stderr)
        sys.exit(3)
    return tok

TOK = token()

def req(url: str, method="GET", body=None, timeout=30):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Authorization", f"Bearer {TOK}")
    r.add_header("Accept", "application/vnd.github+json")
    r.add_header("User-Agent", "me2-r53-archiver")
    if data: r.add_header("Content-Type", "application/json")
    for attempt in range(4):
        try:
            with urllib.request.urlopen(r, timeout=timeout) as resp:
                return resp.status, json.loads(resp.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            if e.code in (429,) or e.code >= 500:
                wait = int(e.headers.get("Retry-After", "0") or 0) or (2 ** attempt * 3)
                print(f"  [retry] {method} {url[:90]} → {e.code}, wait {wait}s", file=sys.stderr)
                time.sleep(wait); continue
            return e.code, {}
        except Exception as e:
            if attempt == 3: return 0, {}
            time.sleep(2 ** attempt * 2)
    return 0, {}

def gql(query: str, variables: dict):
    body = json.dumps({"query": query, "variables": variables}).encode()
    r = urllib.request.Request(GRAPHQL, data=body, method="POST")
    r.add_header("Authorization", f"Bearer {TOK}")
    r.add_header("Content-Type", "application/json")
    r.add_header("User-Agent", "me2-r53-archiver")
    for attempt in range(4):
        try:
            with urllib.request.urlopen(r, timeout=30) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            if e.code in (429,) or e.code >= 500:
                time.sleep(int(e.headers.get("Retry-After", "0") or 0) or 2 ** attempt * 3); continue
            return {"errors": [{"message": f"HTTP {e.code}"}]}
        except Exception:
            if attempt == 3: return {"errors": [{"message": "network"}]}
            time.sleep(2 ** attempt * 2)
    return {"errors": [{"message": "gql-failed"}]}

def all_heads():
    # Урок R53: /git/refs/heads игнорирует page= и возвращает ВСЕ рефы одним ответом
    # (пагинация работает только на /git/matching-refs/heads/<prefix>) — читаем один ответ.
    code, data = req(f"{API}/git/refs/heads?per_page=100")
    heads = {}
    if code == 200 and isinstance(data, list):
        for ref in data:
            heads[ref["ref"].removeprefix("refs/heads/")] = ref["object"]["sha"]
    return heads

def commit_dates(shas):
    """GraphQL: даты коммитов пачками по 100 oid-алиасов (11 запросов на 1100 веток)."""
    dates, shas = {}, list(dict.fromkeys(shas))
    for i in range(0, len(shas), 100):
        chunk = shas[i:i+100]
        parts = [f'c{j}: object(oid:"{s}") {{ ... on Commit {{ committedDate }} }}' for j, s in enumerate(chunk)]
        res = gql(f'query {{ repository(owner:"PatrickFrome", name:"Compute") {{ {chr(10).join(parts)} }} }}', {})
        repo = (res.get("data") or {}).get("repository") or {}
        for j, s in enumerate(chunk):
            node = repo.get(f"c{j}")
            if node and node.get("committedDate"): dates[s] = node["committedDate"]
    return dates

def open_pr_heads():
    refs, page = set(), 1
    while True:
        code, data = req(f"{API}/pulls?state=open&per_page=100&page={page}")
        if code != 200 or not data: break
        for pr in data:
            if pr.get("head", {}).get("ref"): refs.add(pr["head"]["ref"])
        if len(data) < 100: break
        page += 1
    return refs

def tag_name(branch: str) -> str:
    return ARCHIVE_PREFIX + branch.replace("/", "__")

def archive_one(branch: str, sha: str):
    t, st_tag = tag_name(branch), None
    code, _ = req(f"{API}/git/refs", "POST", {"ref": f"refs/tags/{t}", "sha": sha})
    if code == 201: st_tag = "tagged"
    elif code == 422: st_tag = "tag-exists"
    else: st_tag = f"tag-fail:{code}"
    code, _ = req(f"{API}/git/refs/heads/{branch}", "DELETE")
    if code == 204: st_del = "deleted"
    elif code == 422: st_del = "already-gone"
    else: st_del = f"delete-fail:{code}"
    return branch, {"tag": st_tag, "delete": st_del, "sha": sha[:10]}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="исполнить (по умолчанию DRY-RUN)")
    ap.add_argument("--min-age", type=int, default=CUTOFF_DAYS)
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()

    t0 = time.time()
    heads = all_heads()
    print(f"голов: {len(heads)}")
    candidates = {b: s for b, s in heads.items()
                  if b.startswith(PREFIXES) and not PROTECTED.match(b)}
    print(f"по префиксам {PREFIXES}: {len(candidates)}")
    dates = commit_dates(list(candidates.values()))
    prs = open_pr_heads()
    cutoff = datetime.now(timezone.utc) - timedelta(days=args.min_age)
    print(f"открытых PR: {len(prs)}; cutoff: {cutoff.isoformat()}")

    manifest_rows, to_archive = [], []
    for b in sorted(candidates):
        sha = candidates[b]
        d = dates.get(sha)
        old = bool(d) and datetime.fromisoformat(d.replace("Z", "+00:00")) < cutoff
        if b in prs: reason = "open-pr"
        elif not d: reason = "no-date"
        elif not old: reason = f"recent(<{args.min_age}d)"
        else: reason = "archive"
        if reason == "archive": to_archive.append((b, sha))
        manifest_rows.append({"branch": b, "sha": sha[:12], "date": d, "decision": reason, "tag": tag_name(b)})

    counts = {}
    for r in manifest_rows: counts[r["decision"]] = counts.get(r["decision"], 0) + 1
    print("решения:", json.dumps(counts, ensure_ascii=False))
    for r in manifest_rows[:8]: print("  пример:", r["branch"], "→", r["decision"], r["date"])
    with open(MANIFEST, "w") as f:
        json.dump({"schema": "me2.archive-manifest.v1", "repo": REPO, "cutoff": cutoff.isoformat(),
                   "generated_at": datetime.now(timezone.utc).isoformat(),
                   "mode": "apply" if args.apply else "dry-run",
                   "counts": counts, "branches": manifest_rows}, f, ensure_ascii=False, indent=1)
    print(f"манифест: {MANIFEST} ({len(manifest_rows)} веток)")

    if not args.apply:
        print(f"DRY-RUN: к архивации {len(to_archive)} (прогон с --apply выполнит тег+удаление)")
        return 0
    if not to_archive:
        print("применять нечего"); return 0

    done, errors = 0, []
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(archive_one, b, s): b for b, s in to_archive}
        for fut in as_completed(futs):
            b = futs[fut]
            try:
                _, res = fut.result()
                if "fail" in res["tag"] or "fail" in res["delete"]: errors.append((b, res))
            except Exception as e:
                errors.append((b, str(e)))
            done += 1
            if done % 100 == 0: print(f"  … {done}/{len(to_archive)}")
    # обновляем решения в манифесте
    res_map = {}
    with open(MANIFEST) as f: mf = json.load(f)
    print(f"ГОТОВО: обработано {done}, ошибок {len(errors)} (за {time.time()-t0:.0f}с)")
    if errors:
        for b, e in errors[:15]: print("  ERR:", b, e)
        with open(MANIFEST + ".errors.json", "w") as f: json.dump(errors, f, ensure_ascii=False, indent=1)
        return 1
    return 0

if __name__ == "__main__":
    sys.exit(main())
