# R15 Research — Per-client screencast через CDP (MJPEG + snapshot)

Дата: 2026-09-22 · Раунд: R15 · Daemon-цель: v0.15.0

## Контекст

Бэклог R14: «per-client jpeg-качество стрима :3042 (первый шаг — ресёрч возможностей
agent-browser stream-сервера)». Аудит раунда уточнил картину:

- **:3042 принадлежит бинарнику agent-browser** (`agent-browser-l`, stream-сервер,
  пинится `AGENT_BROWSER_STREAM_PORT=3042` в start.sh daemon'а). Его код мы менять не можем.
- `agent-browser stream --help`: WS-сервер, фреймы latest-first, **per-client уже есть**:
  `{"type":"config","maxFps":N}` (1–120) и `pacing:"ack"` — в т.ч. через URL
  `ws://127.0.0.1:PORT/?pacing=ack&maxFps=10`.
- **Чего нет: per-client jpeg-качество и масштаб** — бинарник шлёт jpeg фиксированного
  качества. Это и есть зазор для нашего вклада.

## Вывод: свой CDP-screencast на daemon (:3043)

Chromium agent-browser запускается с `--remote-debugging-port=0` (ephemeral), реальный порт
лежит в `/tmp/agent-browser-chrome-*/DevToolsActivePort` (первая строка). Аудит подтвердил:
CDP жив (`127.0.0.1:39265`, `/json/version` отвечает),_targets видны через `/json/list`.

CDP-контракт (Chrome DevTools Protocol, domain Page):

| Вызов | Параметры | Заметки |
|---|---|---|
| `Page.startScreencast` | `format:"jpeg", quality:0–100, maxWidth, maxHeight, everyNthFrame` | кадры только при «damage» экрана |
| `Page.screencastFrameAck` | `{sessionId}` | **обязателен** после каждого кадра, иначе поток останавливается после стартового бурста |
| `Page.captureScreenshot` | `format:"jpeg", quality, clip:{x,y,width,height,scale}` | одиночный снимок; `clip.scale` даёт серверный downscale БЕЗ мутации вьюпорта |
| `Page.getLayoutMetrics` | — | `cssContentSize` для расчёта scale |

Каждое WS-соединение к `ws://127.0.0.1:PORT/devtools/page/<targetId>` — **отдельная CDP-сессия**:
независимые startScreencast на одну страницу → честный per-client q/w/fps.

Транспорт браузеру: классический MJPEG `multipart/x-mixed-replace; boundary=frame` (Chrome рендерит
в `<img>`), плюс snapshot-роут для надёжного поллинга через reverse-proxy (Caddy
`reverse_proxy localhost:{query.XTransformPort}` — порт динамический, новых правил не требует).

## Дизайн daemon-роутов (:3043)

- `GET /screencast.jpg?q=60&w=960` — snapshot: getLayoutMetrics → clip.scale=min(1,w/dw) →
  captureScreenshot. Идеален для UI-тайла с автообновлением (каденс задаёт клиент).
- `GET /stream?q=60&w=960&fps=10` — MJPEG: per-client CDP-сессия, everyNthFrame из fps,
  ack на каждый кадр, `Page.stopScreencast` + close при отключении клиента.
- `GET /stats` — cdp-порт, целевой URL, активные стримы, счётчик кадров (наблюдаемость).
- Клампы: q∈[10,90], w∈[240,3840], fps∈[1,30]. Дискавери CDP: glob DevToolsActivePort по mtime
  desc, проверка `/json/version`; таргет — страница `localhost:81`/`:3000` (QA-вид), иначе первая
  `type:"page"`; ре-дискавери + ре-аттач с backoff при обрыве.

## Маппинг на ME2

- Реестр шины не трогаем (47/47): screencast — отдельный enrichment-сервер, как :3041 REST.
- Событие в hash-chain не пишем (спам от зрителей); наблюдаемость — :3043/stats.
- UI: тайл «LIVE» на дашборде — `<img src="/screencast.jpg?XTransformPort=3043&q=..&w=..">`
  с чипами качества (per-client q/w видны оператору глазами) + статус цели.

## Честные ограничения

- Кадры CDP приходят только при изменении экрана: статичный UI = последний кадр висит в `<img>`
  (это норма MJPEG), snapshot-режим не зависит от damage вообще.
- CDP-порт ephemeral: при респавне браузера нужен ре-дискавери (сделан в коде).
- «Зеркальный туннель»: если сам agent-browser смотрит дашборд с тайлом, тайл стримит сам себя
  (видео-фидбек). Каденс 2с и jpeg-квантование гасят каскад; честно фиксируем как известный
  эффект, не баг.
- several agent-browser инстансов = несколько chrome/CDP: дискавери выбирает инстанс, чей таргет
  содержит localhost:81/:3000, иначе самый свежий.

## Источники

- web_search: `r15-cdp-search.json`, `r15-mjpeg-search.json` (заголовки обрезаны платформой —
  использована каноническая спецификация CDP: chromedevtools.github.io/devtools-protocol/tot/Page).
- Пробы живой системы: `agent-browser stream --help`, `stream status --json`,
  `/tmp/agent-browser-chrome-*/DevToolsActivePort`, `ss -tlnp`.
