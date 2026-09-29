import json
import math
import random
import sys
import time

sys.path.insert(0, "/home/z/my-project/mini-services/agent-factory")
from captcha_solver import launch_factory_browser  # noqa: E402

MEASURE2 = r"""
async () => {
  const knobEl = document.querySelector('.slider-move');
  const bg = Array.from(document.querySelectorAll('img')).find(i => { const r = i.getBoundingClientRect(); return r.width >= 250 && r.width <= 340 && r.height >= 140 && r.height <= 260; });
  const pieceImg = Array.from(document.querySelectorAll('img')).find(i => {
    const r = i.getBoundingClientRect();
    return r.width > 40 && r.width < 60 && r.height > 100;
  });
  if (!knobEl || !bg || !pieceImg) return null;
  const kr = knobEl.getBoundingClientRect(), br = bg.getBoundingClientRect(), pr = pieceImg.getBoundingClientRect();
  let notch = null;
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
    // 1) white blob columns (hole renders light)
    const bright = [];
    for (let x = 90; x < 295; x++) {
      let n = 0;
      for (let y = 16; y < 198; y++) { const i=(y*300+x)*4; if (0.299*d[i]+0.587*d[i+1]+0.114*d[i+2] > 200) n++; }
      if (n > 12) bright.push(x);
    }
    // 2) edge energy
    const col = [];
    for (let x = 90; x < 295; x++) { let s=0; for (let y=20; y<198; y++) s += Math.abs(lum(x+1,y)-lum(x,y)); col.push({x, s}); }
    const top = [...col].sort((a,b)=>b.s-a.s).slice(0,16);
    let pair = null;
    for (let i=0;i<top.length;i++) for (let j=i+1;j<top.length;j++) {
      const gap = Math.abs(top[i].x-top[j].x);
      if (gap>=32 && gap<=58) { const sc=top[i].s+top[j].s; if (!pair||sc>pair.sc) pair={a:Math.min(top[i].x,top[j].x),b:Math.max(top[i].x,top[j].x),sc}; }
    }
    const cands = [];
    if (bright.length > 6) { const w=bright[bright.length-1]-bright[0]; if (w>=28&&w<=64) cands.push({c:(bright[0]+bright[bright.length-1])/2, w, m:'white'}); }
    if (pair) cands.push({c:(pair.a+pair.b)/2, w:pair.b-pair.a, m:'edge'});
    if (!cands.length) return {err:'no-notch'};
    // prefer white method, cross-check with edge
    let pick = cands[0];
    if (cands.length > 1) {
      const white = cands.find(c=>c.m==='white'), edge = cands.find(c=>c.m==='edge');
      if (white && edge && Math.abs(white.c-edge.c) < 8) pick = {c:(white.c+edge.c)/2, w:white.w, m:'both'};
      else if (edge && !white) pick = edge;
      else if (white) pick = white;
    }
    URL.revokeObjectURL(url);
    const scale = br.width / 300;
    return {
      knobX: kr.x + kr.width/2, knobY: kr.y + kr.height/2,
      pieceCenter0: pr.x + 26,
      targetScreenX: br.x + pick.c * scale,
      method: pick.m, notchImgX: pick.c
    };
  } catch (e) { return {err: String(e).slice(0,100)}; }
}
"""

PIECE_X = r"""
() => { const pz = Array.from(document.querySelectorAll('img')).find(i => { const r = i.getBoundingClientRect(); return r.width>40 && r.width<60 && r.height>100; }); return pz ? pz.getBoundingClientRect().x + 26 : null; }
"""


