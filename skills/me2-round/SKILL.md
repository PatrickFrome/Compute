---
name: me2-round
description: >
  Протокол одного раунда разработки ME2 OS (daemon v0.18+ · Mission Control ·
  Tauri shell · GitHub sandbox/me2-os). Использовать ВСЕГДА при любой задаче
  «продолжи разработку», «следующий раунд», «закрой backlog», «проверь roadmap»
  или работе с me2-daemon / page.tsx / src-tauri — даже если пользователь не
  сказал «раунд». Превращает расплывчатое «продолжай» в безопасный, верифицируемый
  цикл: аудит → выбор пункта из worklog → малая реализация → REST-тесты →
  браузерная QA только через :81 → VLM-ревью с программной верификацией находок →
  lint 0/0 → git-sync в sandbox/me2-os → запись в worklog.
---

# ME2 Round Protocol

Раунд = один законченный приращённый цикл разработки системы ME2. Ценность
протокола: каждый раунд оставляет систему **запущенной, зелёной и запушенной**,
а историю — восстановимой из worklog. Пропуск шагов «экономит» минуты и стоит
часы отката.

## 0. Инварианты (нарушать нельзя)

- **Секреты** живут только в `/home/z/.a2/` (`.github.env` = GITHUB_TOKEN_ADMIN,
  `.ghtoken-sandbox`, `supabase-cloud.env` = SUPABASE_URL + SERVICE_ROLE_KEY).
  Если каталог пропал (env-reset) — восстановить дословно, perms 600. В tree —
  ноль секретов; перед push проверка: `git diff --cached | grep -cE "ghp_|vck_|eyJhbGciOi"` → 0.
- **Реестр действий = 47/47.** Новые операции — отдельные REST-семейства
  (`/codegraph*`, `/sandbox*`, `/verdicts`…), НЕ новые действия шины.
- **Порты**: WS :3040, REST :3041, screencast :3042, Next :3000, gateway :81.
  Браузерная проверка ТОЛЬКО `http://localhost:81/` (другие порты пользователю
  не видны). Gateway-запросы: относительный путь + `?XTransformPort=3041`.
- **Рестарт daemon** — только `bash mini-services/me2-daemon/start.sh`.
  Никаких `bun run build`; маршруты Next не добавлять (всё в page.tsx).
- **GitHub**: push только `main:sandbox/me2-os` через scripts/git-sync.sh;
  НИКОГДА не `git pull` (тянёт старый monorepo main — R15-инцидент) и не трогать
  remote main.
- **Supabase** evidence-mirror: PGRST205 → не ретраить циклично, ждём SQL от оператора.

## 1. Аудит (2 мин)

```bash
curl -s localhost:3041/health                       # версия + 47/47 + last_seq
cd /home/z/my-project && git log --oneline -3       # локальный HEAD
tail -60 worklog.md                                 # последний раунд: что сделано, backlog
ls /home/z/.a2/                                     # секреты на месте?
```
Аномалии окружения (пропавшие каталоги, обнулённый event-log) чинить ПЕРВЫМ
делом и фиксировать в worklog — они объясняют «странные» результаты дальше.

## 2. Выбор работы

Backlog берётся из последнего entry worklog.md (его Stage Summary → backlog).
Один раунд = 1–3 пункта МАЛОГО объёма. Приоритет: сломанное > недоделанное >
новое. Длинные работы резать между push'ами.

## 3. Реализация

- daemon-код: `mini-services/me2-daemon/src/<модуль>.ts`, маршруты в index.ts,
  VERSION bump. Стиль — как worktrees.ts/sandbox.ts (spawnSync-обёртки, белые
  списки имён, caps, throw с машинными кодами ошибок).
- консоль: только src/app/page.tsx; паттерн — collapsible Card из R16/R17
  (ГРАФ КОДА / РОАДМАП / САНДБОКС): состояние + loadX + JSX-карточка.
- тёмная тема: zinc-800/900/950 + акценты (teal/emerald/amber/rose/cyan);
  NO indigo/blue. Декоративные SVG-слои — pointer-events:none (урок R12).
- tooltip не должен обрезаться: оценивать высоту содержимого (estH), флип.

## 4. Верификация (без неё раунд не закрыт)

1. REST-тесты каждого нового маршрута (curl, включая негативные).
2. `bun run lint` → 0/0.
3. agent-browser на :81: клик по новому UI, a11y-snapshot, скриншот
   `download/rN-*.png`. Интерактивность проверять действиями, не скриншотом.
4. VLM-ревью (z-ai vision, 2 прохода: десктоп + мобильный 390). КАЖДУЮ находку
   VLM перепроверять программно (scrollWidth/computed styles/DOM-числа) —
   исторически 2/3 находок ложные (R16).
5. dev.log на ошибки после всех действий.

## 5. Запись + пуш

1. worklog.md — append (никогда не перезаписывать) секции по шаблону:
   `---` / Task ID: `R<N>-<SLUG>-<YYYYMMDD>` / Agent / Task / Work Log / Stage Summary
   (+ UX-урок №, + backlog следующего раунда).
2. commit + `bash scripts/git-sync.sh` (push main → sandbox/me2-os).
3. Проверить CI на GitHub (api.github.com runs?branch=sandbox/me2-os): упал —
   скачать job-лог и чинить в этом же или следующем раунде.

## Извлечённые уроки (не повторять)

- **RLIMIT_NPROC — per-UID**, не per-child: в мультипроцессной среде душит
  fork (R17). Изоляция exec: `prlimit --as=1GiB --nofile=256 --core=0`.
- **Tauri updater secret** требует minisign-формат со строкой `untrusted
  comment:` — иначе build падает «Missing comment in secret key» (R18).
  Фолбэк: ephemeral keypair в CI.
- **Cold-start вердикты**: проверки «живости» (спаны, счётчики) не должны
  ложноругаться сразу после рестарта — boot-span обязателен.
- **reward hacking**: COMPLETED ≠ решено; детекция finish-без-работы —
  события + /verdicts, статус задачи не меняем (решает оператор).
- z-ai CLI — только синхронно; Task-подагенты могут таймаутить без провала.
