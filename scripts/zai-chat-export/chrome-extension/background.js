/* Z.ai Chat Export — service worker (MV3)
 * Обязанности: скачивание файлов через chrome.downloads, хоткей export-md. */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'zai-download') {
    const blob = new Blob([msg.payload], { type: (msg.mime || 'text/plain') + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename: msg.filename, saveAs: false }, (id) => {
      const err = chrome.runtime.lastError;
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* noop */ } }, 30000);
      if (err) {
        // Не смогли через downloads API — пусть content script качает сам через <a>.
        sendResponse({ ok: false, error: err.message });
      } else {
        sendResponse({ ok: true, id });
      }
    });
    return true; // асинхронный ответ
  }
  return undefined;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'export-md') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'ZAI_EXPORT', format: 'md', autoScroll: true });
  } catch {
    // Контент-скрипт ещё не загружен (страница открыта до установки) — подсказка в консоли SW.
    console.warn('[zai-export] content script недоступен на активной вкладке; обновите страницу z.ai');
  }
});