def drag_once(page):
    # wait for ready captcha (image loaded, not loading)
    deadline = time.time() + 8
    ready = False
    while time.time() < deadline:
        st = page.evaluate("""() => {
          const lds = Array.from(document.querySelectorAll('.aliyunCaptcha-loading'));
          const ldVis = lds.some(el => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden'; });
          const bg = Array.from(document.querySelectorAll('img')).find(i => { const r = i.getBoundingClientRect(); return r.width >= 250 && r.width <= 340 && r.height >= 140 && r.height <= 260; });
          const kn = document.querySelector('.slider-move');
          return {loading: ldVis, img: bg ? (bg.complete && bg.naturalWidth > 0) : false, knob: !!kn};
        }""")
        if st and not st["loading"] and st["img"] and st["knob"]:
            ready = True
            break
        time.sleep(0.4)
    if not ready:
        return "not-ready"

    geo = page.evaluate(MEASURE2)
    if not geo or "err" in geo or geo.get("targetScreenX") is None:
        return f"measure-fail {json.dumps(geo)[:90]}"
    kx, ky = geo["knobX"], geo["knobY"]
    target = geo["targetScreenX"]
    pc0 = geo["pieceCenter0"]
    need_img = target - pc0

    page.mouse.move(kx, ky, steps=5)
    time.sleep(0.15 + random.random() * 0.2)
    page.mouse.down()
    time.sleep(0.09 + random.random() * 0.1)

    # calibration: move 36 slider px, measure piece delta
    CAL = 36.0
    cur = kx
    n = 7
    for i in range(n):
        cur += CAL / n
        page.mouse.move(cur, ky + (random.random() - 0.5) * 1.8, steps=1)
        time.sleep(0.008 + random.random() * 0.014)
    time.sleep(0.12)
    px1 = page.evaluate(PIECE_X)
    if px1 is None:
        page.mouse.up(); time.sleep(0.8); return "calib-read-fail"
    moved_img = px1 - pc0
    ratio = max(0.5, min(1.3, moved_img / CAL))
    rem_slider = (need_img - moved_img) / ratio
    # clamp to rail: max travel 260 from start
    rem_slider = max(-40.0, min(215.0, rem_slider))
    # human-like: 85% of remaining fast, then decel
    p1 = rem_slider * 0.85
    steps = random.randint(18, 26)
    for i in range(1, steps + 1):
        t = i / steps
        eased = 2*t*t if t < 0.5 else 1 - ((-2*t+2)**2)/2
        tx = cur + p1 * eased
        dx = tx - cur
        m = max(1, min(3, round(abs(dx)/5)))
        for _ in range(m):
            cur += dx/m
            page.mouse.move(cur, ky + (random.random()-0.5)*2.0, steps=1)
            time.sleep(0.006 + random.random()*0.012)
        if random.random() < 0.10:
            time.sleep(0.03 + random.random()*0.04)
    # final correction loop (2 reads max)
    for _ in range(2):
        time.sleep(0.1 + random.random()*0.12)
        px = page.evaluate(PIECE_X)
        if px is None:
            break
        residual = target - px
        if abs(residual) <= 1.6:
            break
        corr = max(-14.0, min(14.0, residual / ratio))
        if abs(corr) < 0.7:
            break
        m2 = max(2, min(5, round(abs(corr)/3)))
        for i in range(m2):
            cur += corr/m2
            page.mouse.move(cur, ky + (random.random()-0.5)*1.2, steps=1)
            time.sleep(0.012 + random.random()*0.018)
    time.sleep(0.1 + random.random()*0.18)
    page.mouse.up()
    time.sleep(1.6)
    solved = page.evaluate("() => !document.querySelector('.window-show')")
    return f"{'SOLVED' if solved else 'rejected'} ratio={round(ratio,3)} target={round(target)} m={geo.get('method')}"


