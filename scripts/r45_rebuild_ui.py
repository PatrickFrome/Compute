#!/usr/bin/env python3
# R45: полная пересборка интерфейса ME2 → панельный шелл (v5).
# Панель №1 «БРАУЗЕР» (главная): список чатов-агентов + живой сайт на экране.
# Всё остальное → панели ФЛОТ / МИССИЯ / ТЕЛЕМЕТРИЯ / ЖУРНАЛ.
import io, sys

P = "/home/z/my-project/src/app/page.tsx"
src = io.open(P, "r", encoding="utf-8").read()
lines = src.split("\n")  # 0-based idx
n = len(lines)

def find_one(needle, start=0, end=None):
    end = end or n
    hits = [i for i in range(start, end) if needle in lines[i]]
    assert len(hits) >= 1, f"anchor not found: {needle!r}"
    return hits[0]

def find_eq(exact, start=0):
    hits = [i for i in range(start, n) if lines[i] == exact]
    assert len(hits) >= 1, f"exact anchor not found: {exact!r}"
    return hits[0]

CARD_OPEN = '          <Card'
CARD_CLOSE = '          </Card>'

def card_block(anchor, start=0):
    """[open,end] строки Card-блока по уникальному тексту заголовка."""
    a = find_one(anchor, start)
    o = a
    while o >= 0 and not lines[o].startswith(CARD_OPEN):
        o -= 1
    assert o >= 0, f"card open not found for {anchor!r}"
    e = o
    while e < n and lines[e] != CARD_CLOSE:
        e += 1
    assert e < n, f"card close not found for {anchor!r}"
    return (o, e)

def block(a, b):
    return lines[a:b + 1]

# ── якоря заголовков карточек ─────────────────────────────────────
ag_o, ag_e = card_block("ФЛОТ · АГЕНТЫ (")
cd_o, cd_e = card_block("CDP · LIVE")
wk_o, wk_e = card_block("WORKERS ({snap")
cg_o, cg_e = card_block("ГРАФ КОДА{cg")
rm_o, rm_e = card_block("РОАДМАП M1–M7{rm")
sb_o, sb_e = card_block("САНДБОКС{sb")
mc_o, mc_e = card_block("МЕХАНИКИ{mech")
br_o, br_e = card_block("ВЕТКИ · ЗАДАЧИ (")
qu_o, qu_e = card_block("ОЧЕРЕДЬ ЗАДАЧ ({snap")
cb_o, cb_e = card_block("COMMAND BUS")
el_o, el_e = card_block("/> EVENT LOG")

# порядок/непересечение (санити)
segs = sorted([(ag_o, ag_e), (cd_o, cd_e), (wk_o, wk_e), (cg_o, cg_e), (rm_o, rm_e),
               (sb_o, sb_e), (mc_o, mc_e), (br_o, br_e), (qu_o, qu_e), (cb_o, cb_e), (el_o, el_e)])
for (a1, b1), (a2, b2) in zip(segs, segs[1:]):
    assert b1 < a2, f"card blocks overlap: {(a1,b1)} vs {(a2,b2)}"

# ── полосы внутри ветки (последовательные блоки-строки) ───────────
s_sense  = find_one("{/* R20: SENSE")
s_obsv   = find_one("{/* R21: OBSV")
s_bench  = find_one("{/* R25: BENCH")
s_eval   = find_one("{/* R26 B1: EVAL")
s_hyg    = find_one("{/* R31 D4: DB·HYGIENE")
s_evch   = find_one("{/* R33 E2: EVIDENCE·CHAIN")
s_auto   = find_one("{/* R38 H1: AUTONOMY·V4")
s_gov    = find_one("{/* R43 G11+G10")
s_pool   = find_one("{/* R34 E3: EXECUTOR·POOL")
s_agent  = find_one("{/* R36 G1: AGENT·CHAT")
s_cast   = find_eq("                {castOn && (")
s_graph  = find_one("mc-scroll min-h-0 flex-1 basis-auto overflow-y-auto px-2 py-1")
order = [s_sense, s_obsv, s_bench, s_eval, s_hyg, s_evch, s_auto, s_gov, s_pool, s_agent, s_cast, s_graph]
assert order == sorted(order), f"strip order broken: {order}"
assert s_sense > br_o and s_graph < br_e, "strips are outside branch card?!"

def strip(a, b):
    """полоса → блок с dedent 16→10."""
    out = []
    for l in lines[a:b + 1]:
        out.append(l[6:] if l.startswith("                ") else l)
    return out

