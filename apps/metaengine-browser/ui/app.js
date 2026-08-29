const api = window.metaengineShell;
const tabsEl = document.getElementById('tabs');
const address = document.getElementById('address');
const compute = document.getElementById('compute');
let snapshot = null;

function fleetOwnedTabIds(next) {
  return new Set((next?.fleet?.agents || [])
    .filter((agent) => agent?.ownership === 'FLEET_OWNED' && agent?.tab_id)
    .map((agent) => String(agent.tab_id)));
}

function render(next) {
  snapshot = next;
  const selected = next?.tabs?.tabs?.find((x) => x.tab_id === next.tabs.selected_tab_id);
  const fleetOwned = fleetOwnedTabIds(next);
  if (selected && document.activeElement !== address) address.value = selected.url || '';
  tabsEl.replaceChildren(...(next?.tabs?.tabs || []).map((tab) => {
    const wrap = document.createElement('div'); wrap.className = `tab ${tab.tab_id === next.tabs.selected_tab_id ? 'active' : ''}`;
    const select = document.createElement('button'); select.className = 'tabSelect'; select.textContent = tab.title || (tab.kind === 'CHATGPT' ? 'ChatGPT' : tab.url); select.title = tab.url; select.onclick = () => api.command('SELECT_TAB', { tab_id: tab.tab_id });
    const close = document.createElement('button'); close.className = 'tabClose'; close.textContent = '×';
    const protectedFleetSurface = tab.ownership === 'FLEET_OWNED' || fleetOwned.has(String(tab.tab_id));
    close.disabled = protectedFleetSurface;
    close.title = protectedFleetSurface ? 'Fleet-owned tab: retire through typed fleet lifecycle' : 'Close tab';
    if (!protectedFleetSurface) close.onclick = () => api.command('CLOSE_TAB', { tab_id: tab.tab_id });
    wrap.append(select, close); return wrap;
  }));
  compute.textContent = next?.compute?.available ? `Compute: ${next.compute.result?.runtime || 'ready'}` : 'Compute: offline';
  compute.classList.toggle('ready', Boolean(next?.compute?.available));
}

document.querySelectorAll('[data-cmd]').forEach((button) => button.addEventListener('click', () => api.command(button.dataset.cmd, {})));
document.getElementById('newChat').addEventListener('click', () => api.command('NEW_CHATGPT', {}));
document.getElementById('addressForm').addEventListener('submit', (event) => { event.preventDefault(); api.command('NAVIGATE', { url: address.value }); });
api.onSnapshot(render);
api.snapshot().then(render);