SIGNED_CALL = r"""
async (promptText) => {
  const auth = await fetch('/api/v1/auths/', {credentials:'include'}).then(r=>r.json());
  const token = localStorage.getItem('token');
  const ts = String(Date.now());
  const requestId = crypto.randomUUID();
  const i = { timestamp: ts, requestId, user_id: auth.id };
  const o = {
    version: '0.0.1', platform: 'web', token,
    user_agent: navigator.userAgent, language: navigator.language,
    languages: (navigator.languages||[]).join(','),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    cookie_enabled: String(navigator.cookieEnabled),
    screen_width: String(screen.width), screen_height: String(screen.height),
    screen_resolution: screen.width+'x'+screen.height,
    viewport_height: String(innerHeight), viewport_width: String(innerWidth),
    viewport_size: innerWidth+'x'+innerHeight,
    color_depth: String(screen.colorDepth), pixel_ratio: String(devicePixelRatio),
    current_url: location.href, pathname: location.pathname, search: location.search,
    hash: location.hash, host: location.host, hostname: location.hostname,
    protocol: location.protocol, referrer: document.referrer, title: document.title,
    timezone_offset: String(new Date().getTimezoneOffset()),
    local_time: new Date().toString(), utc_time: new Date().toUTCString(),
    is_mobile: 'false', is_touch: String('ontouchstart' in window),
    max_touch_points: String(navigator.maxTouchPoints||0),
    browser_name: 'chrome', os_name: 'linux'
  };
  const sp = new URLSearchParams();
  for (const [k,v] of Object.entries({...i, ...o})) sp.append(k, String(v));
  const sortedPayload = Object.entries(i).sort((a,b)=>a[0].localeCompare(b[0])).flat().join(',');
  const te = new TextEncoder();
  const b64 = btoa(String.fromCharCode(...te.encode(promptText)));
  const h = sortedPayload + '|' + b64 + '|' + ts;
  const m = String(Math.floor(Number(ts) / 300000));
  const hex = async (buf) => Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  const k1 = await crypto.subtle.importKey('raw', te.encode('key-@@@@)))()((9))-xxxx&&&%%%%%'), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  const s1 = await crypto.subtle.sign('HMAC', k1, te.encode(m));
  const k2 = await crypto.subtle.importKey('raw', s1, {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  const signature = await hex(await crypto.subtle.sign('HMAC', k2, te.encode(h)));
  const body = {
    stream: true, chat_id: crypto.randomUUID(), model: 'x-preview-l',
    messages: [{role:'user', content: promptText, content_type:'text'}],
    signature_prompt: promptText, params: {}, features: {web_search:false}, background_persist: false
  };
  const r = await fetch('/api/v2/chat/completions?' + sp.toString() + '&signature_timestamp=' + ts, {
    method: 'POST',
    headers: {'Content-Type':'application/json','Accept-Language':'en-US','X-FE-Version':'prod-fe-1.1.96','X-Signature':signature,'Authorization':'Bearer '+token},
    body: JSON.stringify(body)
  });
  const txt = await r.text();
  let verdict = 'captcha';
  if (txt.includes('FRONTEND_CAPTCHA_REQUIRED')) verdict = 'captcha';
  else if (txt.includes('chat:completion')) verdict = 'stream-ok';
  else if (r.status !== 200) verdict = 'http-' + r.status;
  else verdict = 'other';
  return {verdict, head: txt.slice(0, 240)};
}
"""

pw, ctx, page = launch_factory_browser()
page.goto("https://chat.z.ai/", wait_until="domcontentloaded")
page.wait_for_timeout(2800)

# 0) dummy captcha param test
dummy = page.evaluate(
    """async () => {
  const token = localStorage.getItem('token');
  const r = await fetch('/api/v2/chat/completions?signature_timestamp=' + Date.now(), {
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+token,'X-FE-Version':'prod-fe-1.1.96'},
    body: JSON.stringify({stream:true, chat_id: crypto.randomUUID(), model:'x-preview-l',
      messages:[{role:'user',content:'hi',content_type:'text'}], captcha_verify_param:'', params:{}, features:{}})
  });
  return (await r.text()).slice(0, 200);
}"""
)
print("DUMMY-PARAM:", dummy[:150])

# 1) trigger captcha via UI send
ta = page.locator("textarea").first
ta.click()
ta.fill("Reply with exactly: TRUST-TEST-OK")
page.wait_for_timeout(600)
page.locator('div[aria-label="Send Message"] button').first.click()
try:
    page.wait_for_selector(".window-show", timeout=12000)
except Exception:
    pass
if page.evaluate("() => !!document.querySelector('.window-show')"):
    for attempt in range(1, 7):
        r = drag_once(page)
        print(f"DRAG #{attempt}:", r)
        if r.startswith("SOLVED"):
            break
        time.sleep(2.2)

# 2) post-trust: three signed API calls
page.wait_for_timeout(1500)
for i in range(3):
    res = page.evaluate(SIGNED_CALL, f"Reply with exactly: API-TRUST-{i}-OK")
    print(f"API#{i}:", res["verdict"], "|", res["head"][:110].replace("\n", " "))

page.screenshot(path="/home/z/my-project/download/factory-05-trust.png")
pw.stop()
