/**
 * ME2 · самообновление оболочки изнутри (R46, продолжение механики selfupdate ядра).
 *
 * Постановка «обновляй браузер изнутри» из умного слияния: оболочка проверяет свежий
 * релиз GitHub (PatrickFrome/Compute), скачивает артефакт платформы в staged-каталог;
 * применение — после перезапуска (AppImage: запуск новой версии; exe/dmg — открытие
 * установщика). В dev-режиме — только честная проверка, без подмены работающего кода.
 */
import { createWriteStream, existsSync, mkdirSync, chmodSync } from "node:fs";
import { get } from "node:https";
import path from "node:path";

const REPO = "PatrickFrome/Compute";
const API_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;

export interface UpdateAsset { name: string; url: string; size: number }
export interface UpdateInfo {
  ok: boolean;
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  asset: UpdateAsset | null;
  error: string | null;
}

function fetchJson(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = get(url, {
      headers: {
        "User-Agent": "metaengine-desktop",
        Accept: "application/vnd.github+json",
        ...headers,
      },
      timeout: 15_000,
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => { body += c; if (body.length > 4 * 1024 * 1024) req.destroy(); });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

function parseSemver(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function gt(a: [number, number, number], b: [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

function pickAsset(assets: Array<{ name: string; browser_download_url: string; size: number }>): UpdateAsset | null {
  const plat = process.platform === "darwin" ? "mac" : process.platform; // linux | darwin→mac | win32
  const arch = process.arch; // x64 | arm64
  const pref = [`.${plat}.${arch}.`, `.${plat}.`, `-${plat}-`, `-${arch}.`];
  const sorted = [...assets].sort((a, b) => b.size - a.size);
  for (const p of pref) {
    const hit = sorted.find((a) => a.name.includes(p) && /\.(AppImage|exe|dmg|zip)$/i.test(a.name));
    if (hit) return { name: hit.name, url: hit.browser_download_url, size: hit.size };
  }
  return null;
}

export async function checkUpdate(current: string, token?: string): Promise<UpdateInfo> {
  try {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const { status, body } = await fetchJson(API_LATEST, headers);
    if (status !== 200) {
      return { ok: false, current, latest: null, updateAvailable: false, asset: null, error: `GitHub API ${status}` };
    }
    const rel = JSON.parse(body) as { tag_name?: string; assets?: Array<{ name: string; browser_download_url: string; size: number }> };
    const latest = rel.tag_name ?? null;
    const cur = parseSemver(current);
    const next = latest ? parseSemver(latest) : null;
    const updateAvailable = !!(cur && next && gt(next, cur));
    return {
      ok: true, current, latest, updateAvailable,
      asset: updateAvailable ? pickAsset(rel.assets ?? []) : null,
      error: updateAvailable && !cur ? "не удалось разобрать версию" : null,
    };
  } catch (e) {
    return { ok: false, current, latest: null, updateAvailable: false, asset: null, error: String(e).slice(0, 160) };
  }
}

/** Скачивание артефакта в staged-каталог. Возвращает путь файла. */
export function downloadUpdate(asset: UpdateAsset, stagedDir: string, token?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!existsSync(stagedDir)) mkdirSync(stagedDir, { recursive: true });
    const dest = path.join(stagedDir, asset.name);
    const headers: Record<string, string> = { "User-Agent": "metaengine-desktop", Accept: "application/octet-stream" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const req = get(asset.url, { headers, timeout: 60_000 }, (res) => {
      if ((res.statusCode ?? 500) >= 300) { reject(new Error(`HTTP ${res.statusCode} на ${asset.name}`)); return; }
      const out = createWriteStream(dest);
      res.pipe(out);
      out.on("finish", () => {
        out.close();
        try { chmodSync(dest, 0o755); } catch { /* windows не chmod'ит */ }
        resolve(dest);
      });
      out.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("timeout скачивания")));
    req.on("error", reject);
  });
}
