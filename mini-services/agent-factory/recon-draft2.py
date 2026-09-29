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
    # REAL keystrokes this time
    await ta.click()
    await page.keyboard.type("DRAFT_RESTORE_MARKER_5150", delay=30)
    await page.wait_for_timeout(2500)
    v = await ta.input_value()
    ls = await page.evaluate("() => localStorage.getItem('chat-input-')?.slice(0, 90)")
    print("A) after real typing: composer=", repr(v[:40]), "| ls=", ls)

    # NEW TAB in same context: does the draft appear?
    page2 = await ctx.new_page()
    await page2.goto("https://chat.z.ai/", wait_until="domcontentloaded", timeout=45000)
    await page2.wait_for_timeout(6000)
    ta2 = page2.locator("textarea#chat-input")
    v2 = await ta2.input_value() if await ta2.count() else None
    print("B) new tab composer:", repr((v2 or "")[:40]))
    await page2.close()

    # reload original: restore?
    await page.reload(wait_until="domcontentloaded")
    await page.wait_for_timeout(7000)
    ta = page.locator("textarea#chat-input")
    v3 = await ta.input_value() if await ta.count() else None
    print("C) after reload composer:", repr((v3 or "")[:40]))

    # big draft (48k) + triple-click replace test
    big = ("X" * 200 + "\n") * 240  # ~48k
    await ta.click()
    await page.keyboard.insert_text(big)
    await page.wait_for_timeout(2000)
    len_before = len(await ta.input_value())
    # triple-click = 3 rapid clicks
    await ta.click(click_count=3)
    await page.wait_for_timeout(300)
    await page.keyboard.insert_text("REPLACED_SHORT")
    await page.wait_for_timeout(1200)
    v_after = await ta.input_value()
    print(f"D) big draft {len_before} chars; after triple-click+insert: len={len(v_after)} starts={repr(v_after[:30])}")
    await pw.stop()

asyncio.run(main())
