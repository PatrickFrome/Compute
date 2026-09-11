import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { captureViewThumbnail } from '../src/native-browser-control.mjs';

function fakeImage({ width = 1280, height = 720, jpeg = Buffer.from('capture') } = {}) {
  return {
    getSize: () => ({ width, height }),
    resize: () => fakeImage({ width: Math.min(width, 720), height, jpeg }),
    toJPEG: () => jpeg,
  };
}

function fakeWebContents(image) {
  return {
    isDestroyed: () => false,
    capturePage: async () => image,
    getURL: () => 'https://example.com/',
    getTitle: () => 'Example Domain',
  };
}

test('capture view returns a bounded non-empty thumbnail receipt', async () => {
  const jpeg = Buffer.from('non-empty-jpeg');
  const result = await captureViewThumbnail(fakeWebContents(fakeImage({ jpeg })));

  assert.equal(result.schema, 'metaengine.native-browser.capture-thumbnail.v1');
  assert.equal(result.source_width, 1280);
  assert.equal(result.source_height, 720);
  assert.equal(result.jpeg_bytes, jpeg.byteLength);
  assert.equal(result.jpeg_base64, jpeg.toString('base64'));
  assert.equal(result.sha256, crypto.createHash('sha256').update(jpeg).digest('hex'));
  assert.equal(result.authority_effect, false);
});

test('capture view rejects a detached zero-area surface instead of hashing an empty image', async () => {
  const webContents = fakeWebContents(fakeImage({ width: 0, height: 0, jpeg: Buffer.alloc(0) }));

  await assert.rejects(
    captureViewThumbnail(webContents),
    /native_capture_surface_unavailable/,
  );
});

test('capture view rejects an empty encoded thumbnail from a positive-area surface', async () => {
  const webContents = fakeWebContents(fakeImage({ width: 640, height: 480, jpeg: Buffer.alloc(0) }));

  await assert.rejects(
    captureViewThumbnail(webContents),
    /native_capture_thumbnail_empty/,
  );
});
