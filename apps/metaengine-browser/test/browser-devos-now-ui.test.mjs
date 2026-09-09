import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const readUi = () => fs.readFile(new URL('../ui/app.js', import.meta.url), 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing start marker: ${start}`);
  assert.ok(to > from, `missing end marker: ${end}`);
  return source.slice(from, to);
}

test('Attention renders canonical snapshot.devos_shell.now instead of reconstructing runtime alerts', async () => {
  const ui = await readUi();
  assert.match(ui, /function devosShellView\(next\)/);
  assert.match(ui, /const view = next\?\.devos_shell/);
  assert.match(ui, /view\.schema !== 'metaengine\.devos\.shell-view-model\.v1'/);
  assert.match(ui, /function devosNowItems\(next\)/);
  assert.match(ui, /view\.now\.slice\(0, 256\)/);
  assert.doesNotMatch(ui, /function attentionQueue\(next\)/);
  assert.doesNotMatch(ui, /no derived attention items|Derived queue|Open derived read-only attention queue/);

  const now = section(ui, 'function devosNowItems(next)', 'function installAgenticNav()');
  for (const forbidden of [
    /next\?\.fleet/,
    /workspaceProjection\(next\)/,
    /next\?\.supervisor/,
    /next\?\.development_plane/,
    /next\?\.compute/,
    /next\?\.owner_safety_gates/,
  ]) assert.doesNotMatch(now, forbidden);

  const attention = section(ui, 'function renderAttention(next)', 'function renderActivity(next)');
  assert.match(attention, /const view = devosShellView\(next\)/);
  assert.match(attention, /const items = devosNowItems\(next\)/);
  assert.match(attention, /Canonical snapshot\.devos_shell\.now only/);
  assert.match(attention, /section\('Canonical Now'/);
  assert.doesNotMatch(attention, /next\?\.fleet|workspaceProjection\(next\)|next\?\.supervisor|next\?\.development_plane|next\?\.compute|next\?\.owner_safety_gates/);
});

test('renderer validates zero-authority DevOS shell ViewModel before using Now', async () => {
  const ui = await readUi();
  const validator = section(ui, 'function devosShellView(next)', 'function attentionTone(row)');
  for (const field of [
    'renderer_selection_authority',
    'renderer_routing_authority',
    'projection_is_authority',
    'scheduler_authority',
    'execution_authority',
    'command_leasing',
    'automatic_effect_retry_allowed',
    'page_model_authority',
    'authority_effect',
  ]) assert.match(validator, new RegExp(`view\\.${field} !== false`));
  assert.match(ui, /commandButton\('Triage Attention', 'Open canonical DevOS Now'/);
});
