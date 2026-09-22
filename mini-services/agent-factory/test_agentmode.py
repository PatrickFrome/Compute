import json
import random
import sys
import time

sys.path.insert(0, "/home/z/my-project/mini-services/agent-factory")
from playwright.sync_api import sync_playwright

USER_DATA = "/home/z/my-project/mini-services/agent-factory/browser-data-hf"

pw = sync_playwright().start()
ctx = pw.chromium.launch_persistent_context(
    USER_DATA, headless=True, channel="chromium",
    viewport={"width": 1440, "height": 860},
    user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
    locale="en-US", timezone_id="Europe/Moscow",
    args=["--no-sandbox", "--disable-blink-features=AutomationControlled", "--window-size=1440,860"],
)
page = ctx.pages[0] if ctx.pages else ctx.new_page()
page.add_init_script("Object.defineProperty(navigator,'webdriver',{get:()=>undefined});")

# force agent mode before app boots
ctx.add_init_script("""
  try {
    localStorage.setItem('last_mode', 'agent');
    localStorage.setItem('last_selected_agent_model', JSON.stringify(['glm-5.3-flash']));
  } catch (e) {}
""")

# capture completions requests
captured = []
def on_request(req):
    if "chat/completions" in req.url:
        captured.append({
            "url": req.url[:220],
            "method": req.method,
            "headers": {k: v[:60] for k, v in req.headers.items() if k.lower() in ("x-signature", "x-fe-version", "authorization", "content-type")},
            "body": req.post_data,
        })
page.on("request", on_request)

page.goto("https://chat.z.ai/", wait_until="domcontentloaded")
page.wait_for_timeout(3500)

mode = page.evaluate("() => ({mode: localStorage.getItem('last_mode'), body: document.body.innerText.slice(0,150).replace(/\\n/g,'|')})")
print("STATE:", json.dumps(mode, ensure_ascii=False)[:300])

# human warmup
x, y = random.randint(300, 700), random.randint(250, 500)
for _ in range(18):
    x = max(40, min(1400, x + random.randint(-130, 130)))
    y = max(90, min(820, y + random.randint(-100, 100)))
    page.mouse.move(x, y, steps=random.randint(6, 13))
    time.sleep(random.uniform(0.05, 0.2))

ta = page.locator("textarea").first
ta.click()
msg = "Create a single-file hello world html page. Reply done when finished."
for ch in msg:
    ta.type(ch, delay=random.randint(30, 110))
time.sleep(random.uniform(0.6, 1.2))

# look for agent-mode UI hints in composer
hints = page.evaluate("""() => {
  const t = document.body.innerText;
  return {
    hasAgentWord: /agent/i.test(t),
    deepThink: t.includes('Deep Think'),
    composerClasses: Array.from(document.querySelectorAll('[class*=mode], [class*=Mode], [class*=scene], [class*=Scene]')).map(e=>e.className.toString().slice(0,60)).slice(0,10)
  };
}""")
print("HINTS:", json.dumps(hints, ensure_ascii=False)[:400])

page.locator('div[aria-label="Send Message"] button').first.click()
time.sleep(3)
captcha = page.evaluate("() => !!document.querySelector('.window-show')")
print("captcha:", captcha)
time.sleep(9)
print("URL:", page.url)
print("PAGE:", page.evaluate("() => document.body.innerText.slice(0,300)").replace("\n", " | ")[:280])
print("CAPTURED:", len(captured))
for c in captured[:2]:
    print("=== REQ", c["method"], c["url"][:120])
    print("HDR:", json.dumps(c["headers"])[:220])
    if c["body"]:
        print("BODY:", c["body"][:1400])
page.screenshot(path="/home/z/my-project/download/factory-08-agentmode.png")
pw.stop()
