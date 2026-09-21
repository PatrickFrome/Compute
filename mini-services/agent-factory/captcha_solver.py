"""
Aliyun slider-captcha solver — human-like fine-grained drag with live feedback.
Connects over CDP to the agent-browser chrome instance (session preserved).

Notch detection:
  - fetch bg image as blob (avoids canvas taint) via page JS
  - luminance column profile; strong edge PAIRS 30..60px apart -> notch bounds
  - cross-check with white-blob detection (hole renders light)
Drag:
  - pointer down at knob center
  - micro-steps with easeInOutQuad, y jitter
  - initial distance guess from observed mapping ratio (~0.75 piece-px per slider-px)
  - live correction: read piece strip center via DOM, residual -> adjust
  - settle, release
"""
from __future__ import annotations

import json
import math
import random
import time
from typing import Any, Optional

from playwright.sync_api import Page, sync_playwright

CDP_PORT_FILE = "/tmp/agent-browser-chrome-7dbac59e-d5c2-4e5c-a8e4-121a10827cc2/DevToolsActivePort"
IMG_PER_SLIDER = 0.75

MEASURE_JS = r"""
async () => {
  const knobEl = document.querySelector('.slider-move');
  const bg = document.querySelector('img.puzzle');
  const pieceImg = Array.from(document.querySelectorAll('img')).find(i => {
    const r = i.getBoundingClientRect();
    return r.width > 40 && r.width < 60 && r.height > 100;
  });
  if (!knobEl || !bg || !pieceImg) return null;
  const kr = knobEl.getBoundingClientRect();
  const br = bg.getBoundingClientRect();
  const pr = pieceImg.getBoundingClientRect();
  let notchCenter = -1, method = 'none';
  try {
    const rr = await fetch(bg.src, { credentials: 'omit' });
    const bl = await rr.blob();
    const url = URL.createObjectURL(bl);
    const im = new Image();
    await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = url; });
    const c = document.createElement('canvas'); c.width = 300; c.height = 200;
    const g = c.getContext('2d'); if (!g) return null;
    g.drawImage(im, 0, 0, 300, 200);
    const d = g.getImageData(0, 0, 300, 200).data;
    const lum = (x, y) => { const i = (y*300+x)*4; return 0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]; };
    // white blob columns
    const brightCols = [];
    for (let x = 100; x < 292; x++) {
      let n = 0;
      for (let y = 20; y < 196; y++) {
        const i = (y*300+x)*4;
        const L = 0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
        if (L > 205) n++;
      }
      if (n > 14) brightCols.push({x, n});
    }
    // edge energy columns
    const colScore = [];
    for (let x = 96; x < 292; x++) {
      let s = 0;
      for (let y = 24; y < 196; y++) s += Math.abs(lum(x+1, y) - lum(x, y));
      colScore.push({x, s});
    }
    const top = [...colScore].sort((a,b)=>b.s-a.s).slice(0, 14);
    let bestPair = null;
    for (let i = 0; i < top.length; i++) {
      for (let j = i+1; j < top.length; j++) {
        const gap = Math.abs(top[i].x - top[j].x);
        if (gap >= 30 && gap <= 60) {
          const score = top[i].s + top[j].s;
          if (!bestPair || score > bestPair.score)
            bestPair = {a: Math.min(top[i].x, top[j].x), b: Math.max(top[i].x, top[j].x), score};
        }
      }
    }
    if (brightCols.length > 8) {
      const bx0 = brightCols[0].x, bx1 = brightCols[brightCols.length-1].x;
      if (bx1-bx0 >= 26 && bx1-bx0 <= 66) { notchCenter = (bx0+bx1)/2; method = 'white'; }
    }
    if (notchCenter < 0 && bestPair) { notchCenter = (bestPair.a+bestPair.b)/2; method = 'edge'; }
    URL.revokeObjectURL(url);
  } catch (e) { return {err: String(e).slice(0,100)}; }
  if (notchCenter < 0) return null;
  const scale = br.width / 300;
  return {
    knobX: kr.x + kr.width/2, knobY: kr.y + kr.height/2,
    stripX0: pr.x, pieceCenter0: pr.x + 26,
    targetScreenX: br.x + notchCenter * scale, method
  };
}
"""

PIECE_X_JS = r"""
() => {
  const pz = Array.from(document.querySelectorAll('img')).find(i => {
    const r = i.getBoundingClientRect();
    return r.width > 40 && r.width < 60 && r.height > 100;
  });
  if (!pz) return null;
  return pz.getBoundingClientRect().x + 26;
}
"""


def cdp_endpoint() -> str:
    with open(CDP_PORT_FILE) as f:
        port = f.read().strip().split("\n")[0]
    return f"http://127.0.0.1:{port}"


def measure(page: Page) -> Optional[dict[str, Any]]:
    return page.evaluate(MEASURE_JS)


