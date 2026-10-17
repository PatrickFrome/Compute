#!/usr/bin/env bash
# ── SECURITY: одноразовая очистка git-истории от секретов (аудит 2026-10-18, C1) ──
#
# Контекст: в ветке 59dbfdc7a13caf4698074f4b475800df662e3066 (draft PR #1312) публичного
# репозитория PatrickFrome/Compute git-трекалась SQLite apps/me2-daemon/data/me2.db,
# чья таблица tokens содержала 6 секретов в plaintext:
#   GITHUB_TOKEN_ADMIN (ghp_…), SUPABASE_SERVICE_ROLE_JWT, SUPABASE_JWT_SECRET,
#   GITHUB_WEBHOOK_SECRET, VERCEL_AI_GATEWAY_API_KEY, SUPABASE_URL.
# В fixpack'е audit/fixpack-59dbfdc файл снят с трекинга и добавлен в .gitignore,
# НО секреты остаются в ИСТОРИИ коммитов до применения этого скрипта.
#
# ВАЖНО (порядок обязателен):
#   1) СНАЧАЛА ротация всех 6 секретов (см. SECURITY-ROTATION.md) — история
#      уже скомпрометирована, переписывание истории НЕ «отзывает» токен.
#   2) pip install git-filter-repo  (или brew install git-filter-repo)
#   3) Скрипт запускается в свежем КЛОНЕ (filter-repo отказывается работать
#      в репо без --force на нечистом клоне) на хосте оператора.
#   4) После перезаписи — force-push ветки PR и уведомление соавторов
#      (их локальные клоны ветки становятся несовместимыми).
set -euo pipefail

REPO="${1:?usage: $0 <path-to-fresh-clone>}"
cd "$REPO"

echo "==> [1/3] Удаляем секрет-содержащие блобы из всей истории..."
git filter-repo --force \
  --invert-paths \
  --path apps/me2-daemon/data/me2.db \
  --path apps/me2-daemon/data/me2.db-wal \
  --path apps/me2-daemon/data/me2.db-shm \
  --path apps/me2-daemon/daemon.log

echo "==> [2/3] Контрольная проверка: в истории не должно остаться ни одного блоба этих путей..."
if git log --all --oneline -- apps/me2-daemon/data/me2.db | grep -q .; then
  echo "FAIL: me2.db всё ещё в истории" >&2; exit 1
fi
if git rev-list --all --objects | grep -Eq 'me2\.db(-wal|-shm)?|daemon\.log'; then
  echo "FAIL: найдены остаточные блобы" >&2; exit 1
fi

echo "==> [3/3] Готово. Опубликуйте переписанную ветку:"
echo "    git push --force origin work/autonomous-development-fabric-v1-20261017"
echo
echo "Дополнительно (по желанию, для полной чистоты истории до PR-базы):"
echo "    gh pr close 1312 && переливить ветку на чистую историю (см. SECURITY-ROTATION.md §5)"
