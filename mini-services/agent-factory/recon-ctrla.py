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
    await page.wait_for_timeout(6000)
    ta = page.locator("textarea#chat-input")

    # current draft length
    v0 = await ta.input_value()
    print("draft len:", len(v0))

    # T1: TYPED_CLICK-style click -> Ctrl+A via raw CDP key events (rail-exact) -> read
    await ta.click()
    await page.keyboard.press("ControlOrMeta+a")
    await page.wait_for_timeout(300)
    sel = await page.evaluate("""() => {
      const ta = document.querySelector('textarea#chat-input');
      return { tag: ta?.tagName, selStart: ta?.selectionStart, selEnd: ta?.selectionEnd, len: ta?.value?.length };
    }""")
    print("T1 after Ctrl+A (click focus):", json.dumps(sel))
    await page.keyboard.press("Delete")
    await page.wait_for_timeout(600)
    v1 = await ta.input_value()
    print("T1 after Delete: len=", len(v1), repr(v1[:30]))
    await pw.stop()

asyncio.run(main())
