import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { initiateSelectedTabReload } from '../src/reload-auth-redirect-gate.mjs';

function fixture({ destroyed = false, url = 'https://example.com/', failure } = {}) {
  const effects = [];
  return {
    effects,
    tab: { tab_id: 'selected-tab', url },
    view: { webContents: {
      isDestroyed: () => destroyed,
      reload() { effects.push('reload'); if (failure) throw failure; },
    } },
    invalidatePerception: (id) => effects.push(['invalidate', id]),
  };
}

test('missing selected tab or live WebContents never reports reload initiation', () => {
  for (const input of [undefined, {}, { tab: { tab_id: 'missing-view' } },
    { view: fixture().view }, fixture({ destroyed: true }),
    { tab: { tab_id: 'malformed' }, view: { webContents: {} } }]) {
    assert.throws(() => initiateSelectedTabReload(input), /no_selected_tab/);
  }
});

test('selected-tab reload preserves the auth refusal without a navigation effect', () => {
  const fx = fixture({ url: 'https://chatgpt.com/auth/login' });
  assert.throws(() => initiateSelectedTabReload(fx), { code: 'reload_auth_redirect_forbidden' });
  assert.deepEqual(fx.effects, []);
});

test('a thrown reload cannot become a successful initiation receipt', () => {
  const failure = new Error('webcontents-gone-during-reload');
  const fx = fixture({ failure });
  assert.throws(() => initiateSelectedTabReload(fx), (error) => error === failure);
  assert.deepEqual(fx.effects, ['reload']);
});

test('successful initiation reloads the live selection once before invalidating its perception', () => {
  const fx = fixture();
  assert.deepEqual(initiateSelectedTabReload(fx), { ok: true, reload_initiated: true });
  assert.deepEqual(fx.effects, ['reload', ['invalidate', fx.tab.tab_id]]);
});

test('the selected-tab command path uses the tested executor without bootstrapping Electron', async () => {
  const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
  const branch = main.slice(main.indexOf("if (command === 'RELOAD')"), main.indexOf("if (command === 'COMPUTE_HEALTH')"));
  assert.match(branch, /return initiateSelectedTabReload\(\{ tab: selected, view: selectedView, invalidatePerception \}\)/);
  assert.doesNotMatch(branch, /selectedView\?\./);
});
