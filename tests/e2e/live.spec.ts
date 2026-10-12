import { expect, test } from '@playwright/test';
import { quickPrint, ready, until } from './helpers.ts';
import { readDownload, stdDev } from './png.ts';

/** Smoke-test a deployed copy: LIVE_URL=https://…/ npx playwright test live */
test('deployed site makes and exports a print', async ({ page }) => {
  const live = process.env.LIVE_URL;
  test.skip(!live, 'set LIVE_URL to test a deployment');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ready(page, `${live}?speed=8`);
  await expect(page).toHaveTitle(/Iris: Afterimage/);
  await page.getByTestId('enter-quick').click();
  await until(page, "s.stage === 'enlarger'");
  await quickPrint(page);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download').click()]);
  const { lum } = await readDownload(dl);
  expect(lum.width).toBe(2400);
  expect(stdDev(lum)).toBeGreaterThan(30);
  const og = await page.request.get(new URL('og.jpg', live).href);
  expect(og.ok()).toBe(true);
  expect(errors).toEqual([]);
});
