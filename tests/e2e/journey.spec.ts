import { expect, test } from '@playwright/test';
import { quickPrint, ready, state, until } from './helpers.ts';
import { correlation, grid, readDownload, sourceGrid, stdDev } from './png.ts';

test.describe('quick print journey', () => {
  test('open → choose negative → expose → develop → finish → download a real print', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await ready(page, '/?speed=8');
    await page.getByTestId('enter-quick').click();
    await until(page, "s.stage === 'enlarger'");

    // choose another negative, then back to the first
    await page.getByTestId('negative-pike-henry').click();
    await until(page, "s.selectedId === 'pike-henry' && !s.loading");
    await page.getByTestId('negative-tetons').click();
    await until(page, "s.selectedId === 'tetons' && !s.loading");
    expect(await state(page, "s.lamp.mode")).toBe('focus');

    // the exposure has not yet happened: no latent image exists
    expect(await state(page, 'S.finalDensity === null')).toBe(true);
    await page.getByTestId('expose').click();
    await until(page, "s.lamp.mode === 'expose'");
    await until(page, "s.locked && s.lamp.mode === 'off' && s.exposedSeconds > 0");
    // latent image: exposed, but the sheet still shows nothing (development off)
    expect(await state(page, "R.paper.uniforms.uDev.value.z")).toBe(0);

    await page.getByTestId('develop').click();
    await until(page, "s.stage === 'developing'");
    // development is progressive, not instant
    await until(page, 's.dev.clock > 2');
    const early = await state<number>(page, 's.devProgress');
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(0.6);
    await until(page, 's.devProgress >= 1');
    await page.getByTestId('stop-bath').click();
    await until(page, "s.stage === 'stop'");
    await until(page, "s.stage === 'finished'");
    expect(await state(page, 's.lightsOn')).toBe(true);
    // the print is lifted out and hung on the drying line
    await page.waitForFunction(() => window.__iris!.room!.debug().paperLocation === 'line', null, { timeout: 20_000 });

    // download the clean print
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download').click()]);
    const { lum } = await readDownload(dl);
    expect(Math.max(lum.width, lum.height)).toBe(2400);
    expect(lum.width / lum.height).toBeCloseTo(2000 / 1601, 2);
    expect(stdDev(lum)).toBeGreaterThan(30); // a real photograph, not a flat field
    // it is a positive print of the chosen photograph...
    const src = await sourceGrid(page, 'negatives/tetons.jpg', 24, 19);
    const print = grid(lum, 24, 19);
    expect(correlation(src, print)).toBeGreaterThan(0.85);
    // ...but processed through the paper, not the original file
    const meanAbs = src.reduce((a, v, i) => a + Math.abs(v - print[i]), 0) / src.length;
    expect(meanAbs).toBeGreaterThan(4);

    // bordered version: full 8×10 sheet with paper-white margins
    const [dlb] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-border').click()]);
    const bordered = (await readDownload(dlb)).lum;
    expect(bordered.width / bordered.height).toBeCloseTo(10 / 8, 2);
    expect(bordered.data[5 * bordered.width + 5]).toBeGreaterThan(250);

    // contact sheet holds the print
    await page.getByTestId('open-gallery').click();
    await expect(page.locator('.sheet__print')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.locator('.sheet').click({ position: { x: 5, y: 5 } });

    expect(errors).toEqual([]);
  });

  test('print again and try another negative reset the sheet but keep the session', async ({ page }) => {
    await ready(page, '/?speed=8&mode=quick');
    await quickPrint(page);
    await page.getByTestId('print-again').click();
    await until(page, "s.stage === 'enlarger' && !s.locked && s.paper === 'safe'");
    expect(await state(page, 'S.field.isExposed')).toBe(false);
    expect(await state(page, 's.prints.length')).toBe(1);
    await page.getByTestId('negative-herschel').click();
    await until(page, "s.selectedId === 'herschel' && !s.loading");
    // portrait negative → portrait sheet
    expect(await state(page, 'S.layout.sheetH > S.layout.sheetW')).toBe(true);
    await quickPrint(page);
    expect(await state(page, 's.prints.length')).toBe(2);
  });
});

test('the print travels developer → stop → fix → line without getting stuck', async ({ page }) => {
  await ready(page, '/?speed=2&mode=quick');
  await page.getByTestId('expose').click();
  await until(page, "s.locked && s.lamp.mode === 'off' && s.paper === 'easel'");
  await page.getByTestId('develop').click();
  await until(page, "s.devProgress >= 1");
  await page.getByTestId('stop-bath').click();
  for (const tray of ['stop', 'fix']) {
    await page.waitForFunction((t) => window.__iris!.room!.debug().paperLocation === t, tray, { timeout: 30_000 });
    // once released it settles, centred and flat, in that tray
    const expected = { stop: 0.52, fix: 0.98 }[tray]!;
    await page.waitForFunction(
      (x) => {
        const d = window.__iris!.room!.debug();
        const inTray = Math.abs(d.centroid.x - x) < 0.06;
        // the stop bath is brief; in the fixer the print must lie flat
        return x < 0.9 ? inTray : inTray && d.heightRange.max - d.heightRange.min < 0.01;
      },
      expected,
      { timeout: 10_000 },
    );
  }
  await page.waitForFunction(() => window.__iris!.room!.debug().paperLocation === 'line', null, { timeout: 30_000 });
  expect(await state(page, 'R.debug().recoveries')).toBe(0);
  expect(await state<number>(page, 'R.debug().maxStretch')).toBeLessThan(0.1);
});
