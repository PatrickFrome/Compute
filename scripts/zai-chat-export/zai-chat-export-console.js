/* ============================================================================
 * Z.ai Chat Export — console edition
 * ============================================================================
 * Назначение: скачивает весь текст текущего чата Z.ai (z.ai / chat.z.ai)
 * в файл Markdown / JSON / TXT.
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 *   1. Откройте нужный чат в Z.ai (вкладка должна остаться открытой).
 *   2. F12 (DevTools) -> вкладка Console.
 *      (Chrome при первой вставке может попросить ввести "allow pasting" —
 *       введите эту строку в консоль и нажмите Enter, затем вставьте скрипт.)
 *   3. Вставьте ВЕСЬ этот файл в консоль и нажмите Enter.
 *   4. Скрипт сам прокрутит историю вверх, соберёт сообщения и скачает файл.
 *
 * Результат также доступен программно: window.__ZAI_CHAT_EXPORT
 * (удобно для отладки: скопируйте JSON вручную, если скачивание заблокировано).
 *
 * НАСТРОЙКА: блок CONFIG ниже. Если экспорт нашёл 0 сообщений —
 * подстройте MESSAGE_SELECTORS под реальный DOM (см. README, раздел Troubleshooting).
 * ============================================================================ */
(function () {
  'use strict';

  /* ----------------------------- CONFIG ---------------------------------- */
  const CONFIG = {
    FORMAT: 'md',              // 'md' | 'json' | 'txt'
    AUTO_SCROLL: true,         // прокручивать историю вверх, чтобы загрузить всё
    MAX_SCROLL_STEPS: 300,     // предохранитель от бесконечной прокрутки
    SCROLL_SETTLE_MS: 450,     // пауза после каждого прыжка вверх (подгрузка)
    NO_GROWTH_STOP: 10,        // сколько «пустых» шагов подряд = история кончилась
    DOWNLOAD: true,            // скачать файл; false = только вернуть результат
    // Селекторы сообщения (проверяются по порядку; находки объединяются).
    MESSAGE_SELECTORS: [
      '[data-message-id]',
      '[data-testid*="message" i]',
      '[class*="message" i]',
      '[class*="chat-item" i]',
      '[class*="bubble" i]',
      'article'
    ],
    // Подсказки роли по классам/атрибутам.
    USER_HINT: /(user|human|self|mine|from-me)/i,
    ASSISTANT_HINT: /(assistant|bot|\bai\b|model|gpt|markdown|prose|answer|reply)/i
  };
  /* ----------------------------------------------------------------------- */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  function stableId(el, text) {
    return el.getAttribute('data-message-id')
      || el.getAttribute('data-id')
      || (hash((el.className || '') + '|' + text.slice(0, 160)));
  }

  /* ---------------------- поиск узлов сообщений -------------------------- */
  function collectMessageNodes() {
    const found = new Set();
    for (const sel of CONFIG.MESSAGE_SELECTORS) {
      let nodes;
      try { nodes = Array.from(document.querySelectorAll(sel)); } catch { continue; }
      for (const n of nodes) found.add(n);
    }
    // Отбрасываем контейнеры: узел, содержащий другой выбранный узел, — не сообщение.
    const list = Array.from(found).filter((n) => !(n.nodeType === 1 && Array.from(found).some((m) => m !== n && n.contains(m))));
    // Оставляем только реально отрисованные узлы.
    return list.filter((n) => n.getClientRects().length > 0 || n.offsetHeight > 0);
  }

  /* ------------------------- определение роли ---------------------------- */
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
    // Выравнивание: у большинства чатов «своё» сообщение прижато к правому краю.
    try {
      const cs = getComputedStyle(el);
      const ps = el.parentElement ? getComputedStyle(el.parentElement) : null;
      if (cs.alignSelf === 'flex-end' || (ps && ps.justifyContent === 'flex-end') || /margin-left:\s*auto/.test(cs.cssText)) return 'user';
      if (cs.alignSelf === 'flex-start' || (ps && ps.justifyContent === 'flex-start')) return 'assistant';
    } catch { /* noop */ }
    return 'unknown';
  }

  /* --------------------- извлечение текста и кода ------------------------ */
  function extractContent(el) {
    const codeBlocks = [];
    el.querySelectorAll('pre').forEach((pre) => {
      const langMatch = (pre.className || '').match(/(?:language|lang)-([\w-]+)/i)
        || (pre.querySelector('[class*="language-"]') || { className: '' }).className.match(/language-([\w-]+)/i);
      codeBlocks.push({ lang: langMatch ? langMatch[1] : '', code: pre.innerText.replace(/\n+$/, '') });
    });

    // Если кодовых блоков нет — берём plain innerText.
    if (codeBlocks.length === 0) {
      return { text: normalize(el.innerText), codeBlocks };
    }
    // Иначе обходим верхний уровень: pre -> fenced, остальное -> текст.
    const parts = [];
    const seen = new Set();
    const walk = (node) => {
      Array.from(node.childNodes).forEach((child) => {
        if (child.nodeType !== 1) { return; }
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
    const outside = normalize(el.innerText).length;
    const assembled = parts.join('\n\n');
    return { text: assembled || normalize(el.innerText) || ('(non-text content, ' + outside + ' chars)'), codeBlocks };
  }

  function normalize(text) {
    return (text || '').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
  }

  function extractTime(el) {
    const t = el.querySelector && el.querySelector('time[datetime], [data-testid*="time" i][datetime], [class*="timestamp" i]');
    if (t) return t.getAttribute('datetime') || normalize(t.innerText);
    return '';
  }

  /* ------------------------- скролл-загрузка ----------------------------- */
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

  async function loadFullHistory(acc) {
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
    return container === document.scrollingElement ? 'document' : (container.className || container.tagName).toString().slice(0, 80);
  }

  /* --------------------------- накопление -------------------------------- */
  function absorb(nodes, acc) {
    for (const el of nodes) {
      const { text, codeBlocks } = extractContent(el);
      if (!text && codeBlocks.length === 0) continue;
      const id = stableId(el, text);
      if (acc.has(id)) continue;
      acc.set(id, {
        role: detectRole(el),
        time: extractTime(el),
        text,
        codeBlocks
      });
    }
  }

  /* -------------------------- сериализация ------------------------------- */
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

  function chatIdFromUrl() {
    const m = location.href.match(/chat(?:\/|\/c\/|%2F)([\w-]{6,})/i) || location.search.match(/chat[_-]?id=([\w-]+)/i);
    return m ? m[1] : (document.body.getAttribute('data-chat-id') || '');
  }

  function download(name, content, mime) {
    const blob = new Blob([content], { type: mime + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  /* ----------------------------- MAIN ------------------------------------ */
  async function exportChat(overrides) {
    Object.assign(CONFIG, overrides || {});
    const acc = new Map();
    absorb(collectMessageNodes(), acc);
    let scrolledVia = 'skipped';
    if (CONFIG.AUTO_SCROLL) scrolledVia = await loadFullHistory(acc);

    const messages = Array.from(acc.values());
    const meta = {
      url: location.href,
      chatId: chatIdFromUrl(),
      title: document.title,
      exportedAt: new Date().toISOString(),
      scrollContainer: scrolledVia
    };

    let payload, ext, mime;
    if (CONFIG.FORMAT === 'json') {
      payload = JSON.stringify({ meta, messages }, null, 2); ext = 'json'; mime = 'application/json';
    } else if (CONFIG.FORMAT === 'txt') {
      payload = toTxt(meta, messages); ext = 'txt'; mime = 'text/plain';
    } else {
      payload = toMarkdown(meta, messages); ext = 'md'; mime = 'text/markdown';
    }

    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2');
    const filename = 'zai-chat-' + (meta.chatId ? meta.chatId.slice(0, 12) + '-' : '') + stamp + '.' + ext;
    if (CONFIG.DOWNLOAD) download(filename, payload, mime);

    const result = { ok: true, filename, messageCount: messages.length, user: messages.filter(m => m.role === 'user').length, assistant: messages.filter(m => m.role === 'assistant').length, unknown: messages.filter(m => m.role === 'unknown').length, chars: payload.length, scrollContainer: scrolledVia, meta, messages, payload };
    window.__ZAI_CHAT_EXPORT = result;
    console.log('[zai-export] Сообщений собрано: ' + messages.length + ' (user=' + result.user + ', assistant=' + result.assistant + ', unknown=' + result.unknown + ')');
    console.log('[zai-export] Полный результат: window.__ZAI_CHAT_EXPORT (payload = текст файла)');
    return { ok: true, messageCount: messages.length, filename, chars: payload.length };
  }

  // Публичный API: window.__zaiExportChat({FORMAT:'json', DOWNLOAD:false})
  window.__zaiExportChat = exportChat;
  return exportChat().catch((e) => { console.error('[zai-export] Ошибка:', e); return { ok: false, error: String(e) }; });
})();
