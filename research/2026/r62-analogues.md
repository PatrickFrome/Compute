# R62 — Exec/Edit tools: сверка с каноном Cursor (трек A корпуса R61)

Раунд: R62 (2026-09-24). Слайс **P0-a** из R61-GAP-ANALYSIS §P0-0 — первый гэп DAG,
закрываемый кодом (гэп №1 из 15 P0). Источник канона: официальный корпус Cursor,
скачанный в R61 (329 стр., `tool-results/r61/fetch-corpus.py`, трек A `tool-results/r61/tracks/A-core.md`:
«terminal-tool», «run-modes», «edit-files», «checkpoints» — все с цитатами и HIGH confidence).

## 1. Канон Cursor (цитаты из корпуса)

| # | Capability | Статус | Цитата (корпус R61) |
|---|-----------|--------|---------------------|
| 1 | terminal-tool | GA | «Cursor runs shell commands directly in your terminal. Your Run Mode controls when commands run, when Cursor asks, and when terminal commands enter the sandbox.» |
| 2 | run-modes | GA | Три режима: Auto-review (allowlisted сразу; остальное — sandbox, если возможно; несандбоксное — классификатору), Allowlist (детерминированный), Run Everything. «Auto-review is not a security boundary» (классификатор = «small Cursor-managed model… Claude 4.5 Haiku or GPT-5.4 Mini»). |
| 3 | sandbox терминала | GA | «sandbox blocks unauthorized file access and network activity»; network default-deny с ~100-доменным allowlist пакетных менеджеров (трек D). |
| 4 | edit-files | GA | «Suggest edits to files and apply them automatically»; diff view live; per-model edit formats (patch-based для OpenAI-обученных, string-replacement для Anthropic-обученных). |
| 5 | checkpoints | GA | «Agent automatically creates them before making significant changes»; restore из таймлайна; «stored locally, separate from Git; restores files only». |
| 6 | CURSOR_AGENT env | GA | «Use the CURSOR_AGENT environment variable in your shell config to detect when Cursor is running» — маркерная переменная агентской сессии в окружении ребёнка. |

## 2. Что построено в R62 (me2.exec.v1 + me2.edit.v1)

- **`src/exec.ts`** (TERMINAL_RUN, REST `/exec`): white-list **по сегментам** (split `| ; && || \n` — каждый
  первый токен против `ALLOWED_BINARIES` из 30 бинарей) → запрет `$()`/backticks (подстановки скрывают
  бинарь от анализа) → запрет env-присваиваний (`FOO=1 cmd`) → hostile-паттерны (fork bomb, rm -rf /,
  mkfs, dd, sudo, сетевые бинари curl/wget/nc/ssh — egress-политика честно отложена в P0-2) →
  prlimit (`--as=4GiB --nofile=256 --core=0`; RLIMIT_NPROC per-UID не трогаем — урок R17) →
  таймаут 1..60с (spawnSync-kill) → env-БЕЛЫЙ-СПИСОК (env ребёнка строится с нуля: PATH/HOME/TMPDIR/
  LANG/TERM/ME2_EXEC/ME2_HOST_VERSION — секреты daemon'а не покидают процесс, вердикт отдаёт
  `env_keys` как доказательство) → cwd только в управляемых корнях (SB_ROOT/worktrees, realpath) →
  журнал `exec_runs` + события `TERMINAL_RUN`/`EXEC_DENIED` в hash-chain + span.
- **`src/edit.ts`** (FILE_EDIT, REST `/file`): unified-diff → **`patch --dry-run` валидация** →
  durable-бэкап исходного содержимого в SQLite (`file_edits.backup`) → применение → авто-откат при
  гонке после валидного dry-run; `POST /file {op:"rollback", edit_id}` — восстановление байт-в-байт из
  журнала; single-file заголовки (оба = цель, до первого @@); отказ удалений/`/dev/null`-цели,
  `.git`-целей, `..`-traversal, абсолютных путей; цель только в управляемых корнях; caps: diff ≤256KB,
  файл ≤2MB (rollback-гарантия), patch timeout 15с.
- **Манифест non-bypass 30→32** (`ENFORCED_WRITE_FAMILIES` + `/exec` + `/file`), бюджет-веса
  `EXEC_DENIED:2`, `EDIT_ROLLBACK:3`. Шина 47/47 не тронута (REST-семейства, канон R60).
