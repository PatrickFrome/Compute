"""Recon 4: open sidebar, list chats/tasks UI, find API calls behind it."""
import json
import sys

sys.path.insert(0, "/home/z/my-project/mini-services/agent-factory")
from captcha_solver import launch_factory_browser  # noqa: E402

pw, ctx, page = launch_factory_browser()
page.goto("https://chat.z.ai/", wait_until="domcontentloaded")
page.wait_for_timeout(5000)

# dump buttons with aria-labels
JS = r"""
() => [...document.querySelectorAll("button, [role=button], [aria-label]")]
  .map(b => ({tag: b.tagName, aria: b.getAttribute("aria-label"), text: (b.innerText||"").trim().slice(0,40)}))
  .filter(x => x.aria || x.text)
  .slice(0, 40);
"""
btns = page.evaluate(JS)
for b in btns:
    print("BTN:", b["tag"], "| aria:", b["aria"], "| text:", b["text"])

# try clicking sidebar toggle
for sel in ['button[aria-label*="idebar" i]', 'button[aria-label*="enu" i]', '[class*="sidebar"] button', 'button[aria-label*="ollapse" i]']:
    loc = page.locator(sel).first
    if loc.count() > 0:
        try:
            loc.click(timeout=2000)
            print("CLICKED:", sel)
            break
        except Exception as e:
            print("click fail:", sel, str(e)[:80])
page.wait_for_timeout(2500)

# dump nav links after sidebar open
JS2 = r"""
() => [...document.querySelectorAll("a, [role=menuitem], [role=listitem]")]
  .map(a => ({tag: a.tagName, href: a.getAttribute("href"), text: (a.innerText||"").trim().slice(0,60)}))
  .filter(x => x.text && x.text.length > 0)
  .slice(0, 80);
"""
items = page.evaluate(JS2)
for i in items:
    print("ITEM:", i["tag"], i["href"] or "", "::", i["text"])

page.screenshot(path="/home/z/my-project/download/tasks-recon-04.png")
pw.stop()
