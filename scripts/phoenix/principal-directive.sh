#!/usr/bin/env bash
# principal-directive.sh — canonical METAENGINE convergence directive loader.
# Usage:
#   bash principal-directive.sh          -> print FULL directive (verbatim, feeds the agent run)
#   bash principal-directive.sh --sha    -> print integrity sha256
#   bash principal-directive.sh --check  -> verify file exists & non-empty, exit 0/1
# Mirrors (env-reset survival): /home/z/context-vault/latest/, /home/sync/me2-context-backups/latest/
set -u
P="/home/z/my-project/scripts/phoenix/PRINCIPAL-DIRECTIVE.md"
M1="/home/z/context-vault/latest/PRINCIPAL-DIRECTIVE.md"
M2="/home/sync/me2-context-backups/latest/PRINCIPAL-DIRECTIVE.md"
SRC=""
for c in "$P" "$M1" "$M2"; do
  [ -s "$c" ] && { SRC="$c"; break; }
done
if [ -z "$SRC" ]; then echo "ERROR: directive missing in all locations" >&2; exit 1; fi
case "${1:-}" in
  --sha) sha256sum "$SRC" | cut -d' ' -f1 ;;
  --check) [ -s "$SRC" ] && echo "directive-ok src=$SRC" || exit 1 ;;
  *) cat "$SRC" ;;
esac
