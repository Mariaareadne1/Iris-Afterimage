import { expect, test } from '@playwright/test';

test('embed mode: compact darkroom inside a portfolio page that still scrolls', async ({ page, baseURL }) => {
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#eee">
    <h1 style="height:500px;margin:0">My portfolio</h1>
    <iframe id="iris" src="${baseURL}/?embed=1&speed=8" style="width:900px;height:560px;border:0;display:block" title="Iris: Afterimage"></iframe>
    <div style="height:2000px"></div></body></html>`);
  const frame = page.frameLocator('#iris');
  await expect(frame.getByTestId('enter-quick')).toBeVisible({ timeout: 60_000 });
  // embed hides the long intro copy and the session extras
  await expect(frame.locator('.intro__lede')).toHaveCount(0);
  await frame.getByTestId('enter-quick').click();
  await expect(frame.getByTestId('expose')).toBeVisible();
  await expect(frame.getByTestId('open-gallery')).toHaveCount(0);
  await expect(frame.getByTestId('open-capture')).toHaveCount(0);
  await expect(frame.locator('.steps')).toBeHidden();

  // the parent page still scrolls, including with the wheel over the iframe
  const iframeBox = (await page.locator('#iris').boundingBox())!;
  await page.mouse.move(iframeBox.x + 450, iframeBox.y + 100);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
});
