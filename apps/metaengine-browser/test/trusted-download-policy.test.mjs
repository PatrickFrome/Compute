import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { classifyTrustedDownload, TrustedDownloadBroker } from '../src/trusted-download-policy.mjs';

test('allows user-gesture passive download from ChatGPT over HTTPS', () => {
  const d = classifyTrustedDownload({
    pageUrl: 'https://chatgpt.com/c/example',
    sourceUrl: 'https://files.oaiusercontent.com/file/example.pdf',
    urlChain: ['https://chatgpt.com/backend-api/files/example', 'https://files.oaiusercontent.com/file/example.pdf'],
    filename: 'report.pdf',
    mimeType: 'application/pdf',
    userGesture: true,
  });
  assert.equal(d.allow, true);
  assert.equal(d.executable_like, false);
});

test('blocks downloads without a user gesture', () => {
  const d = classifyTrustedDownload({
    pageUrl: 'https://chatgpt.com/c/example',
    sourceUrl: 'https://files.oaiusercontent.com/file/example.pdf',
    urlChain: ['https://files.oaiusercontent.com/file/example.pdf'],
    filename: 'report.pdf',
    userGesture: false,
  });
  assert.equal(d.allow, false);
  assert.equal(d.reason, 'USER_GESTURE_REQUIRED');
});

test('blocks executable/script downloads even when user initiated from ChatGPT', () => {
  for (const filename of ['payload.exe', 'setup.msi', 'run.ps1', 'launch.cmd', 'report.pdf.exe', 'link.lnk']) {
    const d = classifyTrustedDownload({
      pageUrl: 'https://chatgpt.com/c/example',
      sourceUrl: `https://files.oaiusercontent.com/file/${filename}`,
      urlChain: [`https://files.oaiusercontent.com/file/${filename}`],
      filename,
      userGesture: true,
    });
    assert.equal(d.allow, false, filename);
    assert.equal(d.reason, 'EXECUTABLE_REQUIRES_VERIFIED_UPDATE_PLANE', filename);
  }
});

test('blocks executable MIME even with innocent-looking filename', () => {
  const d = classifyTrustedDownload({
    pageUrl: 'https://github.com/PatrickFrome/Compute/releases',
    sourceUrl: 'https://objects.githubusercontent.com/example/download',
    urlChain: ['https://objects.githubusercontent.com/example/download'],
    filename: 'download.bin',
    mimeType: 'application/x-msdownload',
    userGesture: true,
  });
  assert.equal(d.allow, false);
  assert.equal(d.reason, 'EXECUTABLE_REQUIRES_VERIFIED_UPDATE_PLANE');
});

test('blocks non-HTTPS redirect chain and untrusted initiator', () => {
  assert.equal(classifyTrustedDownload({
    pageUrl: 'https://evil.example/',
    sourceUrl: 'https://files.oaiusercontent.com/a.pdf',
    urlChain: ['https://files.oaiusercontent.com/a.pdf'],
    filename: 'a.pdf',
    userGesture: true,
  }).reason, 'INITIATOR_NOT_TRUSTED');

  assert.equal(classifyTrustedDownload({
    pageUrl: 'https://chatgpt.com/',
    sourceUrl: 'https://files.oaiusercontent.com/a.pdf',
    urlChain: ['https://chatgpt.com/a', 'http://files.example/a.pdf'],
    filename: 'a.pdf',
    userGesture: true,
  }).reason, 'DOWNLOAD_URL_CHAIN_NOT_HTTPS');
});

test('broker prevents blocked download and never auto-opens approved files', () => {
  const broker = new TrustedDownloadBroker();
  const blockedEvent = { prevented: false, preventDefault() { this.prevented = true; } };
  const blocked = new EventEmitter();
  blocked.getURL = () => 'https://files.oaiusercontent.com/tool.exe';
  blocked.getURLChain = () => ['https://files.oaiusercontent.com/tool.exe'];
  blocked.getFilename = () => 'tool.exe';
  blocked.getMimeType = () => 'application/x-msdownload';
  blocked.hasUserGesture = () => true;
  broker.handleWillDownload(blockedEvent, blocked, { getURL: () => 'https://chatgpt.com/c/example' });
  assert.equal(blockedEvent.prevented, true);

  const approvedEvent = { prevented: false, preventDefault() { this.prevented = true; } };
  const approved = new EventEmitter();
  approved.getURL = () => 'https://files.oaiusercontent.com/report.pdf';
  approved.getURLChain = () => ['https://files.oaiusercontent.com/report.pdf'];
  approved.getFilename = () => 'report.pdf';
  approved.getMimeType = () => 'application/pdf';
  approved.hasUserGesture = () => true;
  approved.setSaveDialogOptions = (options) => { approved.options = options; };
  const decision = broker.handleWillDownload(approvedEvent, approved, { getURL: () => 'https://chatgpt.com/c/example' });
  assert.equal(decision.allow, true);
  assert.equal(approvedEvent.prevented, false);
  assert.equal(approved.options.title, 'Save download');
  assert.equal(typeof approved.open, 'undefined');
});
