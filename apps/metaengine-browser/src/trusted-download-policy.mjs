import path from 'node:path';

const PASSIVE_PAGE_HOSTS = new Set([
  'chatgpt.com',
  'www.chatgpt.com',
  'chat.openai.com',
  'github.com',
  'www.github.com',
]);

const EXECUTABLE_EXTENSIONS = new Set([
  '.exe', '.msi', '.msp', '.msix', '.appx', '.appxbundle', '.msixbundle',
  '.ps1', '.psm1', '.psd1', '.cmd', '.bat', '.com', '.scr', '.dll', '.cpl',
  '.js', '.jse', '.vbs', '.vbe', '.wsf', '.wsh', '.hta', '.reg', '.lnk', '.url', '.jar',
]);

const EXECUTABLE_MIME = /(?:x-msdownload|x-msdos-program|x-msi|application\/x-executable|application\/x-sh|application\/x-powershell)/i;
const SAFE_SCHEMES = new Set(['https:']);

function normalizedHost(input) {
  try {
    const url = new URL(String(input || ''));
    return SAFE_SCHEMES.has(url.protocol) ? url.hostname.toLowerCase() : '';
  } catch { return ''; }
}

function safeUrlChain(urlChain = []) {
  if (!Array.isArray(urlChain) || urlChain.length === 0) return false;
  return urlChain.every((value) => {
    try { return SAFE_SCHEMES.has(new URL(String(value)).protocol); }
    catch { return false; }
  });
}

export function isExecutableLikeDownload({ filename = '', mimeType = '' } = {}) {
  const ext = path.extname(String(filename || '').trim().toLowerCase());
  return EXECUTABLE_EXTENSIONS.has(ext) || EXECUTABLE_MIME.test(String(mimeType || ''));
}

export function classifyTrustedDownload({
  pageUrl = '',
  sourceUrl = '',
  urlChain = [],
  filename = '',
  mimeType = '',
  userGesture = false,
} = {}) {
  const pageHost = normalizedHost(pageUrl);
  const sourceHost = normalizedHost(sourceUrl);
  const executableLike = isExecutableLikeDownload({ filename, mimeType });

  if (!userGesture) {
    return { allow: false, reason: 'USER_GESTURE_REQUIRED', executable_like: executableLike };
  }
  if (!PASSIVE_PAGE_HOSTS.has(pageHost)) {
    return { allow: false, reason: 'INITIATOR_NOT_TRUSTED', executable_like: executableLike };
  }
  if (!sourceHost || !safeUrlChain(urlChain.length ? urlChain : [sourceUrl])) {
    return { allow: false, reason: 'DOWNLOAD_URL_CHAIN_NOT_HTTPS', executable_like: executableLike };
  }
  if (executableLike) {
    return {
      allow: false,
      reason: 'EXECUTABLE_REQUIRES_VERIFIED_UPDATE_PLANE',
      executable_like: true,
    };
  }
  return {
    allow: true,
    reason: 'USER_GESTURE_PASSIVE_DOWNLOAD',
    executable_like: false,
    page_host: pageHost,
    source_host: sourceHost,
  };
}

export class TrustedDownloadBroker {
  #records = [];
  #maxRecords;
  #onChange;

  constructor({ maxRecords = 50, onChange = () => {} } = {}) {
    this.#maxRecords = Math.max(5, Number(maxRecords) || 50);
    this.#onChange = typeof onChange === 'function' ? onChange : () => {};
  }

  snapshot() {
    return {
      schema: 'metaengine.trusted-download-broker.v1',
      downloads: structuredClone(this.#records),
      executable_download_authority: false,
      self_update_separate_trusted_plane: true,
      authority_effect: false,
    };
  }

  #record(row) {
    this.#records.push({ ...row, at: new Date().toISOString(), authority_effect: false });
    if (this.#records.length > this.#maxRecords) this.#records.splice(0, this.#records.length - this.#maxRecords);
    try { this.#onChange(this.snapshot()); } catch {}
  }

  handleWillDownload(event, item, webContents) {
    const input = {
      pageUrl: webContents?.getURL?.() || '',
      sourceUrl: item?.getURL?.() || '',
      urlChain: item?.getURLChain?.() || [],
      filename: item?.getFilename?.() || '',
      mimeType: item?.getMimeType?.() || '',
      userGesture: item?.hasUserGesture?.() === true,
    };
    const decision = classifyTrustedDownload(input);
    if (!decision.allow) {
      event?.preventDefault?.();
      this.#record({ state: 'BLOCKED', filename: String(input.filename).slice(0, 240), reason: decision.reason });
      return decision;
    }

    if (typeof item?.setSaveDialogOptions === 'function') {
      item.setSaveDialogOptions({
        title: 'Save download',
        defaultPath: String(input.filename || 'download').slice(0, 240),
      });
    }
    this.#record({ state: 'APPROVED_USER_SAVE', filename: String(input.filename).slice(0, 240), reason: decision.reason });
    item?.once?.('done', (_event, state) => {
      this.#record({ state: `DONE_${String(state || 'unknown').toUpperCase()}`, filename: String(input.filename).slice(0, 240), reason: decision.reason });
    });
    return decision;
  }
}
