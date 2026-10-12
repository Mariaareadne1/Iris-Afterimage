import { expect, test } from '@playwright/test';
import { quickPrint, ready } from './helpers.ts';
import { readDownload, stdDev } from './png.ts';

test.use({ launchOptions: { args: ['--disable-webgl', '--disable-webgl2', '--disable-3d-apis'] } });

test('without WebGL the flat darkroom still makes a real print', async ({ page }) => {
  await ready(page, '/?speed=8');
  await expect(page.locator('.fallback__note')).toBeVisible();
  await page.getByTestId('enter-quick').click();
  await expect(page.locator('.fallback__canvas')).toBeVisible();
  await quickPrint(page);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download').click()]);
  const { lum } = await readDownload(dl);
  expect(stdDev(lum)).toBeGreaterThan(30);
});
