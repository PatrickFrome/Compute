# OPERATOR GUIDE — H205F22 Compute Fabric / PAP Coordination Zone

> Для владельца проекта (вас). Все шаги с прямыми ссылками.
> Составлено GLM 2026-08-22. Актуальность проверяйте по
> `shared/state/snapshot.json` (поле `user_actions_open`).

---

## Карта: где что живёт

| Что | Где | Ссылка |
|---|---|---|
| Живой control-plane | Supabase проект `xpeibufgzjknrhbhpffp` | https://supabase.com/dashboard/project/xpeibufgzjknrhbhpffp |
| Бакет зоны координации | Storage → `computefabric-parallel-glm` | https://supabase.com/dashboard/project/xpeibufgzjknrhbhpffp/storage/buckets |
| Код основного проекта | GitHub `PatrickFrome/Compute` | https://github.com/PatrickFrome/Compute |
| Cloudflare воркеры | Аккаунт `d9186d31bdcd...` | https://dash.cloudflare.com |
| Состояние сейчас | бакет → `shared/state/snapshot.json` | (через Storage UI) |
| Что должны сделать агенты | там же → поле `pending` | — |

---

## ШАГ 0 — Ротация скомпрометированных ключей (5 мин) ⚠️ ПЕРВЫЙ

Все ключи ниже передавались в открытых чатах → считать украденными.

1. **Supabase service_role JWT**
   - Открыть: https://supabase.com/dashboard/project/xpeibufgzjknrhbhpffp/settings/api
   - Секция **Project API keys** → `service_role` → **Reset** (или Regenerate).
   - Новый JWT понадобится позже (Шаг 1 секреты + выдать GLM-чату).
2. **Cloudflare API token** (`cfat_...`)
   - https://dash.cloudflare.com/profile/api-tokens
   - Найти токен → **Roll** или **Delete** + создать новый с теми же правами (Workers Scripts:Read).
3. **Cloudflare worker token** (`cfut_...`) и **supervisor token** — перевыпустить там же, где создавались.
4. Новые значения передавайте только в соответствующий чат агента (GLM — сюда, ChatGPT — в его чат). Нигде больше.

✅ Проверка: старый ключ больше не работает:
```bash
curl -s "https://api.cloudflare.com/client/v4/user/tokens/verify" -H "Authorization: Bearer СТАРЫЙ_ТОКЕН"
# должно быть: "success":false
```

---

## ШАГ 1 — Деплой PAP Transport (7 мин): прямая связь агентов

Это убирает вас из роли «копировщика сообщений» между чатами.

### 1a. Скачайте код функции
- https://supabase.com/dashboard/project/xpeibufgzjknrhbhpffp/storage/buckets → бакет `computefabric-parallel-glm`
- Путь в бакете: `shared/edge/pap-transport/index.ts` → **Download**.
- Сохраните локально в папку `pap-transport/index.ts`.

### 1b. Создайте два токена
```bash
openssl rand -hex 32   # → PAP_GLM_TOKEN (запишите!)
openssl rand -hex 32   # → PAP_CHATGPT_TOKEN (запишите!)
```
(Windows без openssl: любой генератор 64-символьного hex.)

### 1c. Задайте секреты и задеплойте
```bash
npx supabase login                    # откроет браузер для входа
npx supabase link --project-ref xpeibufgzjknrhbhpffp

npx supabase secrets set \
  PAP_GLM_TOKEN=<первый-токен> \
  PAP_CHATGPT_TOKEN=<второй-токен>

cd pap-transport
npx supabase functions deploy pap-transport --no-verify-jwt
```
Альтернатива без CLI: https://supabase.com/dashboard/project/xpeibufgzjknrhbhpffp/functions → **New function** → имя `pap-transport` → вставить содержимое index.ts → Deploy; секреты там же: Functions → Secrets (`PAP_GLM_TOKEN`, `PAP_CHATGPT_TOKEN`; `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` обычно уже есть).

✅ Проверка (smoke-тест):
```bash
curl -s "https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/pap-transport/pap/read?peer=glm&after_seq=0" \
  -H "Authorization: Bearer PAP_CHATGPT_TOKEN"
```
Ожидание: JSON с `"messages":[...7 конвертов glm...]`, `"gap_detected":false`.

Негативный тест (Law 2 работает):
```bash
curl -s -X POST ".../pap/publish" -H "Authorization: Bearer PAP_CHATGPT_TOKEN" \
  -d '{"schema":"metaengine.agent-message.h205f22.v1",...,"authority_effect":true}'
# ожидание: 400 invalid_envelope
```

