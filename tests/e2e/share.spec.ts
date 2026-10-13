import { expect, test } from '@playwright/test';
import { quickPrint, ready } from './helpers.ts';

test('Share hands the native share sheet a real PNG of the print', async ({ page }) => {
  await page.addInitScript(() => {
    const calls: { files: { name: string; type: string; size: number }[]; text?: string }[] = [];
    (window as unknown as { __shares: typeof calls }).__shares = calls;
    Object.defineProperty(navigator, 'canShare', { value: (d: ShareData) => !!d.files?.length, configurable: true });
    Object.defineProperty(navigator, 'share', {
      value: async (d: ShareData) => {
        calls.push({ files: (d.files ?? []).map((f) => ({ name: f.name, type: f.type, size: f.size })), text: d.text });
      },
      configurable: true,
    });
  });
  await ready(page, '/?speed=8&mode=quick');
  await quickPrint(page);
  await page.getByTestId('share').click();
  await page.waitForFunction(() => (window as unknown as { __shares: unknown[] }).__shares.length > 0, null, { timeout: 30_000 });
  const [call] = await page.evaluate(() => (window as unknown as { __shares: { files: { name: string; type: string; size: number }[]; text?: string }[] }).__shares);
  expect(call.files).toHaveLength(1);
  expect(call.files[0].type).toBe('image/png');
  expect(call.files[0].name).toMatch(/^iris-afterimage-tetons-.*\.png$/);
  expect(call.files[0].size).toBeGreaterThan(200_000);
  expect(call.text).toContain('darkroom');
});

test('without a share sheet, Share copies the link', async ({ page, context, baseURL }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  });
  await ready(page, '/?speed=8&mode=quick');
  await quickPrint(page);
  await page.getByTestId('share').click();
  await expect(page.getByTestId('share-status')).toContainText('Link copied');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain(new URL(baseURL!).host);
  expect(text).not.toContain('speed=');
});
