#!/usr/bin/env python3
"""R419718-1615: RESEARCHER consumption check (read-only, 1 команда, paced).
Job 419718 @16:15 tick — продолжение с 1530. Проверка: потребил ли RESEARCHER
агент (tab_bc085d57) pending TOOL_REQUEST_V1 (request_id=adac6557-systel-01).
Дисциплина: READ_TRANSCRIPT = READ_ONLY 0pts, без повторного пинга, без мутаций."""
import sys, json, time, importlib.util

spec = importlib.util.spec_from_file_location(
    "bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-r419718-1615-researcher.json"
bmt.load_results()
bmt.ISSUER = "zai-419718-1615"
run_test = bmt.run_test

TAB = "tab_bc085d57-4e9d-4395-9e63-90afd921bdfa"
OUT = "/home/z/my-project/scripts/phoenix/browser-test-results-r419718-1615-researcher.json"

# пауза перед первой командой (budget-дисциплина, от последней мутации роя > 60с)
time.sleep(20)
r = run_test("RS-1615-1", "READ_TRANSCRIPT", payload={"tab_id": TAB, "limit": 14},
             platform="GLM_ZAI", mutating=False, timeout=55)
full = (r.get("_result_full") or {}) if isinstance(r, dict) else {}
text = str(full.get("text") or "")
summary = {
    "id": "RS-1615-1", "action": "READ_TRANSCRIPT", "tab_id": TAB,
    "status": r.get("status"), "error": r.get("error"), "ms": r.get("ms"),
    "url": full.get("url"), "text_len": len(text),
    "head": text[:300], "tail": text[-700:],
    "markers": {
        "tool_request_pending": "TOOL_REQUEST_V1" in text,
        "adac6557": "adac6557" in text,
        "consumption_ack": ("consumed" in text.lower() or "принято" in text.lower()),
        "fresh_digest": "fresh digest" in text.lower(),
    },
    "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
}
save(summary) if False else None
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(summary, f, ensure_ascii=False, indent=2)
print(json.dumps(summary, ensure_ascii=False)[:900])
