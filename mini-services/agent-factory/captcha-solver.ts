/**
 * Aliyun slider-captcha solver — human-like fine-grained drag with live feedback.
 * Connects over CDP to the agent-browser chrome instance (session preserved).
 *
 * Notch detection:
 *   - fetch bg image as blob (avoids canvas taint)
 *   - luminance column profile in the middle band
 *   - strong edge PAIRS 30..60px apart score max -> notch left/right
 *   - cross-check with white-blob detection (hole renders light)
 * Drag:
 *   - pointer down at knob center
 *   - micro-steps 5-9px, 8-24ms, sine easing, y jitter  (-1.5..1.5)
 *   - initial distance guess from observed mapping ratio (~0.75 img-per-slider)
 *   - live correction loop: read piece strip center, residual -> adjust
 *   - settle 120-260ms, release
 */

import { chromium, type Browser, type Page } from "playwright-core";

const CDP_PORT_FILE =
  "/tmp/agent-browser-chrome-7dbac59e-d5c2-4e5c-a8e4-121a10827cc2/DevToolsActivePort";

export async function cdpEndpoint(): Promise<string> {
  const { readFileSync } = await import("node:fs");
  const port = readFileSync(CDP_PORT_FILE, "utf8").trim().split("\n")[0];
  return `http://127.0.0.1:${port}`;
}

export async function connectCdp(): Promise<{ browser: Browser; page: Page }> {
  const ep = await cdpEndpoint();
  const browser = await chromium.connectOverCDP(ep);
  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  const page =
    ctx.pages().find((p) => p.url().includes("chat.z.ai")) ??
    (await ctx.newPage());
  return { browser, page };
}

const IMG_PER_SLIDER = 0.75; // observed mapping ratio (piece px per slider px)

export interface SolveResult {
  ok: boolean;
  attempts: number;
  note: string;
}

export async function solveSliderCaptcha(
  page: Page,
  maxAttempts = 5,
): Promise<SolveResult> {
  const notes: string[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const r = await attemptOnce(page, attempt);
    notes.push(`#${attempt}:${r.note}`);
    if (r.ok) return { ok: true, attempts: attempt, note: notes.join("; ") };
    await page.waitForTimeout(1600 + Math.random() * 900);
  }
  return { ok: false, attempts: maxAttempts, note: notes.join("; ") };
}

async function attemptOnce(page: Page, attempt: number): Promise<SolveResult> {
  try {
    const geo = await measure(page);
    if (!geo) return { ok: false, attempts: attempt, note: "no dialog/geo" };

    await page.mouse.move(geo.knobX, geo.knobY, { steps: 6 });
    await page.waitForTimeout(200 + Math.random() * 220);
    await page.mouse.down();
    await page.waitForTimeout(90 + Math.random() * 130);

    const pieceCenter0 = geo.stripX0 + 26;
    const distTotal =
      (geo.targetScreenX - pieceCenter0) / (geo.ratio ?? IMG_PER_SLIDER);
    const steps = Math.max(20, Math.min(46, Math.round(distTotal / 6)));
    let curX = geo.knobX;
    let readCount = 0;
    let lastPieceX = pieceCenter0;

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      // accelerate then decelerate, aim slightly past (overshoot 3px)
      const eased =
        t < 0.5
          ? 2 * t * t
          : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad
      const targetX = geo.knobX + distTotal * eased;
      const dx = targetX - curX;
      const nSub = Math.max(1, Math.min(4, Math.round(Math.abs(dx) / 4)));
      for (let s = 0; s < nSub; s++) {
        curX += dx / nSub;
        const jy = (Math.random() - 0.5) * 2.4;
        await page.mouse.move(curX, geo.knobY + jy, { steps: 1 });
        await page.waitForTimeout(8 + Math.floor(Math.random() * 14));
      }
      if (i % 8 === 0) {
        const px = await readPieceCenterX(page);
        if (px != null) {
          lastPieceX = px;
          readCount++;
        }
      }
    }

    // live correction
    for (let c = 0; c < 8; c++) {
      const px = await readPieceCenterX(page);
      if (px != null) lastPieceX = px;
      const residual = geo.targetScreenX - lastPieceX;
      if (Math.abs(residual) <= 1.8) break;
      const sliderDx = Math.max(-16, Math.min(16, residual / (geo.ratio ?? IMG_PER_SLIDER)));
      if (Math.abs(sliderDx) < 0.8) break;
      curX += sliderDx;
      await page.mouse.move(curX, geo.knobY + (Math.random() - 0.5) * 1.2, {
        steps: 2,
      });
      await page.waitForTimeout(50 + Math.random() * 90);
    }

    await page.waitForTimeout(110 + Math.random() * 170);
    await page.mouse.up();
    await page.waitForTimeout(1300);

    const solved = await isSolved(page);
    return {
      ok: solved,
      attempts: attempt,
      note: solved
        ? `solved (reads=${readCount}, lastPiece=${Math.round(lastPieceX)}, target=${Math.round(geo.targetScreenX)})`
        : `rejected (lastPiece=${Math.round(lastPieceX)}, target=${Math.round(geo.targetScreenX)})`,
    };
  } catch (e) {
    return { ok: false, attempts: attempt, note: String(e).slice(0, 160) };
  }
}

