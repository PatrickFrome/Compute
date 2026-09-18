import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

test('Windows package identity uses the canonical METAENGINE Browser icon', () => {
  const pkg = readJson('package.json');
  const builder = readJson('electron-builder.test.json');
  assert.equal(pkg.author, 'METAENGINE');
  assert.equal(builder.appId, 'com.metaengine.browser.test');
  assert.equal(builder.productName, 'METAENGINE Browser Test');
  assert.equal(builder.win?.icon, 'build/icon.ico');

  const iconPath = path.join(root, builder.win.icon);
  const icon = fs.readFileSync(iconPath);
  assert.ok(icon.length > 1024, 'icon must contain real multi-resolution payloads');
  assert.deepEqual([...icon.subarray(0, 4)], [0, 0, 1, 0], 'ICO header must declare an icon directory');

  const count = icon.readUInt16LE(4);
  assert.equal(count, 7, 'canonical Windows icon must contain seven size entries');
  const dimensions = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16;
    const width = icon[offset] || 256;
    const height = icon[offset + 1] || 256;
    const payloadSize = icon.readUInt32LE(offset + 8);
    const payloadOffset = icon.readUInt32LE(offset + 12);
    assert.equal(width, height, 'each ICO entry must be square');
    assert.ok(payloadSize > 0, 'each ICO entry must contain a payload');
    assert.ok(payloadOffset + payloadSize <= icon.length, 'each ICO payload must stay within the file');
    dimensions.push(width);
  }
  assert.deepEqual(dimensions, [16, 24, 32, 48, 64, 128, 256]);
});
