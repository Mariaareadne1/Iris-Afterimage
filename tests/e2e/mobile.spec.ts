import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { ready, until } from './helpers.ts';
import { readDownload } from './png.ts';

async function overlaps(a: Locator, b: Locator) {
  const ra = await a.boundingBox();
  const rb = await b.boundingBox();
  if (!ra || !rb) return false;
  return ra.x < rb.x + rb.width && rb.x < ra.x + ra.width && ra.y < rb.y + rb.height && rb.y < ra.y + ra.height;
}

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test('phone: a full quick print with taps, no overlapping controls', async ({ page }) => {
  mkdirSync('test-results/screens', { recursive: true });
  await ready(page, '/?speed=8');
  await page.screenshot({ path: 'test-results/screens/mobile-01-intro.png' });
  await noHorizontalOverflow(page);
  await page.getByTestId('enter-quick').tap();
  await until(page, "s.stage === 'enlarger'");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'test-results/screens/mobile-02-enlarger.png' });
  const strip = page.locator('.filmstrip');
  const panel = page.locator('.panel--enlarger');
  const topbar = page.locator('.topbar');
  expect(await overlaps(strip, panel)).toBe(false);
  expect(await overlaps(strip, topbar)).toBe(false);
  await expect(page.getByTestId('expose')).toBeInViewport();
  await noHorizontalOverflow(page);

  await page.getByTestId('expose').tap();
  await until(page, "s.locked && s.lamp.mode === 'off' && s.paper === 'easel'");
  await page.getByTestId('develop').tap();
  await until(page, "s.stage === 'developing'");
  await until(page, 's.devProgress > 0.4');
  await page.screenshot({ path: 'test-results/screens/mobile-03-developing.png' });
  await until(page, 's.devProgress >= 1');
  await page.getByTestId('stop-bath').tap();
  await until(page, "s.stage === 'finished'");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'test-results/screens/mobile-04-finished.png' });
  await expect(page.getByTestId('download')).toBeInViewport();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download').tap()]);
  expect((await readDownload(dl)).lum.width).toBe(2400);
});

test('phone: manual controls fit on screen', async ({ page }) => {
  await ready(page, '/?speed=8&mode=manual');
  await until(page, "s.stage === 'enlarger'");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'test-results/screens/mobile-05-manual.png' });
  const controls = page.getByTestId('manual-controls');
  await expect(controls).toBeVisible();
  expect(await overlaps(controls, page.locator('.panel--enlarger'))).toBe(false);
  await expect(page.getByTestId('expose')).toBeInViewport();
  await noHorizontalOverflow(page);
});

test('phone: dodging with a finger during the exposure', async ({ page }) => {
  await ready(page, '/?speed=2&mode=manual');
  await until(page, "s.stage === 'enlarger'");
  await page.getByTestId('tool-dodge').tap();
  await page.waitForFunction(() => window.__iris!.room!.cameraSettled, null, { timeout: 15_000 });
  const box = (await page.locator('.stage canvas').boundingBox())!;
  const p = await page.evaluate(() => window.__iris!.room!.imageUVToScreen(0.3, 0.6));
  const x = box.x + p.x * box.width;
  const y = box.y + p.y * box.height;
  await page.getByTestId('expose').tap();
  await until(page, "s.lamp.mode === 'expose'");
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: string, tx: number, ty: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: tx, y: ty, id: 1 }] });
  await touch('touchStart', x, y);
  for (let i = 0; i < 25; i++) {
    await touch('touchMove', x + Math.cos(i * 0.7) * 6, y + Math.sin(i * 0.7) * 5);
    await page.waitForTimeout(60);
  }
  const tp = await page.evaluate(() => window.__iris!.session.toolPosition);
  expect(tp).not.toBeNull();
  expect(Math.abs(tp!.u - 0.3)).toBeLessThan(0.05);
  await until(page, "s.lamp.mode === 'off'");
  await touch('touchEnd', x, y);
  // the finger's shadow held light back where it was, and only there
  const at = await page.evaluate(() => {
    const f = window.__iris!.session.field!;
    return { dodged: f.secondsAt(0.3, 0.6), far: f.secondsAt(0.85, 0.15), base: f.totalBaseSeconds };
  });
  expect(at.dodged).toBeLessThan(at.base - 1);
  expect(at.far).toBeCloseTo(at.base, 3);
  // lifting the finger puts the tool down
  expect(await page.evaluate(() => window.__iris!.session.toolPosition)).toBeNull();
});
