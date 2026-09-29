/* Z.ai Chat Export — popup logic (Chrome MV3).
 * Кнопки формата скачивают файл (через content script, <a download>).
 * «Скопировать текст» кладёт payload в буфер обмена без файла.
 * Если content script не отвечает (вкладка открыта до установки) —
 * инжектируем через chrome.scripting и повторяем. */

const statusEl = document.getElementById('status');

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = cls || '';
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

function isZaiUrl(url) {
  return /^https:\/\/([a-z0-9-]+\.)*z\.ai\//i.test(url || '');
}

async function ensureInjected(tabId) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: 'ZAI_EXPORT_PING' });
    if (pong && pong.ok) return true;
  } catch { /* fallthrough */ }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await new Promise((r) => setTimeout(r, 300));
    return true;
  } catch {
    return false;
  }
}

async function requestExport(format) {
  const autoScroll = document.getElementById('autoscroll').checked;
  const buttons = Array.from(document.querySelectorAll('button.fmt, button.util'));
  buttons.forEach((b) => { b.disabled = true; });
  try {
    const tab = await getActiveTab();
    if (!tab || !tab.id || !isZaiUrl(tab.url)) {
      setStatus('Откройте чат на chat.z.ai и попробуйте снова.', 'err');
      return;
    }
    setStatus('Экспорт: прокрутка истории и сбор сообщений…');
    const ok = await ensureInjected(tab.id);
    if (!ok) {
      setStatus('Не удалось подключиться к вкладке. Обновите страницу (F5) и повторите.', 'err');
      return;
    }
    const resp = await chrome.tabs.sendMessage(tab.id, { type: 'ZAI_EXPORT', format, autoScroll });
    if (!resp || !resp.ok) {
      setStatus('Ошибка: ' + ((resp && resp.error) || 'неизвестная'), 'err');
      return;
    }
    setStatus('Готово: ' + resp.messageCount + ' сообщений (user=' + resp.user + ', assistant=' + resp.assistant +
      (resp.unknown ? ', unknown=' + resp.unknown : '') + '), порядок: ' + (resp.meta && resp.meta.order ? resp.meta.order : 'discovery') +
      '\nФайл: ' + resp.filename, 'ok');
  } catch (e) {
    setStatus('Ошибка: ' + (e && e.message ? e.message : e) + ' — обновите страницу (F5)', 'err');
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
  }
}

async function copyText() {
  const copyBtn = document.getElementById('copy');
  copyBtn.disabled = true;
  try {
    const tab = await getActiveTab();
    if (!tab || !tab.id || !isZaiUrl(tab.url)) {
      setStatus('Откройте чат на chat.z.ai и попробуйте снова.', 'err');
      return;
    }
    setStatus('Читаю текст чата…');
    const ok = await ensureInjected(tab.id);
    if (!ok) { setStatus('Не удалось подключиться к вкладке. Обновите страницу (F5).', 'err'); return; }
    const resp = await chrome.tabs.sendMessage(tab.id, {
      type: 'ZAI_EXPORT',
      format: 'txt',
      autoScroll: document.getElementById('autoscroll').checked
    });
    if (!resp || !resp.ok || !resp.payload) {
      setStatus('Ошибка: ' + ((resp && resp.error) || 'пустой результат'), 'err');
      return;
    }
    await navigator.clipboard.writeText(resp.payload);
    setStatus('Скопировано: ' + resp.messageCount + ' сообщений, ' + resp.payload.length + ' символов.', 'ok');
  } catch (e) {
    setStatus('Буфер обмена недоступен: ' + (e && e.message ? e.message : e), 'err');
  } finally {
    copyBtn.disabled = false;
  }
}

document.querySelectorAll('button.fmt').forEach((btn) => {
  btn.addEventListener('click', () => requestExport(btn.dataset.format));
});
document.getElementById('copy').addEventListener('click', copyText);

// При открытии popup показываем, находимся ли мы на вкладке Z.ai.
(async () => {
  const tab = await getActiveTab();
  if (tab && isZaiUrl(tab.url)) {
    const ok = await ensureInjected(tab.id).catch(() => false);
    setStatus(ok
      ? 'Вкладка Z.ai готова. Выберите формат. Хоткей: Ctrl+Shift+Y.'
      : 'Вкладка Z.ai открыта, но скрипт не подключился — обновите страницу (F5).');
  }
})();