def to_card(st, testid):
    """обернуть полосу в самостоятельную карточку."""
    body = list(st)
    for i, l in enumerate(body):
        if 'className="shrink-0 border-b border-zinc-800/60 bg-black/20 px-3 py-2' in l:
            body[i] = l.replace(
                'className="shrink-0 border-b border-zinc-800/60 bg-black/20 px-3 py-2',
                'className="space-y-1.5 rounded-lg border border-zinc-800 bg-zinc-950/40', 1)
            break
    head = [f'          <Card className="shrink-0 border-zinc-800 bg-zinc-900/40 card-lift" data-testid="{testid}">',
            '            <CardContent className="p-3">']
    tail = ['            </CardContent>', '          </Card>']
    return head + body + tail

b_sense  = to_card(strip(s_sense, s_obsv - 1), "tl-sense")
b_obsv   = to_card(strip(s_obsv, s_bench - 1), "tl-obsv")
b_bench  = to_card(strip(s_bench, s_eval - 1), "tl-bench")
b_eval   = to_card(strip(s_eval, s_hyg - 1), "tl-eval")
b_hyg    = to_card(strip(s_hyg, s_evch - 1), "tl-hygiene")
b_evch   = to_card(strip(s_evch, s_auto - 1), "tl-evchain")
b_auto   = to_card(strip(s_auto, s_gov - 1), "tl-autonomy")
b_gov    = to_card(strip(s_gov, s_pool - 1), "tl-governor-demand")
b_pool   = to_card(strip(s_pool, s_agent - 1), "fleet-pool")

# ── ветка: вырезать полосы (SENSE..CAST) ──────────────────────────
branch = lines[br_o:br_e + 1]
rel_sense = s_sense - br_o
rel_graph = s_graph - br_o
branch_trimmed = branch[:rel_sense] + branch[rel_graph:]
# карточка ветки больше не зависит от castOn (урок высоты R8/R9 остаётся)
branch_trimmed = [l.replace('${castOn ? "lg:max-h-none lg:shrink-0" : "lg:max-h-[42vh]"}', 'lg:max-h-[52vh]') for l in branch_trimmed]
assert any("lg:max-h-[52vh]" in l for l in branch_trimmed), "branch card class patch failed"

# ── хедер ─────────────────────────────────────────────────────────
hdr_c = find_one("      {/* ── HEADER ── */}")
hdr_e = find_one("      </header>", hdr_c)
main_c = find_one("{/* ── MAIN: 3 колонки ── */}")
main_o = find_one('<main className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-3 lg:overflow-hidden">', main_c)
main_e = find_one("      </main>", main_o)

HEADER = r'''      {/* ── HEADER v5: бренд + ПАНЕЛИ-ВКЛАДКИ (как в браузере) + KPI ── */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-900/60 px-3 backdrop-blur sm:px-4">
        <Radar className="h-5 w-5 shrink-0 text-emerald-400" aria-hidden />
        <h1 className="hidden shrink-0 text-sm font-bold tracking-[0.2em] 2xl:inline">ME2 · MISSION CONTROL</h1>
        <Badge variant="outline" className="hidden shrink-0 border-zinc-700 font-mono text-[10px] text-zinc-400 md:inline-flex">
          v{snap?.meta.version ?? "?"}
        </Badge>
        {/* панели: главная БРАУЗЕР (чаты-агенты + живой сайт), остальные — по вкладкам */}
        <nav className="flex min-w-0 flex-1 items-end gap-0.5 self-stretch overflow-x-auto pt-2.5 [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Панели консоли" data-testid="panel-tabs">
          {PANELS.map((p, i) => {
            const Icon = p.icon;
            const active = panel === p.key;
            return (
              <button
                key={p.key}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`panel-tab-${p.key}`}
                title={`${p.hint} · Alt+${i + 1}`}
                onClick={() => switchPanel(p.key)}
                className={`-mb-px flex shrink-0 items-center gap-1.5 rounded-t-lg border border-b-0 px-2.5 py-1.5 text-[10px] font-semibold tracking-wider transition ${
                  active
                    ? "border-zinc-700 bg-zinc-950 text-emerald-300 shadow-[0_-3px_10px_rgba(16,185,129,0.07)]"
                    : "border-transparent text-zinc-500 hover:bg-zinc-900/70 hover:text-zinc-300"
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${active ? "text-emerald-400" : ""}`} aria-hidden />
                {p.label}
                <kbd className="ml-0.5 hidden rounded border border-zinc-800 px-1 font-mono text-[8px] font-normal text-zinc-600 lg:inline" aria-hidden>{i + 1}</kbd>
              </button>
            );
          })}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-3 text-xs text-zinc-400">
          <div className="hidden items-center gap-1.5 lg:flex" aria-label="KPI задач" role="group">
            <KpiTile label="ready" value={stats.tasksReady ?? 0} tone="text-zinc-200" />
            <KpiTile label="run" value={stats.tasksRunning ?? 0} tone="text-amber-400" />
            <KpiTile label="done" value={stats.tasksCompleted ?? 0} tone="text-emerald-400" />
            <KpiTile label="fail" value={stats.tasksFailed ?? 0} tone="text-rose-400" />
          </div>
          <span className="hidden 2xl:flex" aria-label="Активность"><Sparkline events={events} /></span>
          <span className="hidden items-center gap-1.5 md:flex" aria-live="polite">
            <Dot on={connected} pulse /> {connected ? "WS LIVE" : "WS OFFLINE"}
          </span>
          <Button variant="outline" size="sm" className="h-7 gap-1.5 border-zinc-700 text-xs" onClick={() => setCmdOpen(true)}>
            <Terminal className="h-3.5 w-3.5" /> ⌘K
          </Button>
        </div>
      </header>
'''

