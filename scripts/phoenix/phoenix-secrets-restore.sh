#!/usr/bin/env bash
# phoenix-secrets-restore.sh v1.1 — post-reset secrets self-restore ORCHESTRATOR (repo-safe: NO secret literals).
#
# Design invariant: PatrickFrome/Compute is anonymously readable, and GitHub auto-revokes PATs
# discovered in commits — therefore literal secrets NEVER enter the repo. They live ONLY in the
# SEALED bootstrap on surviving channels (PolarFS /tmp + mirrors + project sealed-local SEC-SEALED-3).
# After an env-reset:
#   1) anonymous clone works without auth:  git clone https://github.com/PatrickFrome/Compute.git
#   2) run this orchestrator — it finds the sealed bootstrap and restores the carriers
#   3) it validates the PAT and AUTO-RUNS the full project audit (full-audit.sh, operator directive)
#   4) it prints next steps (push-pending / guard / union-merge)
set -u

SEALED_CANDIDATES=(
  /home/z/my-project/scripts/phoenix/phoenix-secrets-restore.sealed.sh
  /tmp/my-project/phoenix-sealed/secrets-bootstrap.sh
  /tmp/context-vault-mirror/phoenix-sealed/secrets-bootstrap.sh
  /home/sync/me2-context-backups/phoenix-sealed/secrets-bootstrap.sh
)

auto_audit() {
  if [ -s /home/z/my-project/scripts/phoenix/full-audit.sh ]; then
    echo "== AUTO-AUDIT (директива оператора: скрипт автоматически запускает полный аудит) =="
    bash /home/z/my-project/scripts/phoenix/full-audit.sh 2>/dev/null | tail -3
  fi
}

have_env() { [ -s /home/z/.a2/.github.env ] && grep -q '^GITHUB_TOKEN_ADMIN=.' /home/z/.a2/.github.env; }

validate() {
  ( set -a; . /home/z/.a2/.github.env 2>/dev/null; set +a
    if [ -n "${GITHUB_TOKEN_ADMIN:-}" ]; then
      curl -s -o /dev/null -w '%{http_code}' -H "Authorization: token ${GITHUB_TOKEN_ADMIN}" https://api.github.com/user
    else echo 000; fi ) || echo 000
}

main() {
  if have_env; then
    C="$(validate)"; echo "state: github.env present (api=$C)"
    if [ "$C" = "200" ]; then echo "SECRETS: OK — nothing to restore"; auto_audit; exit 0; fi
    echo "state: token present but invalid (api=$C) — attempting re-seal from survivors"
  else
    echo "state: github.env MISSING — post-reset path"
  fi

  FOUND=""
  for t in "${SEALED_CANDIDATES[@]}"; do [ -s "$t" ] && { FOUND="$t"; break; }; done
  if [ -z "$FOUND" ]; then
    echo "SECRETS: FAIL — sealed bootstrap not reachable on: ${SEALED_CANDIDATES[*]}"
    echo "operator must re-supply PAT (and h205f22 SUPABASE_SERVICE_ROLE_JWT, lost 2026-09-26 17:11)"
    exit 2
  fi
  echo "sealed source: $FOUND"
  bash "$FOUND" restore

  if have_env; then
    C="$(validate)"; echo "state after restore: api=$C"
    if [ "$C" = "200" ]; then
      echo "SECRETS: RESTORED"
      echo "next: bash scripts/push-pending-r80.sh ; bash /home/z/context-vault/context-guard.sh"
      echo "note: if local main is BEHIND sandbox/me2-os — never force; fetch + section union (scripts/wl-merge.mjs) first"
      auto_audit
      exit 0
    fi
  fi
  echo "SECRETS: FAIL after restore attempt"
  exit 1
}
main "$@"
