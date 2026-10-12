import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { expect, type Download, type Page } from '@playwright/test';
import { state, until } from './helpers.ts';

/** Decoded greyscale image (0..255 luminance) from a downloaded PNG. */
export interface Lum {
  width: number;
  height: number;
  data: Float32Array;
}

export async function readDownload(download: Download): Promise<{ lum: Lum; bytes: Buffer; png: PNG }> {
  const path = await download.path();
  if (!path) throw new Error('download has no path');
  const bytes = readFileSync(path);
  // a real PNG signature, decodable by a standard decoder
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  const png = PNG.sync.read(bytes);
  const data = new Float32Array(png.width * png.height);
  for (let i = 0; i < data.length; i++) {
    data[i] = 0.2126 * png.data[i * 4] + 0.7152 * png.data[i * 4 + 1] + 0.0722 * png.data[i * 4 + 2];
  }
  return { lum: { width: png.width, height: png.height, data }, bytes, png };
}

export function regionMean(img: Lum, u0: number, v0: number, u1: number, v1: number): number {
  const x0 = Math.floor(u0 * img.width), x1 = Math.ceil(u1 * img.width);
  const y0 = Math.floor(v0 * img.height), y1 = Math.ceil(v1 * img.height);
  let s = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += img.data[y * img.width + x]; n++; }
  return s / n;
}

export function stdDev(img: Lum): number {
  let m = 0;
  for (const v of img.data) m += v;
  m /= img.data.length;
  let s = 0;
  for (const v of img.data) s += (v - m) * (v - m);
  return Math.sqrt(s / img.data.length);
}

/** Mean squared gradient — falls as an image gets blurrier. */
export function gradientEnergy(img: Lum): number {
  let s = 0, n = 0;
  const { width: w, height: h, data: d } = img;
  for (let y = 0; y < h - 1; y += 2) for (let x = 0; x < w - 1; x += 2) {
    const i = y * w + x;
    s += (d[i + 1] - d[i]) ** 2 + (d[i + w] - d[i]) ** 2;
    n++;
  }
  return s / n;
}

/** Downsample to a grid of cell means (for correlation). */
export function grid(img: Lum, cols: number, rows: number): number[] {
  const out: number[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push(regionMean(img, c / cols, r / rows, (c + 1) / cols, (r + 1) / rows));
  return out;
}

export function correlation(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

/** Luminance grid of a bundled source photograph, computed in the page. */
export async function sourceGrid(page: Page, url: string, cols: number, rows: number): Promise<number[]> {
  return page.evaluate(async ([u, c, r]) => {
    const img = await createImageBitmap(await (await fetch(u as string)).blob());
    const cv = document.createElement('canvas');
    cv.width = c as number;
    cv.height = r as number;
    const ctx = cv.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c as number, r as number);
    const d = ctx.getImageData(0, 0, c as number, r as number).data;
    const out: number[] = [];
    for (let i = 0; i < d.length; i += 4) out.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
    return out;
  }, [url, cols, rows] as const);
}

/** Develop the exposed sheet to completion through the UI and download the clean print. */
export async function developAndDownload(page: Page, border = false): Promise<Lum> {
  await page.getByTestId('develop').click();
  await until(page, "s.stage === 'developing'");
  await until(page, 's.devProgress >= 1');
  await page.getByTestId('stop-bath').click();
  await until(page, "s.stage === 'finished'");
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId(border ? 'download-border' : 'download').click()]);
  expect(download.suggestedFilename()).toMatch(/^iris-afterimage-.*\.png$/);
  return (await readDownload(download)).lum;
}

/** Move the real mouse over a point of the image area on the easel. */
export async function pointAtImage(page: Page, u: number, v: number) {
  await page.waitForFunction(() => window.__iris!.room!.cameraSettled, null, { timeout: 15_000 });
  const box = (await page.locator('.stage canvas').boundingBox())!;
  const p = await page.evaluate(([uu, vv]) => window.__iris!.room!.imageUVToScreen(uu, vv), [u, v] as const);
  await page.mouse.move(box.x + p.x * box.width, box.y + p.y * box.height);
  await page.waitForFunction(() => window.__iris!.session.toolPosition !== null, null, { timeout: 5_000 });
  const tp = await state<{ u: number; v: number }>(page, 'S.toolPosition');
  expect(Math.abs(tp.u - u)).toBeLessThan(0.03);
  expect(Math.abs(tp.v - v)).toBeLessThan(0.03);
}
