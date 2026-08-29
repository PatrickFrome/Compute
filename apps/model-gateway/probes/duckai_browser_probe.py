#!/usr/bin/env python3
import asyncio
import json
import os
import re
from playwright.async_api import async_playwright

URL = "https://duck.ai/"
EXPECTED = "METAENGINE_DUCK_RESULT=5017"
PROMPT = "Compute 173 multiplied by 29. Reply with exactly METAENGINE_DUCK_RESULT=<number> and nothing else."

async def click_button(page, pattern, timeout=3000):
    try:
        loc = page.get_by_role("button", name=re.compile(pattern, re.I)).first
        if await loc.count() and await loc.is_visible():
            await loc.click(timeout=timeout)
            await page.wait_for_timeout(700)
            return True
    except Exception:
        pass
    return False

async def visible_buttons(page, limit=80):
    out=[]
    for el in await page.locator("button:visible").all():
        try:
            text=(await el.inner_text()).strip()
            if text:
                out.append(text[:160])
        except Exception:
            pass
    return out[:limit]

async def try_select_claude(page):
    # Current Duck.ai UI exposes the active model as a button (for example "5.6 Luna").
    buttons = await visible_buttons(page)
    model_button = None
    for text in buttons:
        if re.search(r"luna|gpt|haiku|claude|mistral|gemma|gpt.?oss", text, re.I):
            model_button = text
            break
    if model_button:
        try:
            loc = page.get_by_role("button", name=model_button, exact=True).first
            if await loc.count() and await loc.is_visible():
                await loc.click(timeout=3000)
                await page.wait_for_timeout(800)
        except Exception:
            pass

    picker_text = ""
    try:
        picker_text = await page.locator("body").inner_text()
    except Exception:
        pass

    # Prefer the free Anthropic peer. Fall back to current default if the picker changes.
    for pattern in [r"Claude.*4\.5.*Haiku", r"Claude.*Haiku", r"Haiku.*4\.5", r"Claude"]:
        try:
            candidate = page.get_by_text(re.compile(pattern, re.I)).last
            if await candidate.count() and await candidate.is_visible():
                await candidate.click(timeout=3000)
                await page.wait_for_timeout(1000)
                return {"selected": "claude", "pattern": pattern, "picker_preview": picker_text[-2200:]}
        except Exception:
            pass
    # Close a model popover if one is still open.
    try:
        await page.keyboard.press("Escape")
    except Exception:
        pass
    return {"selected": None, "pattern": None, "picker_preview": picker_text[-2200:]}

async def main():
    async with async_playwright() as p:
        executable = next((x for x in (
            "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium", "/usr/bin/chromium-browser"
        ) if os.path.exists(x)), None)
        browser = await p.chromium.launch(
            executable_path=executable,
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        context = await browser.new_context(viewport={"width":1440,"height":1000}, locale="en-US")
        page = await context.new_page()
        console_errors=[]
        page.on("console", lambda msg: console_errors.append(msg.text[:500]) if msg.type == "error" else None)

        try:
            response = await page.goto(URL, wait_until="domcontentloaded", timeout=45000)
            await page.wait_for_timeout(5000)
            initial_status = response.status if response else None

            model_selection = await try_select_claude(page)

            editors = page.locator("textarea:visible")
            if await editors.count() == 0:
                editors = page.locator('[contenteditable="true"]:visible')
            if await editors.count() == 0:
                print("DUCKAI_UI_DIAGNOSTIC", json.dumps({
                    "http_status": initial_status,
                    "url": page.url,
                    "buttons": await visible_buttons(page),
                    "body_preview": (await page.locator("body").inner_text())[:5000],
                    "model_selection": model_selection,
                    "console_errors": console_errors[:10],
                }, ensure_ascii=False))
                raise SystemExit("duckai_composer_not_found")

            editor=editors.first
            try:
                await editor.fill(PROMPT)
            except Exception:
                await editor.click()
                await editor.press("Control+A")
                await editor.type(PROMPT)

            # Duck.ai's first-use agreement may appear only after the first prompt is entered.
            consent_clicked = await click_button(page, r"^Continue$")
            if consent_clicked:
                await page.wait_for_timeout(900)
                # Re-acquire the editor because consent handling can re-render the composer.
                editors = page.locator("textarea:visible")
                if await editors.count() == 0:
                    editors = page.locator('[contenteditable="true"]:visible')
                if await editors.count():
                    editor = editors.first
                    current = ""
                    try:
                        current = await editor.input_value()
                    except Exception:
                        try:
                            current = await editor.inner_text()
                        except Exception:
                            pass
                    if PROMPT not in current:
                        try:
                            await editor.fill(PROMPT)
                        except Exception:
                            await editor.click()
                            await editor.type(PROMPT)

            sent = await click_button(page, r"^Ask$")
            if not sent:
                await editor.press("Enter")

            success=False
            body=""
            for _ in range(55):
                await page.wait_for_timeout(1000)
                body=await page.locator("body").inner_text()
                if EXPECTED in body:
                    success=True
                    break

            result={
                "schema":"metaengine.duckai-browser-live-probe.v2",
                "http_status":initial_status,
                "final_url":page.url,
                "model_selection":model_selection,
                "consent_clicked":consent_clicked,
                "send_clicked":sent,
                "composer_found":True,
                "expected_reply_seen":success,
                "expected_reply":EXPECTED if success else None,
                "buttons":await visible_buttons(page),
                "console_error_count":len(console_errors),
                "body_tail":body[-3000:] if body else None,
            }
            print("DUCKAI_BROWSER_PROBE", json.dumps(result, ensure_ascii=False))
            if not success:
                raise SystemExit("duckai_live_reply_not_observed")
        finally:
            await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