// ---------- measurement ----------

interface Geo {
  knobX: number;
  knobY: number;
  stripX0: number; // piece strip screen x at drag start
  targetScreenX: number; // where piece center should go
  ratio?: number;
}

async function measure(page: Page): Promise<Geo | null> {
  return await page.evaluate(async () => {
    const knobEl = document.querySelector<HTMLElement>(".slider-move");
    const bg = document.querySelector<HTMLImageElement>("img.puzzle");
    const pieceImg = Array.from(document.querySelectorAll("img")).find((i) => {
      const r = i.getBoundingClientRect();
      return r.width > 40 && r.width < 60 && r.height > 100;
    });
    if (!knobEl || !bg || !pieceImg) return null;
    const kr = knobEl.getBoundingClientRect();
    const br = bg.getBoundingClientRect();
    const pr = pieceImg.getBoundingClientRect();

    let notchCenter = -1;
    let method = "none";
    try {
      const rr = await fetch(bg.src, { credentials: "omit" });
      const bl = await rr.blob();
      const url = URL.createObjectURL(bl);
      const im = new Image();
      await new Promise((res, rej) => {
        im.onload = res;
        im.onerror = rej;
        im.src = url;
      });
      const c = document.createElement("canvas");
      c.width = 300;
      c.height = 200;
      const g = c.getContext("2d");
      if (!g) return null;
      g.drawImage(im, 0, 0, 300, 200);
      const d = g.getImageData(0, 0, 300, 200).data;
      const lum = (x: number, y: number) => {
        const i = (y * 300 + x) * 4;
        return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      };

      // white-blob: hole renders light — find columns with high bright-pixel count
      const brightCols: { x: number; n: number }[] = [];
      for (let x = 100; x < 292; x++) {
        let n = 0;
        for (let y = 20; y < 196; y++) {
          const i = (y * 300 + x) * 4;
          const L = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          if (L > 205) n++;
        }
        if (n > 14) brightCols.push({ x, n });
      }
      // edge energy
      const colScore: { x: number; s: number }[] = [];
      for (let x = 96; x < 292; x++) {
        let s = 0;
        for (let y = 24; y < 196; y++) s += Math.abs(lum(x + 1, y) - lum(x, y));
        colScore.push({ x, s });
      }
      const top = [...colScore].sort((a, b) => b.s - a.s).slice(0, 14);
      // best pair 30..60 apart
      let bestPair: { a: number; b: number; score: number } | null = null;
      for (let i = 0; i < top.length; i++) {
        for (let j = i + 1; j < top.length; j++) {
          const gap = Math.abs(top[i].x - top[j].x);
          if (gap >= 30 && gap <= 60) {
            const score = top[i].s + top[j].s;
            if (!bestPair || score > bestPair.score)
              bestPair = { a: Math.min(top[i].x, top[j].x), b: Math.max(top[i].x, top[j].x), score };
          }
        }
      }
      if (brightCols.length > 8) {
        const bx0 = brightCols[0].x;
        const bx1 = brightCols[brightCols.length - 1].x;
        if (bx1 - bx0 >= 26 && bx1 - bx0 <= 66) {
          notchCenter = (bx0 + bx1) / 2;
          method = `white[${bx0}..${bx1}]`;
        }
      }
      if (notchCenter < 0 && bestPair) {
        notchCenter = (bestPair.a + bestPair.b) / 2;
        method = `edge[${bestPair.a},${bestPair.b}]`;
      }
      URL.revokeObjectURL(url);
    } catch {
      return null;
    }
    if (notchCenter < 0) return null;

    const scale = br.width / 300;
    const targetScreenX = br.x + notchCenter * scale;
    return {
      knobX: kr.x + kr.width / 2,
      knobY: kr.y + kr.height / 2,
      stripX0: pr.x,
      targetScreenX,
      method,
    } as Geo & { method: string };
  }) as Promise<Geo | null>;
}

async function readPieceCenterX(page: Page): Promise<number | null> {
  return await page.evaluate(() => {
    const pz = Array.from(document.querySelectorAll("img")).find((i) => {
      const r = i.getBoundingClientRect();
      return r.width > 40 && r.width < 60 && r.height > 100;
    });
    if (!pz) return null;
    const r = pz.getBoundingClientRect();
    return r.x + 26;
  });
}

async function isSolved(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    const win = document.querySelector(".window-show");
    if (!win) return true;
    return false;
  });
}