---

## ШАГ 2 — GitHub Environment (3 мин) 🔴 разблокирует STEP08

Сейчас environment отсутствует (live 404) — это блокер всего W1.

1. Открыть: https://github.com/PatrickFrome/Compute/settings/environments/new
2. **Environment name:** `w1-persistent-host-proof` (точно, символ в символ)
3. Внутри environment настроить:
   - **Required reviewers** → добавить себя (1 ревьюер)
   - **Deployment branches and tags** → выбрать **Protected branches**
4. Защитить main: https://github.com/PatrickFrome/Compute/settings/branches
   - **Add branch ruleset** (или классическое rule) для `main`:
     - ✅ Require a pull request before merging
     - ✅ Require approvals: 1

✅ Проверка: https://github.com/PatrickFrome/Compute/environments — environment появился; в нём горит «1 reviewer».

---

## ШАГ 3 — AWS trust policy (3 мин): закрывает угрозу T2

1. https://console.aws.amazon.com/iam/home#/roles
2. Найти роль, на которую указывает `W1_AWS_ROLE_ARN` (виден в workflow «W1 AWS Persistent Host Preflight Only» → Variables).
3. Открыть **Trust relationships** и проверить:
   - Principal: `token.actions.githubusercontent.com` (GitHub OIDC)
   - Condition `sub`: **строго** `repo:PatrickFrome/Compute:ref:refs/heads/main` — НЕ wildcard `*`
   - Condition `aud`: `sts.amazonaws.com`
4. Скопировать текст trust policy → отправить в любой чат агента (это evidence для угроз-модели T2).

Если wildcards есть — сузить до указанного `sub` (сохранить старый JSON для отката).

---

## ШАГ 4 — Релей токена ChatGPT (1 мин)

Скопировать в чат GPT:

> Транспорт активирован. Endpoint: `https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/pap-transport/`
> Твой токен: `PAP_CHATGPT_TOKEN=<значение>`
> Заголовок: `Authorization: Bearer <токен>`
> Читай: `GET /pap/read?peer=glm&after_seq=0` · Публикуй: `POST /pap/publish` · Подтверждай: `POST /pap/ack`
> Твои задачи: (1) запустить `shared/read-plane/fingerprint.py` и опубликовать свой hex; (2) RECHECK угроз-модели v2; (3) persistence-witness proposal v1 в тред W1-persistence-ingress.

Свой `PAP_GLM_TOKEN` пришлите сюда, в этот чат.

---

## ШАГ 5 — CI-дайджест (опционально, 5 мин): email-уведомления о зоне

1. В репо https://github.com/PatrickFrome/Compute создать PR с файлами из бакета `shared/coordination-ci/` (digest.py, coordination-digest.yml) — или попросить GPT: это его канал.
2. Секреты: https://github.com/PatrickFrome/Compute/settings/secrets/actions
   - `SUPABASE_URL` = `https://xpeibufgzjknrhbhpffp.supabase.co`
   - `PAP_TRANSPORT_JWT` = read-only Storage-кред (см. RLS-миграцию `shared/proposals/glm/pap-transport-rls-v1.md` — GPT оформит PR)
3. После мержа: Actions → `coordination-digest` → Enable workflow.

Результат: ежедневно в 09:17 МСК — issue «[PAP] Coordination attention required», если есть необработанные сообщения.

---

## Порядок и минимальный набор

```
0 (ротация) → 1 (деплой) → 2 (environment) → 3 (AWS) → 4 (релей) → 5 (CI, опц.)
```
**Минимум при нехватке времени: шаги 0 + 2** (безопасность + разблокировка STEP08).

## Что произойдёт после всех шагов

- Чаты общаются напрямую: `GLM ↔ endpoint ↔ ChatGPT`, вы — только approvals.
- STEP08 префлайт впервые пройдёт (environment + branch policy + reviewers).
- Первый полный автономный цикл W1: proposal GPT → мой ATTACK → ревизия → CI-scorecard → EVIDENCE_READY → Supervisor.

## Куда смотреть, чтобы контролировать

- **Общее состояние**: бакет → `shared/state/snapshot.json` (SYNC_HEALTH, pending, user_actions_open)
- **Дайджест**: GitHub → Actions → coordination-digest (после Шага 5)
- **Лог всей работы**: бакет → `_worklog/worklog.md` (46 записей задач)
- **Живая фабрика**: `h205f22_health` через SQL-редактор https://supabase.com/dashboard/project/xpeibufgzjknrhbhpffp/sql/new
