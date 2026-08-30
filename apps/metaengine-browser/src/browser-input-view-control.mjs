const NAMED_KEYS = new Set([
  'Backspace','Delete','Insert','Enter','Return','Escape','Esc','Tab','Space',
  'Up','Down','Left','Right','Home','End','PageUp','PageDown',
  'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',
  'F13','F14','F15','F16','F17','F18','F19','F20','F21','F22','F23','F24',
]);

const NAMED_KEY_CANONICAL = new Map([
  ['RETURN','Enter'], ['ENTER','Enter'], ['ESC','Escape'], ['ESCAPE','Escape'],
  ['SPACE','Space'], ['TAB','Tab'], ['BACKSPACE','Backspace'], ['DELETE','Delete'], ['INSERT','Insert'],
  ['UP','Up'], ['DOWN','Down'], ['LEFT','Left'], ['RIGHT','Right'],
  ['HOME','Home'], ['END','End'], ['PAGEUP','PageUp'], ['PAGEDOWN','PageDown'],
]);
for (let i = 1; i <= 24; i += 1) NAMED_KEY_CANONICAL.set(`F${i}`, `F${i}`);

const MODIFIER_ALIASES = new Map([
  ['SHIFT','shift'],
  ['CTRL','control'],
  ['CONTROL','control'],
  ['ALT','alt'],
  ['META','meta'],
  ['COMMAND','meta'],
  ['CMD','meta'],
]);

function normalizeKeyCode(input) {
  const raw = String(input || '').trim();
  if (!raw || raw.length > 32) throw new Error('browser_key_invalid');
  if (/^[a-z]$/i.test(raw)) return raw.toUpperCase();
  if (/^[0-9]$/.test(raw)) return raw;
  const canonical = NAMED_KEY_CANONICAL.get(raw.toUpperCase());
  if (canonical && NAMED_KEYS.has(canonical)) return canonical;
  throw new Error('browser_key_not_allowlisted');
}

function normalizeModifiers(input, platform = process.platform) {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > 4) throw new Error('browser_key_modifiers_invalid');
  const values = new Set();
  for (const item of input) {
    const raw = String(item || '').trim().toUpperCase();
    if (!raw) throw new Error('browser_key_modifier_invalid');
    if (raw === 'PRIMARY' || raw === 'CMDORCTRL' || raw === 'COMMANDORCONTROL') {
      values.add(platform === 'darwin' ? 'meta' : 'control');
      continue;
    }
    const normalized = MODIFIER_ALIASES.get(raw);
    if (!normalized) throw new Error('browser_key_modifier_not_allowlisted');
    values.add(normalized);
  }
  return [...values].sort();
}

export function normalizeTypedKey(payload = {}, { platform = process.platform } = {}) {
  return Object.freeze({
    key_code: normalizeKeyCode(payload?.key),
    modifiers: normalizeModifiers(payload?.modifiers, platform),
  });
}

export function executeTypedKeyPress(webContents, payload = {}, options = {}) {
  if (!webContents || webContents.isDestroyed?.()) throw new Error('browser_key_webcontents_unavailable');
  if (typeof webContents.sendInputEvent !== 'function') throw new Error('browser_key_input_backend_unavailable');
  const normalized = normalizeTypedKey(payload, options);
  const event = { keyCode: normalized.key_code, modifiers: normalized.modifiers };
  webContents.sendInputEvent({ type: 'keyDown', ...event });
  webContents.sendInputEvent({ type: 'keyUp', ...event });
  return Object.freeze({
    action: 'KEY_PRESS',
    key_code: normalized.key_code,
    modifiers: [...normalized.modifiers],
    event_count: 2,
    arbitrary_text: false,
    authority_effect: true,
  });
}

export function setIsolatedZoom(webContents, payload = {}) {
  if (!webContents || webContents.isDestroyed?.()) throw new Error('browser_zoom_webcontents_unavailable');
  if (typeof webContents.setZoomMode !== 'function' || typeof webContents.setZoomFactor !== 'function' || typeof webContents.getZoomFactor !== 'function') {
    throw new Error('browser_isolated_zoom_backend_unavailable');
  }
  const factor = Number(payload?.factor);
  if (!Number.isFinite(factor) || factor < 0.5 || factor > 3) throw new Error('browser_zoom_factor_out_of_range');
  const normalized = Math.round(factor * 100) / 100;
  webContents.setZoomMode('isolated');
  webContents.setZoomFactor(normalized);
  const readback = Number(webContents.getZoomFactor());
  if (!Number.isFinite(readback) || Math.abs(readback - normalized) > 0.001) throw new Error('browser_zoom_readback_mismatch');
  return Object.freeze({
    action: 'SET_ZOOM',
    mode: 'isolated',
    factor: normalized,
    readback_factor: readback,
    authority_effect: true,
  });
}
