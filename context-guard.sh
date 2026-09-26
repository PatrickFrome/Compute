#!/usr/bin/env bash
# ============================================================================
# context-guard.sh — Phoenix Context Vault Guard (v1.0)
# ----------------------------------------------------------------------------
# Назначение: защита контекста работы от потери (env-reset, усечение, откат git).
# Слои защиты:
#   1. Детект усечения/удаления worklog.md + авторестор из последнего снапшота
#   2. Контентные снапшоты worklog.md (ротация, хранить 200)
#   3. latest/ — всегда актуальные копии (worklog, CONTEXT, sha256)
#   4. Журнал событий (journal/context-journal.log, incidents.log)
#   5. Локальная git-история в $VAULT/repo (коммит при каждом изменении)
#   6. Зеркало в /tmp/context-vault-mirror (переживает project-level reset)
#   7. Опциональный push ветки context-vault на GitHub при наличии PAT
#      (только если /home/z/.a2/.github.env существует; секреты НЕ печатаются
#       и НЕ пишутся в логи — токен используется только в argv процесса push)
# Самобэкап: копия самого скрипта кладётся в snapshots/, /tmp-зеркало и git.
# Тестируемость: CONTEXT_WL/CONTEXT_CTX позволяют подменить пути в тестах.
# ============================================================================
set -u

VAULT="/home/z/context-vault"
PROJ="/home/z/my-project"
WL="${CONTEXT_WL:-$PROJ/worklog.md}"
CTX="${CONTEXT_CTX:-$PROJ/CONTEXT.md}"
SNAP="$VAULT/snapshots"
LATEST="$VAULT/latest"
JOUR="$VAULT/journal"
ts="$(date +%Y%m%d-%H%M%S)"
log="$JOUR/context-journal.log"

mkdir -p "$SNAP" "$LATEST" "$JOUR" "$PROJ" /tmp/context-vault-mirror 2>/dev/null

sha_of()  { sha256sum "$1" 2>/dev/null | cut -d" " -f1; }
size_of() { stat -c%s "$1" 2>/dev/null || echo 0; }

# --- 1) Phoenix: восстановление worklog при потере/усечении -----------------
last_snap="$(ls -1t "$SNAP"/worklog-*.md 2>/dev/null | head -n1 || true)"
if [ -n "$last_snap" ]; then
  psize="$(size_of "$last_snap")"
  csize="$(size_of "$WL")"
  # эталон крупный, а текущий файл отсутствует или усечён более чем на 40%
  if [ "$psize" -gt 1000 ] && [ "$csize" -lt $((psize * 60 / 100)) ]; then
    if [ -f "$WL" ]; then
      cp "$WL" "$SNAP/truncated-$ts.md"
    fi
    cp "$last_snap" "$WL"
    echo "[$ts] RESTORE-EVENT: worklog восстановлен из $(basename "$last_snap") (было ${csize}B, эталон ${psize}B)" >> "$JOUR/incidents.log"
  fi
fi

# --- 2) Контентный снапшот при изменении ------------------------------------
if [ -s "$WL" ]; then
  cur="$(sha_of "$WL")"
  prev="$(cat "$LATEST/worklog.sha256" 2>/dev/null || echo "")"
  if [ -n "$cur" ] && [ "$cur" != "$prev" ]; then
    cp "$WL" "$SNAP/worklog-$ts.md"
    echo "$cur" > "$LATEST/worklog.sha256"
    echo "[$ts] SNAP bytes=$(size_of "$WL") sha=$cur" >> "$log"
  fi
  cp "$WL" "$LATEST/worklog.md" 2>/dev/null
  cp "$WL" /tmp/context-vault-mirror/worklog.md 2>/dev/null
fi

# --- 3) CONTEXT.md -> latest + зеркало ---------------------------------------
if [ -s "$CTX" ]; then
  cp "$CTX" "$LATEST/CONTEXT.md" 2>/dev/null
  cp "$CTX" /tmp/context-vault-mirror/CONTEXT.md 2>/dev/null
fi

# --- 4) Самобэкап скрипта -----------------------------------------------------
cp "$0" "$SNAP/context-guard.sh" 2>/dev/null || true
cp "$0" /tmp/context-vault-mirror/context-guard.sh 2>/dev/null || true

# --- 5) Ротация ---------------------------------------------------------------
ls -1t "$SNAP"/worklog-*.md 2>/dev/null | tail -n +201 | xargs -r rm -f
ls -1t "$SNAP"/truncated-*.md 2>/dev/null | tail -n +31 | xargs -r rm -f

# --- 6) Локальная git-история в хранилище ------------------------------------
if [ ! -d "$VAULT/repo/.git" ]; then
  git init -q "$VAULT/repo" 2>/dev/null || true
fi
if [ -d "$VAULT/repo/.git" ]; then
  cp "$WL" "$VAULT/repo/worklog.md" 2>/dev/null || true
  [ -s "$CTX" ] && cp "$CTX" "$VAULT/repo/CONTEXT.md" 2>/dev/null
  cp "$0" "$VAULT/repo/context-guard.sh" 2>/dev/null || true
  git -C "$VAULT/repo" add -A >/dev/null 2>&1 || true
  git -C "$VAULT/repo" -c user.email=guard@context-vault.local -c user.name=context-guard \
      commit -qm "vault snap $ts" >/dev/null 2>&1 || true
fi

# --- 7) Опциональный push на GitHub (только при наличии PAT) ------------------
# Секреты не печатаются и не логируются. Токен живёт только в argv процесса push.
if [ -s /home/z/.a2/.github.env ]; then
  # shellcheck disable=SC1091
  . /home/z/.a2/.github.env
  if [ -n "${GITHUB_TOKEN_ADMIN:-}" ]; then
    repo_url="$(git -C "$PROJ" remote get-url origin 2>/dev/null | sed -E 's#https://[^@/]+@#https://#' || true)"
    case "$repo_url" in
      https://github.com/*)
        push_url="${repo_url/github.com/x-access-token:${GITHUB_TOKEN_ADMIN}@github.com}"
        if git -C "$VAULT/repo" push "$push_url" HEAD:refs/heads/context-vault >/dev/null 2>&1; then
          echo "[$ts] REMOTE-PUSH ok -> context-vault" >> "$log"
        else
          echo "[$ts] REMOTE-PUSH failed" >> "$log"
        fi
        ;;
    esac
  fi
fi

n_snaps="$(ls -1 "$SNAP"/worklog-*.md 2>/dev/null | wc -l | tr -d ' ')"
echo "guard ok: snaps=$n_snaps latest_sha=$(cat "$LATEST/worklog.sha256" 2>/dev/null || echo none)"
