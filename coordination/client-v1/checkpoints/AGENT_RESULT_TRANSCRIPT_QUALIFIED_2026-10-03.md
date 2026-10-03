# Checkpoint разработки — 3 октября 2026

Состояние: **SOURCE_QUALIFIED**. Это checkpoint рабочего среза; C2/C4/C5 physical
acceptance и mainline sealing не заявляются.

## Завершённый срез

Опубликован [коммит 3123af9eb17f810c4c08f599040637f1cc5bed01](https://github.com/PatrickFrome/Compute/commit/3123af9eb17f810c4c08f599040637f1cc5bed01)
в ветке `work/client-v1-agent-result-transcript-tail-v1`.
Основание: `29d76d8f51bbb307d74f55a306223445516875d1`.

Исправлены подсчёт длины transcript и чтение конца ответа Agent. Клиент больше
не теряет итоговый claim после первых 2 000 символов. При усечении census либо
изменении длины между чтениями результат и tool requests блокируются.
Пример протокола в prompt больше не принимается за готовый READY/ACCEPT claim.

Канонический roadmap: C2 First Serial Coding Loop; линия клиента —
C4_TYPED_PRODUCT_CONTROL → C5 useful verified work/restart. Срез исправляет
существующий путь result harvesting; новый scheduler и runtime authority не добавлены.

## Проверки точного опубликованного SHA

[Run 37103459439](https://github.com/PatrickFrome/Compute/actions/runs/37103459439),
push, attempt 1: **SUCCESS**, завершён 3 октября в 09:36 по Москве.

| Платформа | Целевые проверки | Полная Browser-регрессия | SLSA verifier |
| --- | --- | --- | --- |
| Windows 2025 | 39 PASS | 4 013 PASS; 0 ошибок, 0 пропусков | 10 PASS |
| Ubuntu 24.04 | 39 PASS | 4 011 PASS; 0 ошибок, 2 пропуска | 10 PASS |

Оба Linux-пропуска относятся к существующим Windows-only проверкам Guardian
PowerShell и bootstrap probe. Новый transcript/prompt-набор не содержит пропусков.
Новые 15 transcript-сценариев и 8 template-сценариев используют контролируемые
AX/HTTP fixtures и являются **SYNTHETIC**, а не доказательством живой работы z.ai.

До исправления девять из одиннадцати исходных transcript-canaries падали.
Prompt-only воспроизведение ошибочно записывало RESULT_READY; prompt с настоящим
ответом становился AMBIGUOUS. Рост/сокращение между чтениями также воспроизведены
до финального guard. Локальные финальные целевые проверки: 47 PASS.
YAML, parsing и whitespace: PASS. Рабочее дерево после публикации чистое.

Машиночитаемое терминальное evidence: `source-qualification-evidence-2026-10-03.json`.
Research: `agent-result-research-2026-10-03.md`.
Проверяемый patch: `agent-result-transcript.patch`.

## Installer / SLSA baseline

Физический кандидат `a68774eb6ad5a0fe8014501163b0c67f608bed09` сохраняет
**10/10 физических workflow SUCCESS**, каждый push/attempt 1.
Единственный producer — [Package Smoke 37087347663](https://github.com/PatrickFrome/Compute/actions/runs/37087347663).
Версия: `0.7.0-dev.37086632570.1`; candidate artifact: `11260817954`.

Заново скачаны package proof `11261117931` и SLSA proof `11261401099`.
SHA-256 обоих ZIP совпадает с текущим GitHub metadata. Внутренние evidence
согласованы по source SHA, версии, installer name/digest и producer identity.
Installer SHA-256 из этих evidence:
`937936bc51d431540762d170b7cc970fdfe1575b9879b885efdc22089e3f2455`.

Installer bytes в этом цикле не скачивались и заново не хешировались.
Новый source-срез не включён в этот installer. Перед физической сборкой нужен
новый source SHA, новая package version и полная one-producer qualification.
Повторной сборки уже потреблённой версии не было.

Предыдущий builder-pin срез `29d76d8f…` также подтверждён:
[run 37101948651](https://github.com/PatrickFrome/Compute/actions/runs/37101948651),
SUCCESS на Linux и Windows.

## Следующий подтверждённый блокер

1. Flat AX transcript смешивает пользовательские и модельные сообщения.
   Произвольный пользовательский valid claim пока может пройти parser.
   Нужна наблюдённая native AX/DOM структура настоящего z.ai Agent и положительная
   привязка assistant message к conversation, target/process, revision после
   отправки и текущей lease.
2. Отсутствие именованной кнопки Stop пока считается остановкой генерации.
   Это требует отдельного положительного terminal-наблюдения.
3. Затем C5: реальная coding-задача, worktree/diff, failing→passing test,
   независимый CRITIC ACCEPT точного result digest, durable VERIFIED readback,
   восстановление после перезапуска и следующий цикл.

Текущий C4 harness заканчивает ожидание после Agent-origin transport proof.
Primary READY и `user_goal_to_result_readback=true` сами по себе не заменяют
независимое принятие coding artifact. Существующий meta-orchestrator допускает
successor только после VERIFIED; этот путь следует переиспользовать.

В этом цикле не выполнялись production DB/Edge изменения, release/tag/merge,
promotion, установка на машину пользователя, смена admission или отправка задач
в реальные Agent sessions. Draft runtime PR отложен до новой физической identity:
существующий pull_request trigger запускает Package Smoke даже для draft.
