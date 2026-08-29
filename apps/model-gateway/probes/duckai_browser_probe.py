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

async def get_editor(page):
    editors=page.locator("textarea:visible")
    if await editors.count()==0:
        editors=page.locator('[contenteditable="true"]:visible')
    return editors.first if await editors.count() else None

async def fill_prompt(editor):
    try:
        await editor.fill(PROMPT)
    except Exception:
        await editor.click()
        await editor.press("Control+A")
        await editor.type(PROMPT)

async def try_select_claude(page):
    buttons=await visible_buttons(page)
    model_button=next((t for t in buttons if re.search(r"luna|gpt|haiku|claude|mistral|gemma|gpt.?oss",t,re.I)),None)
    if model_button:
        try:
            loc=page.get_by_role("button",name=model_button,exact=True).first
            if await loc.count() and await loc.is_visible():
                await loc.click(timeout=3000)
                await page.wait_for_timeout(800)
        except Exception:
            pass
    picker_text=await page.locator("body").inner_text()
    for pattern in [r"Claude.*4\.5.*Haiku",r"Claude.*Haiku",r"Haiku.*4\.5",r"Claude"]:
        try:
            candidate=page.get_by_text(re.compile(pattern,re.I)).last
            if await candidate.count() and await candidate.is_visible():
                await candidate.click(timeout=3000)
                await page.wait_for_timeout(1000)
                return {"selected":"claude","pattern":pattern,"picker_preview":picker_text[-2200:]}
        except Exception:
            pass
    await page.keyboard.press("Escape")
    return {"selected":None,"pattern":None,"picker_preview":picker_text[-2200:]}

async def main():
    async with async_playwright() as p:
        executable=next((x for x in ("/usr/bin/google-chrome","/usr/bin/google-chrome-stable","/usr/bin/chromium","/usr/bin/chromium-browser") if os.path.exists(x)),None)
        browser=await p.chromium.launch(executable_path=executable,headless=True,args=["--no-sandbox","--disable-dev-shm-usage"])
        context=await browser.new_context(viewport={"width":1440,"height":1000},locale="en-US")
        page=await context.new_page()
        console_errors=[]
        network=[]
        page.on("console",lambda msg: console_errors.append(msg.text[:500]) if msg.type=="error" else None)
        page.on("response",lambda resp: network.append({"method":resp.request.method,"status":resp.status,"url":resp.url[:300]}) if resp.request.method=="POST" or re.search(r"chat|ai",resp.url,re.I) else None)
        page.on("requestfailed",lambda req: network.append({"method":req.method,"status":"FAILED","url":req.url[:300]}))

        try:
            response=await page.goto(URL,wait_until="domcontentloaded",timeout=45000)
            await page.wait_for_timeout(5000)
            initial_status=response.status if response else None
            model_selection=await try_select_claude(page)

            editor=await get_editor(page)
            if editor is None:
                raise SystemExit("duckai_composer_not_found")
            await fill_prompt(editor)

            # Depending on the current Duck.ai UI, agreement is either a Continue
            # button or is accepted by the first Ask click itself.
            consent_clicked=await click_button(page,r"^Continue$")
            if consent_clicked:
                editor=await get_editor(page)
                if editor is None:
                    raise SystemExit("duckai_composer_missing_after_consent")
                await fill_prompt(editor)

            sent=await click_button(page,r"^Ask$")
            if not sent:
                await editor.press("Enter")
                sent=True

            # First chat currently opens a one-time onboarding card after Ask.
            # Dismiss it, then retry only if no assistant response is observable.
            await page.wait_for_timeout(1800)
            onboarding_clicked=await click_button(page,r"^Got It!$")
            retried=False
            if onboarding_clicked:
                await page.wait_for_timeout(1000)
                body=await page.locator("body").inner_text()
                if EXPECTED not in body:
                    editor=await get_editor(page)
                    if editor is not None:
                        await fill_prompt(editor)
                        retried=await click_button(page,r"^Ask$")
                        if not retried:
                            await editor.press("Enter")
                            retried=True

            success=False
            body=""
            for _ in range(55):
                await page.wait_for_timeout(1000)
                body=await page.locator("body").inner_text()
                if EXPECTED in body:
                    success=True
                    break

            result={
                "schema":"metaengine.duckai-browser-live-probe.v3",
                "http_status":initial_status,
                "final_url":page.url,
                "model_selection":model_selection,
                "consent_clicked":consent_clicked,
                "onboarding_clicked":onboarding_clicked,
                "send_clicked":sent,
                "retried_after_onboarding":retried,
                "expected_reply_seen":success,
                "expected_reply":EXPECTED if success else None,
                "buttons":await visible_buttons(page),
                "console_errors":console_errors[-8:],
                "network_tail":network[-20:],
                "body_tail":body[-3500:] if body else None,
            }
            print("DUCKAI_BROWSER_PROBE",json.dumps(result,ensure_ascii=False))
            if not success:
                raise SystemExit("duckai_live_reply_not_observed")
        finally:
            await browser.close()

if __name__=="__main__":
    asyncio.run(main())
