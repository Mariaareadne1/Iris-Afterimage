import { expect, test } from '@playwright/test';
import { mkdirSync, copyFileSync, statSync } from 'node:fs';
import { ready } from './helpers.ts';

/**
 * Records the automated showcase to captures/ (run with MAKE_DEMO=1).
 * Uses the app's own canvas recorder, so the video is exactly what a visitor
 * would capture: real-time, interface hidden.
 */
test('record the showcase demo video', async ({ page }) => {
  test.skip(!process.env.MAKE_DEMO, 'set MAKE_DEMO=1 to record the demo video');
  test.setTimeout(300_000);
  const size = process.env.DEMO_SIZE === 'square' ? { width: 1080, height: 1080 } : { width: 1280, height: 720 };
  await page.setViewportSize(size);
  await ready(page, '/?speed=1');
  await page.getByTestId('enter-manual').click();
  await page.waitForTimeout(1500);
  await page.getByTestId('open-capture').click();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 240_000 }),
    page.getByTestId('showcase-record').click(),
  ]);
  mkdirSync('captures', { recursive: true });
  const ext = download.suggestedFilename().split('.').pop();
  const out = `captures/iris-afterimage-demo-${process.env.DEMO_SIZE === 'square' ? '1x1' : '16x9'}.${ext}`;
  copyFileSync((await download.path())!, out);
  expect(statSync(out).size).toBeGreaterThan(500_000);
  console.log('saved', out, statSync(out).size);
});
