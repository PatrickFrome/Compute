import asyncio
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
    # refill draft
    await ta.click()
    await page.keyboard.insert_text(("Y" * 200 + "\n") * 100)
    await page.wait_for_timeout(1500)
    print("draft len:", len(await ta.input_value()))
    # quadruple click
    await ta.click(click_count=4)
    await page.wait_for_timeout(300)
    sel = await page.evaluate("() => { const t = document.querySelector('textarea#chat-input'); return { s: t.selectionStart, e: t.selectionEnd, len: t.value.length }; }")
    print("after quad-click selection:", sel)
    await page.keyboard.insert_text("Z")
    await page.wait_for_timeout(800)
    print("after insert len:", len(await ta.input_value()), "starts:", repr((await ta.input_value())[:10]))
    await pw.stop()

asyncio.run(main())
