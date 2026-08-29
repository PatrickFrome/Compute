#!/usr/bin/env python3
import asyncio
import json
import os
import re
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError

URL = "https://duck.ai/"
EXPECTED = "METAENGINE_DUCK_RESULT=5017"
PROMPT = "Compute 173 multiplied by 29. Reply with exactly METAENGINE_DUCK_RESULT=<number> and nothing else."

async def click_first(page, patterns):
    for pattern in patterns:
        try:
            loc = page.get_by_role("button", name=re.compile(pattern, re.I)).first
            if await loc.count() and await loc.is_visible():
                await loc.click(timeout=3000)
                await page.wait_for_timeout(800)
                return pattern
        except Exception:
            pass
    return None

async def main():
    async with async_playwright() as p:
        executable = None
        for candidate in ("/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"):
            if os.path.exists(candidate):
                executable = candidate
                break
        browser = await p.chromium.launch(
            executable_path=executable,
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        context = await browser.new_context(
            viewport={"width": 1440, "height": 1000},
            locale="en-US",
        )
        page = await context.new_page()
        console_errors = []
        page.on("console", lambda msg: console_errors.append(msg.text[:500]) if msg.type == "error" else None)

        try:
            response = await page.goto(URL, wait_until="domcontentloaded", timeout=45000)
            await page.wait_for_timeout(5000)
            initial_status = response.status if response else None

            consent = await click_first(page, [
                r"get started", r"continue", r"accept", r"agree", r"let.?s go", r"start chatting"
            ])
            await page.wait_for_timeout(1500)

            buttons = []
            for el in await page.locator("button").all():
                try:
                    text = (await el.inner_text()).strip()
                    if text:
                        buttons.append(text[:120])
                except Exception:
                    pass
            buttons = buttons[:40]

            editors = page.locator("textarea:visible")
            if await editors.count() == 0:
                editors = page.locator('[contenteditable="true"]:visible')
            if await editors.count() == 0:
                body = (await page.locator("body").inner_text())[:5000]
                print("DUCKAI_UI_DIAGNOSTIC", json.dumps({
                    "http_status": initial_status,
                    "url": page.url,
                    "consent_clicked": consent,
                    "buttons": buttons,
                    "body_preview": body,
                    "console_errors": console_errors[:10],
                }, ensure_ascii=False))
                raise SystemExit("duckai_composer_not_found")

            editor = editors.first
            try:
                await editor.fill(PROMPT)
            except Exception:
                await editor.click()
                await editor.press("Control+A")
                await editor.type(PROMPT)
            await editor.press("Enter")

            success = False
            body = ""
            for _ in range(45):
                await page.wait_for_timeout(1000)
                body = await page.locator("body").inner_text()
                if EXPECTED in body:
                    success = True
                    break

            result = {
                "schema": "metaengine.duckai-browser-live-probe.v1",
                "http_status": initial_status,
                "final_url": page.url,
                "consent_clicked": consent,
                "composer_found": True,
                "expected_reply_seen": success,
                "expected_reply": EXPECTED if success else None,
                "buttons": buttons,
                "console_error_count": len(console_errors),
                "body_tail": body[-2500:] if body else None,
            }
            print("DUCKAI_BROWSER_PROBE", json.dumps(result, ensure_ascii=False))
            if not success:
                raise SystemExit("duckai_live_reply_not_observed")
        finally:
            await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
