const statusEl = document.getElementById('status');

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = cls || '';
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

document.querySelectorAll('button.fmt').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const format = btn.dataset.format;
    const autoScroll = document.getElementById('autoscroll').checked;
    try {
      const tab = await getActiveTab();
      if (!tab || !tab.url || !/^https:\/\/([a-z0-9-]+\.)*z\.ai\//i.test(tab.url)) {
        setStatus('Откройте чат на chat.z.ai и попробуйте снова.', 'err');
        return;
      }
      setStatus('Экспорт: прокрутка истории и сбор сообщений…');
      const resp = await chrome.tabs.sendMessage(tab.id, { type: 'ZAI_EXPORT', format, autoScroll }).catch((e) => {
        throw new Error('нет ответа от вкладки: ' + (e && e.message ? e.message : e) + ' — обновите страницу (F5)');
      });
      if (!resp || !resp.ok) {
        setStatus('Ошибка: ' + ((resp && resp.error) || 'неизвестная'), 'err');
        return;
      }
      setStatus('Готово: ' + resp.messageCount + ' сообщений (user=' + resp.user + ', assistant=' + resp.assistant +
        (resp.unknown ? ', unknown=' + resp.unknown : '') + ')\nФайл: ' + resp.filename, 'ok');
    } catch (e) {
      setStatus('Ошибка: ' + (e && e.message ? e.message : e), 'err');
    }
  });
});
