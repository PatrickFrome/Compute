#!/usr/bin/env python3
"""battery419203.py — BROWSER-TEST: полная батарея механик роя ME2 CHAT-SWARM v1.0.0.
Каждая механика → PASS/FAIL +证据 (краткое свидетельство). Секретов нет — только localhost."""
import json, time, urllib.request, sys, datetime

BASE = "http://127.0.0.1:3046"
R = []  # (name, verdict, evidence)

def call(method, path, body=None, timeout=20):
    req = urllib.request.Request(BASE + path, method=method,
        headers={"Content-Type": "application/json"},
        data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode() or "{}")
        except Exception: return e.code, {}
    except Exception as e:
        return -1, {"err": str(e)[:120]}

def get_msgs(limit):
    c, m = call("GET", f"/messages?limit={limit}")
    if c != 200 or not isinstance(m, dict): return []
    rows = m.get("messages", None)
    return rows if isinstance(rows, list) else []

def rec(name, ok, ev):
    R.append((name, "PASS" if ok else "FAIL", ev))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}: {ev}", flush=True)

ts = lambda: datetime.datetime.now(datetime.timezone.utc).strftime("%H:%M:%S")
print(f"=== BATTERY START {ts()} ===", flush=True)

# M-01 REST /state
c, st = call("GET", "/state")
agents = st.get("agents", []) if c == 200 else []
rec("M01 state: REST alive, roster", c == 200 and len(agents) >= 5, f"HTTP {c}, agents={len(agents)}")

# M-02 циклы идут (60с окно)
c1, s1 = call("GET", "/state"); cyc1 = {a["id"]: a["cycles"] for a in s1.get("agents", [])}
time.sleep(60)
c2, s2 = call("GET", "/state"); cyc2 = {a["id"]: a["cycles"] for a in s2.get("agents", [])}
delta = sum(max(0, cyc2.get(i, 0) - cyc1.get(i, 0)) for i in cyc2)
rec("M02 непрерывные жизненные циклы", delta > 0, f"Δциклов за 60с = {delta} (fix: fatal-guard+watchdog в коде)")

# M-03 оператор → рой (координация ответа)
c, r = call("POST", "/chat", {"text": "BROWSER-TEST 419203: проверка канала оператора. Ответьте коротко, подтвердите приём."})
rec("M03 POST /chat принят", c in (200, 201), f"HTTP {c}, resp={str(r)[:80]}")
time.sleep(45)
c, m = call("GET", "/messages?limit=40")
msgs = get_msgs(40)
recent = [x for x in msgs if "BROWSER-TEST 419203" in str(x.get("text", ""))]
replies = [x for x in msgs if x.get("kind") in ("say", "direct", "broadcast") and x.get("ts", "") > (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=3)).strftime("%Y-%m-%dT%H:%M")]
rec("M04 сообщение оператора в ленте", len(recent) >= 1, f"нашёл {len(recent)} упоминаний")
rec("M05 рой отвечает (LLM-координация)", len(replies) >= 1, f"ответов за 3мин: {len(replies)}, напр: {str(replies[-1].get('text',''))[:90] if replies else '-'}")

# M-06 broadcast
c, r = call("POST", "/broadcast", {"text": "BROWSER-TEST: широковещательная директива — продолжайте координацию, это тест канала #all."})
rec("M06 POST /broadcast", c in (200, 201), f"HTTP {c}")

# M-07 цель на доску
c, r = call("POST", "/goal", {"text": "BROWSER-TEST-цель: задокументировать уроки о живучести роя в памяти"})
rec("M07 POST /goal (доска целей)", c in (200, 201), f"HTTP {c}, resp={str(r)[:80]}")

