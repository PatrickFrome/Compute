import json
import sys

sys.path.insert(0, "/home/z/my-project/mini-services/agent-factory")
from captcha_solver import (  # noqa: E402
    launch_factory_browser,
    solve_slider_captcha,
)

pw, ctx, page = launch_factory_browser()
page.goto("https://chat.z.ai/", wait_until="domcontentloaded")
page.wait_for_timeout(3000)

ta = page.locator("textarea").first
ta.click()
ta.fill("Reply with exactly: PING-OK")
page.wait_for_timeout(700)
page.locator('div[aria-label="Send Message"] button').first.click()

# wait for captcha dialog (may appear with delay)
try:
    page.wait_for_selector(".window-show", timeout=12000)
    print("captcha appeared")
except Exception:
    print("captcha did not appear (maybe not required)")

if page.evaluate("() => !!document.querySelector('.window-show')"):
    res = solve_slider_captcha(page)
    print("solver:", json.dumps(res))

# wait for assistant response
page.wait_for_timeout(9000)
print("URL:", page.url)
body = page.evaluate("() => document.body.innerText.slice(0, 700)")
print("PAGE:", body.replace("\n", " | "))
page.screenshot(path="/home/z/my-project/download/factory-04-full.png")
pw.stop()
