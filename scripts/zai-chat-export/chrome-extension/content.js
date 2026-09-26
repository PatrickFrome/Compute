/* ============================================================================
 * Z.ai Chat Export — content script (MV3)
 * Ядро экспорта + плавающая кнопка + приём команд от popup / background.
 * Работает и без chrome.* API (fallback на <a download>) — поэтому тестируется
 * на обычной странице (см. ../test/mock.html).
 * ============================================================================ */
(function () {
  'use strict';
  if (window.__ZAI_CHAT_EXPORT_CS__) return;
  window.__ZAI_CHAT_EXPORT_CS__ = true;

  const CONFIG = {
    MAX_SCROLL_STEPS: 300,
    SCROLL_SETTLE_MS: 450,
    NO_GROWTH_STOP: 10,
    MESSAGE_SELECTORS: [
      '[data-message-id]',
      '[data-testid*="message" i]',
      '[class*="message" i]',
      '[class*="chat-item" i]',
      '[class*="bubble" i]',
      'article'
    ],
    USER_HINT: /(user|human|self|mine|from-me)/i,
    ASSISTANT_HINT: /(assistant|bot|\bai\b|model|gpt|markdown|prose|answer|reply)/i
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  function stableId(el, text) {
    return el.getAttribute('data-message-id')
      || el.getAttribute('data-id')
      || hash((el.className || '') + '|' + text.slice(0, 160));
  }

  function collectMessageNodes() {
    const found = new Set();
    for (const sel of CONFIG.MESSAGE_SELECTORS) {
      let nodes;
      try { nodes = Array.from(document.querySelectorAll(sel)); } catch { continue; }
      for (const n of nodes) found.add(n);
    }
    const list = Array.from(found).filter((n) => !(n.nodeType === 1 && Array.from(found).some((m) => m !== n && n.contains(m))));
    return list.filter((n) => n.getClientRects().length > 0 || n.offsetHeight > 0);
  }

  function detectRole(el) {
    const probe = [el, el.parentElement, el.closest('[data-role], [data-message-role]')];
    for (const p of probe) {
      if (!p) continue;
      const attr = p.getAttribute && (p.getAttribute('data-message-role') || p.getAttribute('data-role'));
      if (attr) {
        if (CONFIG.USER_HINT.test(attr)) return 'user';
        if (CONFIG.ASSISTANT_HINT.test(attr)) return 'assistant';
      }
      const cls = (p.className && typeof p.className === 'string') ? p.className : '';
      if (cls) {
        if (CONFIG.USER_HINT.test(cls) && !CONFIG.ASSISTANT_HINT.test(cls)) return 'user';
        if (CONFIG.ASSISTANT_HINT.test(cls) && !CONFIG.USER_HINT.test(cls)) return 'assistant';
      }
    }
    try {
      const cs = getComputedStyle(el);
      const ps = el.parentElement ? getComputedStyle(el.parentElement) : null;
      if (cs.alignSelf === 'flex-end' || (ps && ps.justifyContent === 'flex-end')) return 'user';
      if (cs.alignSelf === 'flex-start' || (ps && ps.justifyContent === 'flex-start')) return 'assistant';
    } catch { /* noop */ }
    return 'unknown';
  }

  function normalize(text) {
    return (text || '').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
  }

  function extractContent(el) {
    const codeBlocks = [];
    el.querySelectorAll('pre').forEach((pre) => {
      const langMatch = (pre.className || '').match(/(?:language|lang)-([\w-]+)/i)
        || (pre.querySelector('[class*="language-"]') || { className: '' }).className.match(/language-([\w-]+)/i);
      codeBlocks.push({ lang: langMatch ? langMatch[1] : '', code: pre.innerText.replace(/\n+$/, '') });
    });
    if (codeBlocks.length === 0) return { text: normalize(el.innerText), codeBlocks };
    const parts = [];
    const seen = new Set();
    const walk = (node) => {
      Array.from(node.childNodes).forEach((child) => {
        if (child.nodeType !== 1) return;
        if (child.tagName === 'PRE') {
          if (!seen.has(child)) {
            seen.add(child);
            const lang = (child.className || '').match(/(?:language|lang)-([\w-]+)/i);
            parts.push('```' + (lang ? lang[1] : '') + '\n' + child.innerText.replace(/\n+$/, '') + '\n```');
          }
          return;
        }
        if (child.querySelector && child.querySelector('pre')) { walk(child); return; }
        const t = normalize(child.innerText || '');
        if (t) parts.push(t);
      });
    };
    walk(el);
    return { text: parts.join('\n\n') || normalize(el.innerText), codeBlocks };
  }

  function extractTime(el) {
    const t = el.querySelector && el.querySelector('time[datetime], [class*="timestamp" i]');
    if (t) return t.getAttribute('datetime') || normalize(t.innerText);
    return '';
  }

  function findScrollContainer(sampleNode) {
    const cands = [];
    document.querySelectorAll('*').forEach((el) => {
      if (el.scrollHeight - el.clientHeight > 200) {
        const st = getComputedStyle(el);
        if (/(auto|scroll)/.test(st.overflowY)) cands.push(el);
      }
    });
    if (sampleNode) {
      const withSample = cands.filter((c) => c.contains(sampleNode));
      if (withSample.length) {
        withSample.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
        return withSample[0];
      }
    }
    cands.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
    return cands[0] || document.scrollingElement;
  }

  function absorb(nodes, acc) {
    for (const el of nodes) {
      const { text, codeBlocks } = extractContent(el);
      if (!text && codeBlocks.length === 0) continue;
      const id = stableId(el, text);
      if (acc.has(id)) continue;
      acc.set(id, { role: detectRole(el), time: extractTime(el), text, codeBlocks });
    }
  }

  async function loadFullHistory(acc, autoScroll) {
    if (!autoScroll) {
      absorb(collectMessageNodes(), acc);
      return 'skipped';
    }
    const before = collectMessageNodes();
    const sample = before[before.length - 1] || null;
    const container = findScrollContainer(sample);
    const restoreY = container.scrollTop;
    let noGrowth = 0;
    for (let step = 0; step < CONFIG.MAX_SCROLL_STEPS && noGrowth < CONFIG.NO_GROWTH_STOP; step++) {
      container.scrollTop = 0;
      container.dispatchEvent(new Event('scroll', { bubbles: true }));
      await sleep(CONFIG.SCROLL_SETTLE_MS);
      const total = acc.size;
      absorb(collectMessageNodes(), acc);
      if (acc.size === total) noGrowth++; else noGrowth = 0;
    }
    container.scrollTop = restoreY;
    return (container === document.scrollingElement ? 'document' : (container.className || container.tagName)).toString().slice(0, 80);
  }

  function chatIdFromUrl() {
    const m = location.href.match(/chat(?:\/|\/c\/|%2F)([\w-]{6,})/i) || location.search.match(/chat[_-]?id=([\w-]+)/i);
    return m ? m[1] : (document.body.getAttribute('data-chat-id') || '');
  }

  function toMarkdown(meta, messages) {
    const lines = [
      '# Z.ai chat export', '',
      '- URL: ' + meta.url,
      '- Chat ID: ' + (meta.chatId || 'n/a'),
      '- Title: ' + meta.title,
      '- Exported: ' + meta.exportedAt,
      '- Messages: ' + messages.length, '', '---', ''
    ];
    messages.forEach((m, i) => {
      const who = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'Unknown';
      lines.push('## ' + (i + 1) + '. ' + who + (m.time ? '  (' + m.time + ')' : ''));
      lines.push('');
      lines.push(m.text || '');
      m.codeBlocks.forEach((c) => { if (!m.text.includes(c.code)) { lines.push('', '```' + c.lang + '\n' + c.code + '\n```'); } });
      lines.push('');
    });
    return lines.join('\n');
  }

  function toTxt(meta, messages) {
    const lines = ['Z.ai chat export', 'URL: ' + meta.url, 'Exported: ' + meta.exportedAt, 'Messages: ' + messages.length, ''.padEnd(40, '='), ''];
    messages.forEach((m, i) => {
      lines.push('[' + (i + 1) + '] ' + m.role.toUpperCase() + (m.time ? ' ' + m.time : ''));
      lines.push(m.text || '');
      lines.push('');
    });
    return lines.join('\n');
  }

  function buildPayload(format, meta, messages) {
    if (format === 'json') return { payload: JSON.stringify({ meta, messages }, null, 2), ext: 'json', mime: 'application/json' };
    if (format === 'txt') return { payload: toTxt(meta, messages), ext: 'txt', mime: 'text/plain' };
    return { payload: toMarkdown(meta, messages), ext: 'md', mime: 'text/markdown' };
  }

  function anchorDownload(filename, payload, mime) {
    const blob = new Blob([payload], { type: mime + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  async function downloadFile(filename, payload, mime) {
    // Основной путь: chrome.downloads через service worker; fallback: <a download>.
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        const resp = await chrome.runtime.sendMessage({ type: 'zai-download', filename, payload, mime });
        if (resp && resp.ok) return 'downloads-api';
      } catch { /* extension context invalidated и т.п. — fallback */ }
    }
    anchorDownload(filename, payload, mime);
    return 'anchor';
  }

  async function exportChat(format, autoScroll) {
    format = format || 'md';
    autoScroll = autoScroll !== false;
    const acc = new Map();
    const scrolledVia = await loadFullHistory(acc, autoScroll);
    const messages = Array.from(acc.values());
    const meta = {
      url: location.href,
      chatId: chatIdFromUrl(),
      title: document.title,
      exportedAt: new Date().toISOString(),
      scrollContainer: scrolledVia
    };
    const { payload, ext, mime } = buildPayload(format, meta, messages);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2');
    const safeId = (meta.chatId || '').replace(/[^\w-]/g, '').slice(0, 12);
    const filename = 'zai-chat-' + (safeId ? safeId + '-' : '') + stamp + '.' + ext;
    const via = await downloadFile(filename, payload, mime);
    const summary = {
      ok: true,
      filename,
      messageCount: messages.length,
      user: messages.filter((m) => m.role === 'user').length,
      assistant: messages.filter((m) => m.role === 'assistant').length,
      unknown: messages.filter((m) => m.role === 'unknown').length,
      chars: payload.length,
      via
    };
    window.__ZAI_CHAT_EXPORT = { ...summary, meta, messages, payload };
    console.log('[zai-export]', summary);
    return summary;
  }

  window.__zaiExportChat = exportChat;

  /* ---------------- канал от popup / background (hotkey) ----------------- */
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === 'ZAI_EXPORT') {
        exportChat(msg.format, msg.autoScroll).then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e) }));
        return true; // асинхронный ответ
      }
      return undefined;
    });
  }

  /* --------------------------- кнопка на странице ------------------------ */
  function mountButton() {
    if (document.getElementById('zai-export-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'zai-export-btn';
    btn.textContent = 'Export chat';
    btn.title = 'Z.ai Chat Export: клик = Markdown, Shift = JSON, Alt = TXT';
    Object.assign(btn.style, {
      position: 'fixed', right: '18px', bottom: '18px', zIndex: '2147483647',
      padding: '10px 16px', borderRadius: '10px', border: '1px solid rgba(255,255,255,.15)',
      background: '#111827', color: '#fff', font: '600 13px/1 system-ui, sans-serif',
      cursor: 'pointer', boxShadow: '0 6px 20px rgba(0,0,0,.25)', opacity: '0.85'
    });
    btn.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
    btn.addEventListener('mouseleave', () => { btn.style.opacity = '0.85'; });
    btn.addEventListener('click', (e) => {
      const fmt = e.shiftKey ? 'json' : e.altKey ? 'txt' : 'md';
      btn.textContent = 'Exporting...'; btn.disabled = true;
      exportChat(fmt, true)
        .then((r) => { btn.textContent = 'Done: ' + r.messageCount + ' msgs'; })
        .catch((err) => { console.error('[zai-export]', err); btn.textContent = 'Error (см. консоль)'; })
        .finally(() => { btn.disabled = false; setTimeout(() => { btn.textContent = 'Export chat'; }, 4000); });
    });
    document.body.appendChild(btn);
  }

  const observer = new MutationObserver(() => mountButton());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  mountButton();
})();
