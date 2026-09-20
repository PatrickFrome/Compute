import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import { buildInteractionTree } from '../src/native-browser-control.mjs';

const source = await fs.readFile(new URL('../src/native-browser-control.mjs', import.meta.url), 'utf8');

function axNode(nodeId, { role, name, parentId = null, backendDOMNodeId = null, ignored = false, hidden = null } = {}) {
  const node = {
    nodeId: String(nodeId),
    role: { value: role },
    name: { value: name == null ? '' : name },
  };
  if (parentId != null) node.parentId = String(parentId);
  if (backendDOMNodeId != null) node.backendDOMNodeId = backendDOMNodeId;
  if (ignored) node.ignored = true;
  if (hidden != null) node.properties = [{ name: 'hidden', value: { type: 'boolean', value: hidden } }];
  return node;
}

test('buildInteractionTree projects role/text/selector/visibility with bounded ancestor paths', () => {
  const nodes = [
    axNode(1, { role: 'WebArea', name: 'Chat', backendDOMNodeId: 1 }),
    axNode(2, { role: 'main', name: 'main', parentId: 1, backendDOMNodeId: 2 }),
    axNode(3, { role: 'heading', name: 'Fleet status', parentId: 2, backendDOMNodeId: 3 }),
    axNode(4, { role: 'button', name: 'Send', parentId: 2, backendDOMNodeId: 4 }),
    axNode(5, { role: 'button', name: 'Hidden close', parentId: 2, backendDOMNodeId: 5, hidden: true }),
    axNode(6, { role: 'textbox', name: '', parentId: 2, backendDOMNodeId: 6 }),
    axNode(7, { role: 'generic', name: 'layout box', parentId: 2, backendDOMNodeId: 7 }),
    axNode(8, { role: 'statictext', name: 'some prose', parentId: 2, backendDOMNodeId: 8, hidden: false }),
  ];
  const tree = buildInteractionTree(nodes);
  assert.equal(tree.schema, 'metaengine.native-browser.interaction-tree.v1');
  assert.equal(tree.authority_effect, false);
  assert.equal(tree.input_values_exposed, false);
  assert.equal(tree.element_count, 5);
  const [main, heading, send, hiddenButton, prose] = tree.elements;
  assert.deepEqual(Object.keys(heading).sort(), ['path', 'role', 'selector', 'text', 'visible']);
  assert.equal(main.role, 'main');
  assert.equal(main.path, 'webarea>main');
  assert.equal(heading.path, 'webarea>main>heading');
  assert.equal(heading.text, 'Fleet status');
  assert.equal(heading.selector, 'backend_node_id:3');
  assert.equal(heading.visible, null);
  assert.equal(send.role, 'button');
  assert.equal(send.text, 'Send');
  assert.equal(send.visible, null);
  assert.equal(hiddenButton.text, 'Hidden close');
  assert.equal(hiddenButton.visible, false);
  assert.equal(prose.visible, true);
  // Unnamed textboxes and unnamed generics are not tree elements (no text).
  assert.ok(!tree.elements.some((row) => row.role === 'textbox'));
  assert.ok(!tree.elements.some((row) => row.role === 'generic'));
});

test('buildInteractionTree bounds element count and clips text', () => {
  const nodes = [];
  for (let i = 0; i < 200; i += 1) {
    nodes.push(axNode(i + 1, { role: 'link', name: `L${i} `.repeat(60).trim(), backendDOMNodeId: i + 1 }));
  }
  const tree = buildInteractionTree(nodes);
  assert.equal(tree.element_count, 96);
  assert.equal(tree.truncated, true);
  for (const row of tree.elements) assert.ok(row.text.length <= 160);
  assert.equal(buildInteractionTree([]).element_count, 0);
  assert.equal(buildInteractionTree([]).truncated, false);
});

test('CAPTURE frame carries the interaction tree (structured perception break repair)', () => {
  assert.match(source, /text_excerpt: textExcerpt\(nodes\),\s*\n\s*interaction_tree: buildInteractionTree\(nodes\),/);
  assert.match(source, /export function buildInteractionTree\(nodes = \[\]\)/);
});