# ── ПАНЕЛЬ БРАУЗЕР ────────────────────────────────────────────────
BROWSER = r'''        {panel === "browser" && (
          <section className="flex min-h-0 flex-1 flex-col gap-3 p-3 lg:flex-row" aria-label="Браузер флота" data-testid="panel-browser">
            {/* левая колонка: открытые чаты-агенты (R44: вся работа оператора — в чатах, API снесён) */}
            <aside
              className={`min-h-0 flex-col gap-3 lg:w-[350px] xl:w-[400px] lg:shrink-0 ${chatSidebarOpen ? "flex" : "hidden"} ${chatSidebarOpen ? "lg:overflow-y-auto mc-scroll" : ""}`}
              aria-label="Чаты-агенты"
              data-testid="browser-chats"
            >
              <AgentChatPanel />
            </aside>

            {/* правая колонка: хром браузера + ЖИВОЙ САЙТ на экране */}
            <Card className="flex min-h-[420px] min-w-0 flex-1 flex-col overflow-hidden border-zinc-800 bg-zinc-900/40 card-lift lg:min-h-0" data-testid="browser-shell">
              {/* таб-полоса: живые вкладки agent-browser */}
              <div className="flex shrink-0 items-end gap-1 overflow-x-auto border-b border-zinc-800 bg-black/30 px-2 pt-1.5 [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Вкладки браузера" data-testid="browser-tabstrip">
                <span className="flex shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] font-bold tracking-widest text-emerald-300">
                  <Globe className="h-3 w-3" aria-hidden /> ME2
                </span>
                {browserTabs.map((t) => (
                  <span
                    key={t.id}
                    title={`${t.title}\n${t.url}`}
                    className={`flex max-w-52 shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 py-1 text-[10px] transition ${
                      t.active ? "border-zinc-600 bg-zinc-800 text-zinc-100" : "border-zinc-800 bg-zinc-900/60 text-zinc-400"
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.active ? "animate-pulse bg-sky-400" : "bg-zinc-600"}`} aria-hidden />
                    <span className="truncate">{t.title.slice(0, 30) || t.url}</span>
                  </span>
                ))}
                {browserTabs.length === 0 && !browserBusy && (
                  <button type="button" onClick={loadBrowserTabs} className="shrink-0 px-2 py-1 text-[10px] text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline">
                    показать вкладки
                  </button>
                )}
                <span className="ml-auto flex shrink-0 items-center gap-1 pb-1 pr-0.5">
                  <button
                    type="button"
                    onClick={() => setChatSidebarOpen((v) => !v)}
                    aria-pressed={chatSidebarOpen}
                    title="Показать/скрыть список чатов-агентов"
                    data-testid="browser-chats-toggle"
                    className={`rounded px-1.5 py-1 text-[10px] transition ${chatSidebarOpen ? "bg-emerald-500/15 text-emerald-300" : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"}`}
                  >
                    <PanelLeft className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => setCastOn((v) => !v)}
                    aria-pressed={castOn}
                    title="Живой вид активной вкладки — WS-стрим агента-браузера (:3042)"
                    className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[10px] transition ${castOn ? "bg-emerald-500/15 text-emerald-300" : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"}`}
                  >
                    <MonitorPlay className="h-3 w-3" aria-hidden /> live
                  </button>
                  {castOn && (
                    <button
                      type="button"
                      onClick={toggleCastCtl}
                      aria-pressed={castCtl}
                      title="Руль: клики, клавиатура и колесо в кадре идут в активную вкладку. Ctrl/Meta-комбо остаются у оператора."
                      className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[10px] transition ${castCtl ? "bg-amber-500/15 text-amber-300" : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"}`}
                    >
                      <MousePointerClick className="h-3 w-3" aria-hidden /> руль
                    </button>
                  )}
                  <button type="button" onClick={loadBrowserTabs} aria-label="Обновить вкладки браузера" className="shrink-0 rounded px-1.5 py-1 text-[10px] text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200">
                    <RefreshCw className={`h-3 w-3 ${browserBusy ? "animate-spin" : ""}`} aria-hidden />
                  </button>
                </span>
              </div>

              {/* адресная строка + профиль полосы */}
              <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-800 bg-zinc-900/60 px-2 py-1.5">
                <button
                  type="button"
                  onClick={reloadCast}
                  aria-label="Переподключить стрим и обновить кадр"
                  title="Переподключить стрим (:3042) и обновить CDP-кадр"
                  data-testid="browser-reload"
                  className="rounded border border-zinc-800 p-1 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
                >
                  <RotateCcw className={`h-3 w-3 ${castOn && !castStat.connected ? "animate-spin" : ""}`} aria-hidden />
                </button>
                <div className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-950/80 px-3" role="status" aria-label="Адрес активной вкладки" data-testid="browser-urlbar">
                  <ShieldCheck className="h-3 w-3 shrink-0 text-emerald-500" aria-hidden />
                  <span className="truncate font-mono text-[10px] text-zinc-300">{castStat.url ?? cdpInfo?.cdp?.target ?? "about:blank"}</span>
                </div>
                <div role="group" aria-label="Профиль полосы стрима" className="hidden items-center gap-0.5 rounded border border-zinc-800 bg-black/40 p-0.5 md:flex">
                  {(Object.keys(CAST_PROFILES) as CastProfile[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setCastProfile(p)}
                      aria-pressed={castProfile === p}
                      title={
                        p === "макс" ? "push-пейсинг, до 12 fps — минимум задержки (для руля)"
                        : p === "баланс" ? "ack-пейсинг, 8 fps — один кадр в полёте, без очередей"
                        : p === "эконом" ? "ack-пейсинг, 2 fps — минимум полосы для слабой сети"
                        : "ack-пейсинг, потолок fps подстраивается под измеренную полосу (2..12)"
                      }
                      className={`rounded px-1.5 py-0.5 font-mono text-[9px] transition ${castProfile === p ? "bg-emerald-500/15 text-emerald-300" : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"}`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* ВЬЮПОРТ: живой сайт (WS-стрим :3042; фолбэк — CDP-кадр :3043) */}
              <div className="relative min-h-[340px] flex-1 bg-black lg:min-h-0" data-testid="browser-viewport">
                {castOn ? (
                  <div
                    ref={castWrapRef}
                    tabIndex={castCtl ? 0 : -1}
                    onKeyDown={castKey}
                    aria-label={castCtl ? "Живой вид вкладки — ручное управление включено" : "Живой вид активной вкладки браузера"}
                    className={`absolute inset-0 overflow-hidden transition ${castCtl ? "cursor-crosshair select-none ring-1 ring-inset ring-amber-500/60 focus-visible:outline-none" : ""}`}
                  >
                    <img
                      ref={castImgRef}
                      alt="Живой вид активной вкладки браузера"
                      className="block h-full w-full object-contain"
                      draggable={false}
                      onPointerDown={(e) => castSendMouse("mousePressed", e)}
                      onPointerUp={(e) => castSendMouse("mouseReleased", e)}
                      onContextMenu={(e) => { if (castCtl) e.preventDefault(); }}
                    />
                    {castCtl && (
                      <div className="pointer-events-none absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-amber-500/90 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-black shadow">
                        <MousePointerClick className="h-3 w-3" aria-hidden /> РУЛЬ · клики/клавиатура → вкладка
                      </div>
                    )}
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-black/75 px-2 py-0.5 font-mono text-[9px] text-zinc-400">
                      <span className="truncate">{castStat.url ?? "ожидание кадра…"}</span>
                      <span className="shrink-0">
                        {castStat.connected ? (
                          <span className="text-emerald-400">● {castStat.fps} fps{castStat.kbs != null ? ` · ${castStat.kbs} КБ/с` : ""}{castStat.lastAge != null ? ` · ${castStat.lastAge}ms` : ""}</span>
                        ) : (
                          <span className="text-amber-400">● offline → CDP-фолбэк</span>
                        )}
                      </span>
                    </div>
                    {!castStat.connected && (
                      <img
                        key={`cdp-${cdpQ}-${cdpW}-${cdpTick}`}
                        src={`/screencast.jpg?XTransformPort=3043&q=${cdpQ}&w=${cdpW}&t=${cdpTick}`}
                        alt="CDP-фолбэк: кадр активной вкладки"
                        className="absolute inset-0 h-full w-full object-contain"
                        decoding="async"
                        onLoad={() => cdpNextTick(2000)}
                        onError={() => cdpNextTick(6000)}
                      />
                    )}
                    {!castStat.connected && (
                      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded border border-zinc-800 bg-black/85 px-2 py-1 text-center font-mono text-[9px] text-zinc-500">
                        {castStat.error ?? "подключение к стриму :3042…"}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="absolute inset-0 grid place-items-center">
                    <div className="max-w-xs space-y-2 text-center">
                      <MonitorPlay className="mx-auto h-6 w-6 text-zinc-700" aria-hidden />
                      <p className="text-[11px] text-zinc-500">стрим выключен — включите живой вид активной вкладки, сайт всегда на экране</p>
                      <Button size="sm" variant="outline" className="border-zinc-700 text-[10px]" onClick={() => setCastOn(true)}>включить live</Button>
                    </div>
                  </div>
                )}
              </div>

              {/* статус-строка браузера */}
              <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-zinc-800 bg-black/30 px-2 py-1 font-mono text-[9px] text-zinc-500" data-testid="browser-status">
                <button
                  type="button"
                  onClick={() => setCastConOpen((v) => !v)}
                  aria-expanded={castConOpen}
                  title="Живая лента console-событий вкладки из стрима (не в audit-журнале)"
                  className="flex items-center gap-1 rounded px-1 py-0.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
                >
                  <Terminal className="h-3 w-3" aria-hidden /> консоль ({castConsole.length})
                </button>
                <span className="hidden sm:inline">
                  {cdpInfo?.cdp ? <>cdp :{cdpInfo.cdp.port} · кадров {cdpInfo.frames} · стримов {cdpInfo.streams}</> : "cdp-цель не найдена"}
                </span>
                <span className="ml-auto flex items-center gap-1" role="group" aria-label="Качество CDP-фолбэка">
                  {[30, 55, 85].map((q) => (
                    <button
                      key={q}
                      type="button"
                      aria-pressed={cdpQ === q}
                      className={`rounded border px-1 py-0.5 font-mono text-[8px] transition ${cdpQ === q ? "border-violet-500 bg-violet-950/60 text-violet-300" : "border-zinc-800 text-zinc-500 hover:text-zinc-300"}`}
                      onClick={() => setCdpQ(q)}
                    >
                      q{q}
                    </button>
                  ))}
                  <span className="text-zinc-700" aria-hidden>·</span>
                  {[480, 640, 960].map((w) => (
                    <button
                      key={w}
                      type="button"
                      aria-pressed={cdpW === w}
                      className={`rounded border px-1 py-0.5 font-mono text-[8px] transition ${cdpW === w ? "border-violet-500 bg-violet-950/60 text-violet-300" : "border-zinc-800 text-zinc-500 hover:text-zinc-300"}`}
                      onClick={() => setCdpW(w)}
                    >
                      w{w}
                    </button>
                  ))}
                  <span className="hidden text-zinc-600 lg:inline">живая лента — не в audit-журнале</span>
                </span>
              </div>
              {castConOpen && (
                <div className="mc-scroll max-h-24 shrink-0 overflow-y-auto border-t border-zinc-800 bg-black/60 p-1.5 font-mono text-[9px] leading-relaxed">
                  {castConsole.length === 0 ? (
                    <p className="text-zinc-600">нет console-событий в этой сессии (http(s)-страницы; file:// не эмитит)</p>
                  ) : (
                    castConsole.map((m) => (
                      <div key={m.id} className="flex gap-1.5">
                        <span className={m.level === "error" ? "shrink-0 text-rose-400" : m.level === "warning" ? "shrink-0 text-amber-400" : "shrink-0 text-sky-400"}>{m.level}</span>
                        <span className="truncate text-zinc-300" title={m.text}>{m.text}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </Card>
          </section>
        )}
'''

