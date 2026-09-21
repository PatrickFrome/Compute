import json
import sys

sys.path.insert(0, "/home/z/my-project/mini-services/agent-factory")
from captcha_solver import launch_factory_browser  # noqa: E402

# In-page test of signed completions v2 — geometry-free agent creation path.
JS = r"""
async (promptText) => {
  // ---- replicate ane() ----
  const auth = await fetch('/api/v1/auths/', {credentials:'include'}).then(r=>r.json());
  const token = localStorage.getItem('token');
  const ts = String(Date.now());
  const requestId = crypto.randomUUID();
  const i = { timestamp: ts, requestId, user_id: auth.id };
  const o = {
    version: '0.0.1', platform: 'web', token: token,
    user_agent: navigator.userAgent, language: navigator.language,
    languages: (navigator.languages||[]).join(','),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    cookie_enabled: String(navigator.cookieEnabled),
    screen_width: String(window.screen.width),
    screen_height: String(window.screen.height),
    screen_resolution: window.screen.width + 'x' + window.screen.height,
    viewport_height: String(window.innerHeight),
    viewport_width: String(window.innerWidth),
    viewport_size: window.innerWidth + 'x' + window.innerHeight,
    color_depth: String(window.screen.colorDepth),
    pixel_ratio: String(window.devicePixelRatio),
    current_url: window.location.href, pathname: window.location.pathname,
    search: window.location.search, hash: window.location.hash,
    host: window.location.host, hostname: window.location.hostname,
    protocol: window.location.protocol, referrer: document.referrer,
    title: document.title,
    timezone_offset: String(new Date().getTimezoneOffset()),
    local_time: new Date().toString(), utc_time: new Date().toUTCString(),
    is_mobile: String(false), is_touch: String('ontouchstart' in window),
    max_touch_points: String(navigator.maxTouchPoints||0),
    browser_name: 'chrome', os_name: 'linux'
  };
  const sp = new URLSearchParams();
  for (const [k,v] of Object.entries({...i, ...o})) sp.append(k, String(v));
  const urlParams = sp.toString();
  const sortedPayload = Object.entries(i).sort((a,b)=>a[0].localeCompare(b[0])).flat().join(',');

  // ---- replicate sne() with WebCrypto ----
  const te = new TextEncoder();
  const b64 = btoa(String.fromCharCode(...te.encode(promptText)));
  const h = sortedPayload + '|' + b64 + '|' + ts;
  const m = String(Math.floor(Number(ts) / (5*60*1000)));
  const hex = async (buf) => Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  const STATIC_KEY = 'key-@@@@)))()((9))-xxxx&&&%%%%%';
  const k1raw = await crypto.subtle.importKey('raw', te.encode(STATIC_KEY), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  const sig1 = await crypto.subtle.sign('HMAC', k1raw, te.encode(m));
  const k2raw = await crypto.subtle.importKey('raw', sig1, {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  const sig2 = await crypto.subtle.sign('HMAC', k2raw, te.encode(h));
  const signature = await hex(sig2);

  // ---- completions v2 ----
  const chatId = crypto.randomUUID();
  const body = {
    stream: true, chat_id: chatId, model: 'x-preview-l',
    messages: [{role:'user', content: promptText, content_type:'text'}],
    signature_prompt: promptText,
    params: {}, features: {web_search:false}, background_persist: false
  };
  const url = '/api/v2/chat/completions?' + urlParams + '&signature_timestamp=' + ts;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'Accept-Language': 'en-US',
      'X-FE-Version': 'prod-fe-1.1.96',
      'X-Signature': signature,
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify(body)
  });
  const txt = await r.text();
  return {status: r.status, sig: signature.slice(0,16), chatId, body: txt.slice(0, 800)};
}
"""

pw, ctx, page = launch_factory_browser()
page.goto("https://chat.z.ai/", wait_until="domcontentloaded")
page.wait_for_timeout(2500)
res = page.evaluate(JS, "Reply with exactly: SIGNED-API-OK")
print(json.dumps(res, indent=1, ensure_ascii=False)[:1500])
pw.stop()