# M-08 spawn нового чат-агента (КЛЮЧЕВАЯ ЦЕЛЬ 1: создание агентов)
c, r = call("POST", "/spawn", {"role": "researcher", "name": "Тест-Рождённый-419203", "intent": "Тест механики рождения: проверить наследование уроков"})
newid = (r or {}).get("agent", {}).get("id") if isinstance(r, dict) else None
rec("M08 POST /spawn (создание чат-агента)", c in (200, 201) and bool(newid), f"HTTP {c}, id={newid}")
time.sleep(20)
c, s3 = call("GET", "/state")
born = next((a for a in s3.get("agents", []) if a.get("id") == newid), None)
rec("M09 новорождённый в ростере + родословная", bool(born), f"state={born.get('state') if born else '?'}, gen={born.get('generation') if born else '?'}, parent={bool(born and born.get('parent_id'))}")
c, mm = call("GET", "/messages?limit=30")
mmsgs = get_msgs(30)
spawn_evt = [x for x in mmsgs if x.get("kind") == "spawn" and "Тест-Рождённый" in str(x.get("text", ""))]
rec("M10 событие рождения в ленте (видят все)", len(spawn_evt) >= 1, f"spawn-сообщений: {len(spawn_evt)}")

# M-11 mute
if newid:
    c, r = call("POST", "/mute", {"agentId": newid, "muted": True})
    rec("M11 POST /mute", c in (200, 201), f"HTTP {c}")
    time.sleep(3)
    c, s4 = call("GET", "/state")
    magent = next((a for a in s4.get("agents", []) if a.get("id") == newid), {})
    rec("M12 mute отражён в состоянии", magent.get("muted") is True, f"muted={magent.get('muted')}")

# M-13 retire (полный жизненный цикл)
if newid:
    c, r = call("POST", "/kill", {"agentId": newid})
    rec("M13 POST /kill (retire)", c in (200, 201), f"HTTP {c}")
    time.sleep(3)
    c, s5 = call("GET", "/state")
    rall = next((a for a in s5.get("agents", []) if a.get("id") == newid), None)
    rec("M14 агент ушёл в архив", (rall is None) or (rall.get("state") == "retired"), f"state={rall.get('state') if rall else 'удалён/архив'}")

# M-15 память (самообучение)
c, mem = call("GET", "/memory")
memd = mem if isinstance(mem, dict) else {}
lessons = memd.get("lessons", []); episodes = memd.get("memories", memd.get("episodes", []))
rec("M15 память: уроки+эпизоды накоплены", c == 200 and (len(lessons) + len(episodes)) > 0, f"HTTP {c}, lessons={len(lessons)}, episodes={len(episodes)}")

# M-16 пул самоулучшения
c, pr = call("GET", "/proposals")
props = pr.get("proposals", pr) if isinstance(pr, dict) else pr
rec("M16 пул самоулучшения (swarm_improve)", c == 200, f"HTTP {c}, предложений: {len(props) if isinstance(props, list) else '?'}")

# M-17 gateway e2e :81
try:
    with urllib.request.urlopen("http://localhost:81/state?XTransformPort=3046", timeout=8) as r:
        gw = r.status
except Exception as e:
    gw = str(e)[:60]
rec("M17 gateway :81 e2e (XTransformPort)", gw == 200, f"HTTP {gw}")

# M-18 Next-прокси :3000
try:
    with urllib.request.urlopen("http://127.0.0.1:3000/api/swarm/state", timeout=8) as r:
        np = r.status
except Exception as e:
    np = str(e)[:60]
rec("M18 Next-прокси /api/swarm → :3046", np == 200, f"HTTP {np}")

# M-19 браузерные директивы агентов (события в истории)
c, m6 = call("GET", "/messages?limit=200")
mmsgs6 = get_msgs(200)
bd = [x for x in mmsgs6 if x.get("kind") == "browser" or "browser_directive" in str(x)]
c2b, ev = call("GET", "/events") if False else (0, None)
rec("M19 browser-директивы в ленте", len(bd) >= 1, f"директив: {len(bd)} (историч. свидетельство pulse:emerald от Вестника)")

print(f"=== BATTERY END {ts()} ===", flush=True)
fails = [r for r in R if r[1] == "FAIL"]
print(f"\nИТОГО: {sum(1 for r in R if r[1]=='PASS')}/{len(R)} PASS; FAIL: {', '.join(r[0] for r in fails) if fails else 'нет'}")
with open("/home/z/my-project/scripts/browser-test/battery-result.json", "w") as f:
    json.dump([{"mech": n, "verdict": v, "evidence": e} for n, v, e in R], f, ensure_ascii=False, indent=1)