# ── ПАНЕЛЬ ФЛОТ ───────────────────────────────────────────────────
def indented(block_, base="            "):
    return [base + l if l.strip() else l for l in block_]

FLEET = ["        {panel === \"fleet\" && (",
         '          <section className="mc-scroll min-h-0 flex-1 overflow-y-auto p-3" aria-label="Флот" data-testid="panel-fleet">',
         '            <div className="flex flex-col gap-4">',
         "              <FleetGrid />",
         '              <div className="grid gap-4 xl:grid-cols-2">'] \
        + indented(b_pool) \
        + indented(block(ag_o, ag_e)) \
        + ["              </div>"] \
        + indented(block(wk_o, wk_e)) \
        + ["            </div>",
           "          </section>",
           "        )}"]

# ── ПАНЕЛЬ МИССИЯ ─────────────────────────────────────────────────
MISSION = ["        {panel === \"mission\" && (",
           '          <section className="mc-scroll min-h-0 flex-1 overflow-y-auto p-3" aria-label="Миссия" data-testid="panel-mission">',
           '            <div className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">',
           '              <div className="flex min-w-0 flex-col gap-4">'] \
          + indented(branch_trimmed) \
          + indented(block(qu_o, qu_e)) \
          + ["              </div>",
             '              <div className="flex min-w-0 flex-col gap-4">'] \
          + indented(block(mc_o, mc_e)) \
          + ["              </div>",
             '              <div className="flex min-w-0 flex-col gap-4">'] \
          + indented(block(cg_o, cg_e)) \
          + indented(block(rm_o, rm_e)) \
          + indented(block(sb_o, sb_e)) \
          + indented(block(cb_o, cb_e)) \
          + ["              </div>",
             "            </div>",
             "          </section>",
             "        )}"]

