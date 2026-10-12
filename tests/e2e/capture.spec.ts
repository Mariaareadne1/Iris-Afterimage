import { expect, test } from '@playwright/test';
import { ready, until } from './helpers.ts';

test('records the darkroom canvas to a video file in a supported container', async ({ page }) => {
  await ready(page, '/?speed=4&mode=quick');
  await until(page, "s.stage === 'enlarger'");
  const mime = await page.evaluate(() => {
    const c = ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    return c.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
  });
  test.skip(!mime, 'MediaRecorder not supported');
  await page.getByTestId('open-capture').click();
  await page.getByTestId('record').click();
  await page.waitForTimeout(2000);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('record').click()]);
  const ext = mime!.startsWith('video/mp4') ? 'mp4' : 'webm';
  expect(dl.suggestedFilename().endsWith(`.${ext}`)).toBe(true);
  const path = await dl.path();
  const { statSync } = await import('node:fs');
  expect(statSync(path!).size).toBeGreaterThan(5_000);
});

test('the automated showcase drives the real workflow to a finished print', async ({ page }) => {
  test.setTimeout(240_000);
  await ready(page, '/?speed=3');
  await page.getByTestId('enter-quick').click();
  await page.getByTestId('open-capture').click();
  await page.getByTestId('showcase').click();
  // interface chrome is hidden during capture
  await expect(page.locator('.app--clean')).toHaveCount(1);
  await until(page, "s.stage === 'developing'", 120_000);
  await until(page, "s.stage === 'finished'", 180_000);
  const ops = await page.evaluate(() => window.__iris!.session.state.prints[0].field.ops.filter((o) => o.kind === 'dodge').length);
  expect(ops).toBeGreaterThan(5); // the showcase dodged during its exposure
  await expect(page.locator('.app--clean')).toHaveCount(0, { timeout: 20_000 });
});
