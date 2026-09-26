#!/usr/bin/env bash
# ============================================================================
# context-guard.sh — Phoenix Context Vault Guard (v1.1)
# ----------------------------------------------------------------------------
# v1.1: + SWAP-DETECT: если worklog.md не содержит ожидаемых маркеров
#       (R/CTX-записи) — файл считается подменённым чужим контентом
#       (инцидент 26.09 ~15:44: worklog перезаписан 1MB чужого архива).
#       Подмена -> quarantine swap-* + restore из последнего снапшота.
# Остальное как v1.0: усечение/удаление -> рестор; снапшоты по sha256;
# журнал; git-история; /tmp-зеркало; push context-vault при PAT.
# Секреты не печатаются и не логируются.
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
# Маркеры легитимного worklog: R-записи или CTX-записи или R15-поправка
MARKER_RE="Task ID: R|Task ID: CTX|Task ID: SH|ПОПРАВКА \(гит-синк\)"

mkdir -p "$SNAP" "$LATEST" "$JOUR" "$PROJ" /tmp/context-vault-mirror 2>/dev/null

sha_of()  { sha256sum "$1" 2>/dev/null | cut -d" " -f1; }
size_of() { stat -c%s "$1" 2>/dev/null || echo 0; }

last_snap="$(ls -1t "$SNAP"/worklog-*.md 2>/dev/null | head -n1 || true)"

# --- 1) SWAP-DETECT: чужой контент вместо нашего worklog ---------------------
if [ -s "$WL" ] && ! grep -qE "$MARKER_RE" "$WL" 2>/dev/null; then
  if [ -n "$last_snap" ] && [ "$(size_of "$last_snap")" -gt 1000 ]; then
    cp "$WL" "$SNAP/swap-$ts.md"
    cp "$last_snap" "$WL"
    echo "[$ts] SWAP-EVENT: worklog не содержит маркеров -> quarantine swap-$ts.md, рестор из $(basename "$last_snap")" >> "$JOUR/incidents.log"
  fi
fi

# --- 2) Phoenix: восстановление при потере/усечении --------------------------
if [ -n "$last_snap" ]; then
  psize="$(size_of "$last_snap")"
  csize="$(size_of "$WL")"
  if [ "$psize" -gt 1000 ] && [ "$csize" -lt $((psize * 60 / 100)) ]; then
    if [ -f "$WL" ]; then
      cp "$WL" "$SNAP/truncated-$ts.md"
    fi
    cp "$last_snap" "$WL"
    echo "[$ts] RESTORE-EVENT: worklog восстановлен из $(basename "$last_snap") (было ${csize}B, эталон ${psize}B)" >> "$JOUR/incidents.log"
  fi
fi

# --- 3) Контентный снапшот при изменении -------------------------------------
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

# --- 4) CONTEXT.md -> latest + зеркало ---------------------------------------
if [ -s "$CTX" ]; then
  cp "$CTX" "$LATEST/CONTEXT.md" 2>/dev/null
  cp "$CTX" /tmp/context-vault-mirror/CONTEXT.md 2>/dev/null
fi

# --- 5) Самобэкап скрипта -----------------------------------------------------
cp "$0" "$SNAP/context-guard.sh" 2>/dev/null || true
cp "$0" /tmp/context-vault-mirror/context-guard.sh 2>/dev/null || true

# --- 6) Ротация ---------------------------------------------------------------
ls -1t "$SNAP"/worklog-*.md 2>/dev/null | tail -n +201 | xargs -r rm -f
ls -1t "$SNAP"/truncated-*.md 2>/dev/null | tail -n +31 | xargs -r rm -f
ls -1t "$SNAP"/swap-*.md 2>/dev/null | tail -n +11 | xargs -r rm -f

# --- 7) Локальная git-история -------------------------------------------------
if [ ! -d "$VAULT/repo/.git" ]; then
  git init -q "$VAULT/repo" 2>/dev/null || true
fi
if [ -d "$VAULT/repo/.git" ]; then
  cp "$WL" "$VAULT/repo/worklog.md" 2>/dev/null || true
  [ -s "$CTX" ] && cp "$CTX" "$VAULT/repo/CONTEXT.md" 2>/dev/null
  cp "$0" "$VAULT/repo/context-guard.sh" 2>/dev/null || true
  cp "$VAULT/supabase-persist.sh" "$VAULT/repo/" 2>/dev/null || true
  git -C "$VAULT/repo" add -A >/dev/null 2>&1 || true
  git -C "$VAULT/repo" -c user.email=guard@context-vault.local -c user.name=context-guard \
      commit -qm "vault snap $ts" >/dev/null 2>&1 || true
fi

# --- 8) Опциональный push на GitHub (только при наличии PAT) ------------------
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

echo "guard ok: snaps=$(ls -1 "$SNAP"/worklog-*.md 2>/dev/null | wc -l | tr -d ' ') latest_sha=$(cat "$LATEST/worklog.sha256" 2>/dev/null || echo none)"