# ── ПАНЕЛЬ ТЕЛЕМЕТРИЯ ─────────────────────────────────────────────
TELEMETRY = ["        {panel === \"telemetry\" && (",
             '          <section className="mc-scroll min-h-0 flex-1 overflow-y-auto p-3" aria-label="Телеметрия" data-testid="panel-telemetry">',
             '            <div className="grid items-start gap-4 lg:grid-cols-2">',
             '              <div className="flex min-w-0 flex-col gap-4">'] \
            + indented(b_sense) + indented(b_obsv) + indented(b_bench) + indented(b_eval) \
            + ["              </div>",
               '              <div className="flex min-w-0 flex-col gap-4">'] \
            + indented(b_hyg) + indented(b_evch) + indented(b_auto) + indented(b_gov) \
            + indented(block(cd_o, cd_e)) \
            + ["              </div>",
               "            </div>",
               "          </section>",
               "        )}"]

# ── ПАНЕЛЬ ЖУРНАЛ ─────────────────────────────────────────────────
LOG = ["        {panel === \"log\" && (",
       '          <section className="flex min-h-0 flex-1 flex-col p-3" aria-label="Журнал событий" data-testid="panel-log">'] \
      + indented(block(el_o, el_e)) \
      + ["          </section>",
         "        )}"]

MAIN_OPEN = ['      {/* ── MAIN v5: панельный шелл — активная панель монтируется условно (перф: невидимые панели не рендерятся) ── */}',
             '      <main className="flex min-h-0 flex-1 flex-col lg:overflow-hidden">']

# ── сборка ────────────────────────────────────────────────────────
out = lines[:hdr_c] + HEADER.split("\n") + MAIN_OPEN + BROWSER.split("\n") + FLEET + MISSION + TELEMETRY + LOG + lines[main_e + 1:]
io.open(P, "w", encoding="utf-8").write("\n".join(out))
print(f"OK: {n} -> {len(out)} lines")
print(f"cards: agents={ag_o}-{ag_e} cdp={cd_o}-{cd_e} workers={wk_o}-{wk_e} cg={cg_o}-{cg_e} rm={rm_o}-{rm_e} sb={sb_o}-{sb_e} mech={mc_o}-{mc_e} br={br_o}-{br_e} qu={qu_o}-{qu_e} cb={cb_o}-{cb_e} el={el_o}-{el_e}")
print(f"strips: sense={s_sense} graph={s_graph} cast={s_cast}")
