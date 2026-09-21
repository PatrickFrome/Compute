"""Recon 5: open Chat History panel, count items, find API URL behind it."""
import json
import sys

sys.path.insert(0, "/home/z/my-project/mini-services/agent-factory")
from captcha_solver import launch_factory_browser  # noqa: E402

pw, ctx, page = launch_factory_browser()
page.goto("https://chat.z.ai/", wait_until="domcontentloaded")
page.wait_for_timeout(5000)

# capture API calls
calls = []
page.on("request", lambda r: calls.append(r.url) if ("/api/" in r.url and "task" not in r.method) else None)

hist = page.locator('div[aria-label="Chat History"]').first
hist.click()
page.wait_for_timeout(4000)
print("URL after history click:", page.url)

body = page.evaluate("() => document.body.innerText.slice(0, 3000)")
print("BODY:", body.replace("\n", " | ")[:2500])

JS = r"""
() => [...document.querySelectorAll("a[href*='/c/'], a[href*='task'], [role=listitem]")]
  .map(a => ({tag: a.tagName, href: a.getAttribute("href"), text: (a.innerText||"").trim().slice(0,80)}))
  .filter(x => x.text)
  .slice(0, 100);
"""
items = page.evaluate(JS)
print("ITEMS:", len(items))
for i in items[:60]:
    print("ITEM:", i["href"] or "", "::", i["text"])

page.screenshot(path="/home/z/my-project/download/tasks-recon-05.png")
print("API CALLS SEEN:", json.dumps(sorted(set(u.split("?")[0] for u in calls)), indent=0)[:1500])
pw.stop()
