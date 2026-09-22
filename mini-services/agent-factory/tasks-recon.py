"""Recon: list z.ai tasks (agent-mode tasks) via page-context fetch, count them."""
import json
import sys

sys.path.insert(0, "/home/z/my-project/mini-services/agent-factory")
from captcha_solver import launch_factory_browser  # noqa: E402

pw, ctx, page = launch_factory_browser()
page.goto("https://chat.z.ai/", wait_until="domcontentloaded")
page.wait_for_timeout(4000)

JS = r"""
async () => {
  const tryFetch = async (url) => {
    try {
      const r = await fetch(url, { credentials: "include" });
      const j = await r.json().catch(() => null);
      return { status: r.status, body: j };
    } catch (e) {
      return { status: -1, err: String(e) };
    }
  };
  const out = {};
  // probe several plausible endpoints
  out["/api/tasks"] = await tryFetch("/api/tasks");
  if (out["/api/tasks"] && out["/api/tasks"].status !== 200) {
    out["/api/tasks?p=1"] = await tryFetch("/api/tasks?page=1");
  }
  // also try with a limit param
  out["/api/tasks?limit=5"] = await tryFetch("/api/tasks?limit=5");
  return out;
}
"""

res = page.evaluate(JS)
for k, v in res.items():
    body = v.get("body")
    status = v.get("status")
    if isinstance(body, dict):
        keys = list(body.keys())[:10]
        data = body.get("data")
        if isinstance(data, list):
            print(f"{k}: status={status} keys={keys} data_len={len(data)}")
            if data:
                print("  sample[0]:", json.dumps(data[0], ensure_ascii=False)[:600])
        elif isinstance(data, dict):
            items = data.get("items") or data.get("tasks") or data.get("list")
            print(f"{k}: status={status} keys={keys} data_keys={list(data.keys())[:12]}")
            if isinstance(items, list):
                print(f"  items_len={len(items)}")
                if items:
                    print("  sample[0]:", json.dumps(items[0], ensure_ascii=False)[:600])
        else:
            s = json.dumps(body, ensure_ascii=False)
            print(f"{k}: status={status} body={s[:600]}")
    else:
        print(f"{k}: status={status} body={json.dumps(body, ensure_ascii=False)[:600] if body is not None else None}")

page.screenshot(path="/home/z/my-project/download/tasks-recon-01.png")
pw.stop()