def read_piece_x(page: Page) -> Optional[float]:
    return page.evaluate(PIECE_X_JS)


def is_solved(page: Page) -> bool:
    return page.evaluate("() => !document.querySelector('.window-show')")


def attempt_once(page: Page, attempt: int) -> dict[str, Any]:
    geo = measure(page)
    if not geo:
        return {"ok": False, "note": f"no geo {json.dumps(geo) if geo else ''}"}
    knob_x, knob_y = geo["knobX"], geo["knobY"]
    page.mouse.move(knob_x, knob_y, steps=6)
    time.sleep(0.2 + random.random() * 0.22)
    page.mouse.down()
    time.sleep(0.09 + random.random() * 0.13)

    piece_center0 = geo["pieceCenter0"]
    dist_total = (geo["targetScreenX"] - piece_center0) / IMG_PER_SLIDER
    steps = max(20, min(46, round(abs(dist_total) / 6)))
    cur_x = knob_x
    last_piece_x = piece_center0
    reads = 0
    for i in range(1, steps + 1):
        t = i / steps
        eased = 2 * t * t if t < 0.5 else 1 - ((-2 * t + 2) ** 2) / 2
        target_x = knob_x + dist_total * eased
        dx = target_x - cur_x
        n_sub = max(1, min(4, round(abs(dx) / 4)))
        for _ in range(n_sub):
            cur_x += dx / n_sub
            jy = (random.random() - 0.5) * 2.4
            page.mouse.move(cur_x, knob_y + jy, steps=1)
            time.sleep(0.008 + random.random() * 0.014)
        if i % 8 == 0:
            px = read_piece_x(page)
            if px is not None:
                last_piece_x = px
                reads += 1

    # live correction
    for _ in range(8):
        px = read_piece_x(page)
        if px is not None:
            last_piece_x = px
        residual = geo["targetScreenX"] - last_piece_x
        if abs(residual) <= 1.8:
            break
        sdx = max(-16.0, min(16.0, residual / IMG_PER_SLIDER))
        if abs(sdx) < 0.8:
            break
        cur_x += sdx
        page.mouse.move(cur_x, knob_y + (random.random() - 0.5) * 1.2, steps=2)
        time.sleep(0.05 + random.random() * 0.09)

    time.sleep(0.11 + random.random() * 0.17)
    page.mouse.up()
    time.sleep(1.3)
    ok = is_solved(page)
    return {
        "ok": ok,
        "note": (
            f"solved reads={reads} last={round(last_piece_x)} target={round(geo['targetScreenX'])} m={geo.get('method')}"
            if ok
            else f"rejected last={round(last_piece_x)} target={round(geo['targetScreenX'])} m={geo.get('method')}"
        ),
    }


def solve_slider_captcha(page: Page, max_attempts: int = 5) -> dict[str, Any]:
    notes = []
    for attempt in range(1, max_attempts + 1):
        try:
            r = attempt_once(page, attempt)
        except Exception as e:  # noqa: BLE001
            r = {"ok": False, "note": f"exc {str(e)[:120]}"}
        notes.append(f"#{attempt}: {r['note']}")
        if r["ok"]:
            return {"ok": True, "attempts": attempt, "note": " | ".join(notes)}
        time.sleep(1.6 + random.random() * 0.9)
    return {"ok": False, "attempts": max_attempts, "note": " | ".join(notes)}


def connect(page_url_substring: str = "chat.z.ai"):
    """Return (playwright, browser, page) — caller must pw.stop()."""
    pw = sync_playwright().start()
    browser = pw.chromium.connect_over_cdp(cdp_endpoint())
    ctx = browser.contexts[0] if browser.contexts else browser.new_context()
    page = next((p for p in ctx.pages if page_url_substring in p.url), None)
    if page is None:
        page = ctx.new_page()
    return pw, browser, page


FACTORY_USER_DATA_DIR = "/home/z/my-project/mini-services/agent-factory/browser-data"


def launch_factory_browser(headless: bool = True):
    """Launch the factory's OWN chromium with a persistent profile.

    Returns (playwright, context, page). Caller must pw.stop().
    The profile persists the z.ai guest session (cookies + localStorage),
    so agent chats survive service restarts.
    """
    pw = sync_playwright().start()
    ctx = pw.chromium.launch_persistent_context(
        FACTORY_USER_DATA_DIR,
        headless=headless,
        viewport={"width": 1360, "height": 800},
        user_agent=(
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36"
        ),
        args=[
            "--no-sandbox",
            "--disable-blink-features=AutomationControlled",
            "--disable-dev-shm-usage",
        ],
    )
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    # patch webdriver flag for stealth
    ctx.add_init_script(
        "Object.defineProperty(navigator,'webdriver',{get:()=>undefined});"
    )
    return pw, ctx, page
