"""Recon 3: open z.ai, inspect sidebar task list UI, find count & DOM structure."""
import json
import sys

sys.path.insert(0, "/home/z/my-project/mini-services/agent-factory")
from captcha_solver import launch_factory_browser  # noqa: E402

pw, ctx, page = launch_factory_browser()
page.goto("https://chat.z.ai/", wait_until="domcontentloaded")
page.wait_for_timeout(5000)

# capture network: find task-list API calls by clicking around
# First dump sidebar-ish text
body = page.evaluate("() => document.body.innerText.slice(0, 2500)")
print("BODY:", body.replace("\n", " | ")[:2000])

# look for sidebar items with counts
JS = r"""
() => {
  const links = [...document.querySelectorAll("a")].map(a => ({href: a.getAttribute("href"), text: (a.innerText||"").trim().slice(0,80)})).filter(x => x.text);
  return links.slice(0, 60);
}
"""
links = page.evaluate(JS)
for l in links:
    print("LINK:", l["href"], "::", l["text"])

page.screenshot(path="/home/z/my-project/download/tasks-recon-03.png")
pw.stop()
