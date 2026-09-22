"""Recon 2: probe chat-list & task-list endpoints, count items."""
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
  for (const u of [
    "/api/v1/chats?limit=100",
    "/api/v1/chats/?limit=100",
    "/api/v1/chats",
    "/api/chats",
    "/api/v1/chats?offset=0&limit=100",
  ]) {
    out[u] = await tryFetch(u);
  }
  // dedupe: keep only interesting ones
  const seen = new Set();
  const res = {};
  for (const [u, v] of Object.entries(out)) {
    if (v.status === 404 || v.status === 405) continue;
    res[u] = v;
  }
  return res;
}
"""

res = page.evaluate(JS)
for k, v in res.items():
    body = v.get("body")
    if isinstance(body, dict):
        data = body.get("data")
        if isinstance(data, list):
            print(f"{k}: status={v['status']} data_len={len(data)}")
            if data:
                print("  sample[0]:", json.dumps(data[0], ensure_ascii=False)[:500])
        elif isinstance(data, dict):
            print(f"{k}: status={v['status']} data_keys={list(data.keys())[:12]}")
            for kk, vv in data.items():
                if isinstance(vv, list):
                    print(f"  data.{kk}: len={len(vv)}")
                    if vv:
                        print("    sample[0]:", json.dumps(vv[0], ensure_ascii=False)[:500])
        else:
            print(f"{k}: status={v['status']} body={json.dumps(body, ensure_ascii=False)[:400]}")
    else:
        print(f"{k}: status={v['status']} body={json.dumps(body, ensure_ascii=False)[:400] if body is not None else None}")

# Also read UI: open sidebar task panel and count
page.screenshot(path="/home/z/my-project/download/tasks-recon-02.png")
pw.stop()
