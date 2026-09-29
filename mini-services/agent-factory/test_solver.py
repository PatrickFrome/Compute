import json
import sys

sys.path.insert(0, "/home/z/my-project/mini-services/agent-factory")
from captcha_solver import connect, is_solved, solve_slider_captcha  # noqa: E402

pw, browser, page = connect("chat.z.ai")
print("connected, url:", page.url[:70])
page.goto("https://chat.z.ai/", wait_until="domcontentloaded")
page.wait_for_timeout(2600)

ta = page.locator("textarea").first
ta.fill("Reply with exactly: PING-OK")
page.wait_for_timeout(500)
page.locator('button[aria-label*="Send" i]').first.click()
page.wait_for_timeout(1700)

print("captcha visible:", not is_solved(page))
if not is_solved(page):
    res = solve_slider_captcha(page)
    print("solver:", json.dumps(res))

page.wait_for_timeout(3000)
print("PAGE:", page.evaluate("() => document.body.innerText.slice(0, 420)").replace("\n", " | "))
print("URL:", page.url)
pw.stop()