- **eval v26**: `contract.exec_tool` + `contract.edit_tool` (чистые plan-инварианты + живой прогон
  echo + живой цикл apply→rollback; probe-режим — офлайн-сводка) → **PASS 63/63**.

## 3. Сверка с каноном (где строже / равно / отстаём)

| Измерение | Cursor | ME2 R62 | Вердикт |
|---|---|---|---|
| Approval-тир | allowlist → sandbox-ability → LLM-классификатор (Auto-review) | allowlist (детерминированный, «Allowlist»-режим канона) | **PARTIAL**: классификатор = слайс P0-1 (осознанно следующий) |
| OS-изоляция exec | Seatbelt/Landlock (sandbox.json, network default-deny) | prlimit as/nofile/core + таймаут + env-белый-список | **PARTIAL**: Landlock/egress = P0-2; env-белый-список уже строже (child env строится с нуля) |
| Гранулярность allowlist | на уровне команды (Run Mode) | **на уровне каждого сегмента** конвейера | **СТРОЖЕ канона**: `echo hi && curl evil` отсекается вторым сегментом |
| Подстановки | не документировано (shell полный) | явный отказ `$()`/backticks с честной причиной | **СТРОЖЕ** (осознанное ограничение P0-a, лифтится с P0-1/P0-2) |
| Edit-вход | per-model форматы (patch/str-replace) | единый unified-diff (канон patch(1)) | **PARTIAL**: один формат; per-model — после P0-1 |
| Валидация применения | diff view для человека; auto-apply | `--dry-run` до применения (машинная) + auto-rollback при гонке | **СТРОЖЕ по механике** (dry-run = pre-validation), человек в контуре пока оператор |
| Rollback | checkpoints: локальные снапшоты, restore из таймлайна, «separate from Git» | durable-бэкап в SQLite-журнале (agent не может подменить бэкап на диске), байт-в-байт, события в hash-chain | **СТРОЖЕ** (tamper-evident контур; у Cursor бэкапы — локальные файлы) |
| Маркер сессии | CURSOR_AGENT в env | ME2_EXEC=1 + ME2_HOST_VERSION в env-белом списке | **PARITY** (тот же узор) |
| Timeout/kill | не документировано (мониторинг вывода) | 1..60с spawnSync-kill, timed_out в вердикте | **SUPERIOR-ниша** (программный вердикт против «мониторинга») |
| Агентская петля | edit→run→observe→repair автономно (L3-L4) | оператор/агент через REST; демо edit→run→green работает | **PARTIAL**: автопетля агента = следующий слой (agentchat-инструменты) |

## 4. Живые пробы R62 (факты, не слова)

- создание файла диффом `--- /dev/null` → **exit 0**, hunks=1, sha256_after записан, rollback_at=9;
- правка существующего (v2) → applied; **rollback id=12 → содержимое байт-в-байт = v1**;
- `node p0a-demo.js` под prlimit: 1GiB VA → **V8 OOM (CodeRange)**; 4GiB → exit 0 (VA ≠ RSS,
  резидента ограничена таймаутом/nofile/core — живой урок для канона);
- `sleep 5` при timeout_ms=1000 → убит на **1002мс**, timed_out=true;
- негативы: curl → `cmd_denied/net_binary`, 2-й сегмент curl → отказ, `$(whoami)` →
  `substitution_denied`, `FOO=1 ls` → `env_assign_denied`, cwd=/home/z/my-project → `root_denied`,
  `bash -c` → `binary_not_allowed`.

## 5. Следствия для дорожной карты

1. **P0-1 (Run Modes + классификатор)** ложится прямо на planExec: классификация вердикта плана
   (разрешено-белым-списком / вне-списка-но-неопасно / требует-человека) — объект уже структурирован.
2. **P0-2 (OS-конфайнмент)**: egress-политика заменит хостильный список сетевых бинарей; Landlock
   добавит fs-конфайнмент сверх prlimit.
3. **Агентская петля**: exectools — инструменты для agentchat (execChatToolSync): агент получает
   `terminal_run`/`file_edit` как tools, супервизор видит EXEC_DENIED в бюджете риска.
4. **Update electron-analogs-master.md**: инвентарь п.11 — «durable rollback журналом строже
   checkpoint'ов Cursor» (этот документ).

Мастер-док: `research/2026/electron-analogs-master.md` (инвентарь/дорожная карта обновлены R62).
