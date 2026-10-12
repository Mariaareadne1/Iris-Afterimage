import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { ready, state, until } from './helpers.ts';

/**
 * Visual walkthrough: captures every stage of a print for inspection.
 * Screenshots land in test-results/screens (and docs/screenshots when
 * SAVE_SCREENSHOTS=1). Runs near real time so the physics and camera settle.
 */
const OUT = process.env.SAVE_SCREENSHOTS ? 'docs/screenshots' : 'test-results/screens';

async function shot(page: Page, name: string) {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

test('visual walkthrough of a manual print', async ({ page }) => {
  test.setTimeout(240_000);
  await ready(page, '/?speed=1.5');
  await page.waitForTimeout(1500);
  await shot(page, '01-intro');

  await page.getByTestId('enter-manual').click();
  await until(page, "s.stage === 'enlarger'");
  await page.waitForTimeout(2200);
  await shot(page, '02-negative-selection');

  // throw it out of focus, then show it
  await page.evaluate(() => window.__iris!.session.setFocus(0.2));
  await page.waitForTimeout(1500);
  await shot(page, '03-enlarger-out-of-focus');
  await page.evaluate(() => window.__iris!.session.setFocus(0.5));

  // dodge the dark foreground during the exposure, using the real pointer
  await page.getByTestId('tool-dodge').click();
  await page.waitForTimeout(1800);
  const canvas = page.locator('canvas');
  const box = (await canvas.boundingBox())!;
  // find a screen point over the lower-left of the image area
  const target = await page.evaluate(() => {
    const R = window.__iris!.room!;
    const r = R.imageRectWorld();
    const THREE = (R.camera.position.constructor as unknown as { prototype: unknown });
    void THREE;
    const p = R.camera.position.clone().set(r.x - r.w * 0.26, 0.034, r.z + r.d * 0.28).project(R.camera);
    return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 };
  });
  await page.mouse.move(box.x + target.x * box.width, box.y + target.y * box.height);
  await page.waitForTimeout(300);
  expect(await state(page, 'S.toolPosition !== null')).toBe(true);
  await page.getByTestId('expose').click();
  await until(page, "s.lamp.mode === 'expose'");
  for (let i = 0; i < 20; i++) {
    await page.mouse.move(box.x + target.x * box.width + Math.cos(i) * 12, box.y + target.y * box.height + Math.sin(i) * 9);
    await page.waitForTimeout(60);
  }
  await shot(page, '04-dodging-during-exposure');
  await until(page, "s.lamp.mode === 'off'");
  await page.getByText('Hands').click();
  await page.waitForTimeout(1200);
  await shot(page, '05-latent-image');

  await page.getByTestId('develop').click();
  await until(page, "s.stage === 'developing'");
  await until(page, 's.dev.clock > 9');
  await shot(page, '06-early-development');
  await until(page, 's.dev.clock > 18');
  await shot(page, '07-mid-development');
  await until(page, 's.devProgress >= 1');
  await page.waitForTimeout(600);
  await shot(page, '08-fully-developed');

  await page.getByTestId('stop-bath').click();
  await until(page, "s.stage === 'fix'");
  await page.waitForTimeout(2600);
  await shot(page, '09-fixer');
  await until(page, "s.stage === 'finished'");
  await page.waitForTimeout(4000);
  await shot(page, '10-finished-print');

  await page.getByTestId('view-print').click();
  await expect(page.getByTestId('viewer-image')).toBeVisible({ timeout: 30_000 });
  // the image really decoded (not a broken-image placeholder), and stays decoded
  await page.waitForTimeout(1500);
  expect(await page.getByTestId('viewer-image').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 1000)).toBe(true);
  await page.waitForTimeout(500);
  await shot(page, '11-print-viewer');
});
