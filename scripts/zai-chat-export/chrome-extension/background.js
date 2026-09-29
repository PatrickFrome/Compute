/* Z.ai Chat Export — service worker (Chrome MV3).
 * Обязанности: хоткей export-md (Ctrl+Shift+Y) -> экспорт активной вкладки.
 * Скачивание выполняется в content script через <a download> (гарантированно
 * работает; blob URL нельзя создавать в service worker MV3).
 * Если content script ещё не в странице (вкладка открыта до установки
 * расширения) — инжектируем content.js через chrome.scripting и повторяем. */

async function ensureContentScript(tabId) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: 'ZAI_EXPORT_PING' });
    if (pong && pong.ok) return true;
  } catch { /* нет ресивера — попробуем инжектировать */ }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await new Promise((r) => setTimeout(r, 300));
    const pong2 = await chrome.tabs.sendMessage(tabId, { type: 'ZAI_EXPORT_PING' });
    return !!(pong2 && pong2.ok);
  } catch (e) {
    console.warn('[zai-export] inject failed:', e && e.message ? e.message : e);
    return false;
  }
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'export-md') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !/^https:\/\/([a-z0-9-]+\.)*z\.ai\//i.test(tab.url || '')) {
    console.warn('[zai-export] активная вкладка — не чат Z.ai');
    return;
  }
  const ready = await ensureContentScript(tab.id);
  if (!ready) return;
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'ZAI_EXPORT', format: 'md', autoScroll: true });
    console.log('[zai-export]', res && res.ok ? res.filename + ' (' + res.messageCount + ' сообщений, порядок: ' + (res.meta && res.meta.order) + ')' : res);
  } catch (e) {
    console.warn('[zai-export] export failed:', e && e.message ? e.message : e);
  }
});
