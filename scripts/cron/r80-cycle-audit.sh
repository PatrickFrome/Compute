#!/usr/bin/env bash
# r80-cycle-audit.sh v1.0 — фаза 1 R-CYCLE (Job 413338): детерминированный аудит
# веток / CI / freeze-гейта / daemon / зеркала БД. Секреты не печатает.
# Вывод: KEY=VALUE строки + VERDICT для агентной фазы (выбор задачи).
set -u
PROJ=/home/z/my-project
DESK=/home/z/me2-desktop
cd "$PROJ" 2>/dev/null || { echo "FATAL: no $PROJ"; exit 2; }

echo "== R-CYCLE AUDIT $(date -u '+%Y-%m-%dT%H:%M:%SZ') =="

# --- secrets carrier ---
if [ -s /home/z/.a2/.github.env ] && grep -q '^GITHUB_TOKEN_ADMIN=.' /home/z/.a2/.github.env; then
  echo "pat=present"
else
  echo "pat=MISSING"; echo "verdict=BLOCKED_PAT"; exit 0
fi

# --- daemon ---
DH=$(curl -s -m 5 localhost:3041/health 2>/dev/null || true)
echo "daemon=$(printf '%s' "$DH" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(str(d.get("version"))+" actions="+str(d.get("actions"))+" last_seq="+str(d.get("last_seq"))+" up="+str(d.get("uptime_s"))+"s")' 2>/dev/null || echo unreachable)"

# --- mirror (БД) ---
MS=$(curl -s -m 5 "localhost:3041/mirror?fresh=1" 2>/dev/null || true)
echo "mirror=$(printf '%s' "$MS" | python3 -c '
import sys,json
d=json.load(sys.stdin); st=d.get("state",d)
pend=st.get("pending", d.get("pending","?"))
le=st.get("last_error")
le=le.get("code") if isinstance(le,dict) else (le or "none")
print("pending="+str(pend)+" mirrored="+str(st.get("mirrored_local_seq","?"))+" last_err="+str(le))' 2>/dev/null || echo unreachable)"

# --- branches ---
git fetch origin sandbox/me2-os work/r85-control-room-ui-v1 --quiet 2>/dev/null || true
echo "main_local=$(git rev-parse --short HEAD)"
echo "sandbox_remote=$(git ls-remote origin refs/heads/sandbox/me2-os 2>/dev/null | cut -c1-8)"
echo "pr_remote=$(git -C "$DESK" ls-remote origin refs/heads/work/r85-control-room-ui-v1 2>/dev/null | cut -c1-8)"
for w in /home/z/me2-wt-r86 /home/z/me2-r85 "$DESK"; do
  [ -d "$w" ] && echo "wt $(basename "$w")=$(git -C "$w" log --oneline -1 2>/dev/null | cut -c1-30) dirty=$(git -C "$w" status --porcelain 2>/dev/null | wc -l)"
done
AH=$(git rev-list --count origin/sandbox/me2-os..main 2>/dev/null || echo "?"); BH=$(git rev-list --count main..origin/sandbox/me2-os 2>/dev/null || echo "?")
echo "rail_ahead_behind=${AH}/${BH}"

# --- CI / freeze gate (PR-branch Package Smoke) ---
set -a; . /home/z/.a2/.github.env; set +a
CIJSON=$(curl -s -m 15 -H "Authorization: token ${GITHUB_TOKEN_ADMIN}" "https://api.github.com/repos/PatrickFrome/Compute/actions/runs?branch=work/r85-control-room-ui-v1&per_page=30" 2>/dev/null || echo "{}")
printf '%s' "$CIJSON" | python3 -c '
import sys,json
d=json.load(sys.stdin); runs=d.get("workflow_runs",[])
sm=[r for r in runs if "smoke" in r["name"].lower()]
if not sm: print("pkgsmoke=unknown"); print("freeze=OPEN_UNKNOWN")
else:
    r=sm[0]
    print("pkgsmoke=#"+str(r["run_number"])+" "+str(r["status"])+" "+str(r["conclusion"])+" head="+r["head_sha"][:8])
    print("freeze=FROZEN" if r["status"]=="in_progress" else "freeze=OPEN")
succ=sum(1 for r in runs if r.get("conclusion")=="success"); fail=sum(1 for r in runs if r.get("conclusion")=="failure")
print("ci_rollup="+str(succ)+"ok/"+str(fail)+"fail/"+str(len(runs))+"recent")
' 2>/dev/null || { echo "pkgsmoke=api-failed"; echo "freeze=FROZEN_BY_DEFAULT"; }

echo "== VERDICT: фаза 2 (выбор задачи desktop-клиента: механизмы/контракты/UI) =="
echo "freeze_rule: PR-ветка push только при freeze=OPEN; контекстная рельса (push-pending-r80.sh) — всегда"
