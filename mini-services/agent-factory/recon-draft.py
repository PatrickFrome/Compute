import asyncio, json
from playwright.async_api import async_playwright

USER_DATA = "/home/z/my-project/mini-services/agent-factory/browser-data"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36"

async def main():
    pw = await async_playwright().start()
    ctx = await pw.chromium.launch_persistent_context(
        USER_DATA, headless=True, viewport={"width": 1360, "height": 800}, user_agent=UA,
        args=["--no-sandbox", "--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage"])
    page = ctx.pages[0] if ctx.pages else await ctx.new_page()
    await page.goto("https://chat.z.ai/", wait_until="domcontentloaded", timeout=45000)
    await page.wait_for_timeout(5000)
    url = page.url
    print("url:", url)

    ta = page.locator("textarea#chat-input")
    cnt = await ta.count()
    print("textarea#chat-input count:", cnt)
    if cnt:
        await ta.fill("TESTDRAFT_MARKER_9137")
        await page.wait_for_timeout(1200)
        # scan storage for the marker
        res = await page.evaluate("""() => {
          const hits = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            const v = String(localStorage.getItem(k) ?? '');
            if (v.includes('TESTDRAFT_MARKER_9137')) hits.push(['local', k, v.slice(0, 120)]);
          }
          for (let i = 0; i < sessionStorage.length; i++) {
            const k = sessionStorage.key(i);
            const v = String(sessionStorage.getItem(k) ?? '');
            if (v.includes('TESTDRAFT_MARKER_9137')) hits.push(['session', k, v.slice(0, 120)]);
          }
          return { hits, lsKeys: Object.keys(localStorage), tag: document.querySelector('textarea#chat-input')?.tagName ?? null,
                   value: document.querySelector('textarea#chat-input')?.value?.slice(0, 60) ?? null };
        }""")
        print("storage hits:", json.dumps(res["hits"], ensure_ascii=False))
        print("localStorage keys:", res["lsKeys"])
        print("composer value:", res["value"])
        # reload → does the draft survive?
        await page.reload(wait_until="domcontentloaded")
        await page.wait_for_timeout(5000)
        v2 = await page.evaluate("() => document.querySelector('textarea#chat-input')?.value?.slice(0, 60) ?? null")
        print("after reload composer value:", v2)
    await pw.stop()

asyncio.run(main())
