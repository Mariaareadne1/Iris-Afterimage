import { test } from '@playwright/test';
import { ready, until } from './helpers.ts';

/** Generates public/og-source.png (run with MAKE_OG=1); not part of the normal suite. */
test('open graph preview image', async ({ page }) => {
  test.skip(!process.env.MAKE_OG, 'set MAKE_OG=1 to regenerate the preview image');
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1200, height: 630 });
  await ready(page, '/?speed=2&mode=quick&capture=1');
  await until(page, "s.stage === 'enlarger'");
  await page.evaluate(() => window.__iris!.session.expose());
  await until(page, "s.locked && s.lamp.mode === 'off' && s.paper === 'easel'");
  await page.evaluate(() => window.__iris!.session.develop());
  await until(page, "s.stage === 'developing' && s.dev.clock > 26");
  await page.evaluate(() => (window.__iris!.session.speed = 0.0001));
  await page.addStyleTag({ content: '.capture-exit { display: none !important; }' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'public/og-source.png' });
});
