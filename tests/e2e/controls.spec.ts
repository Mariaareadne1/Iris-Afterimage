import { expect, test, type Page } from '@playwright/test';
import { ready, state, until } from './helpers.ts';
import { correlation, developAndDownload, gradientEnergy, grid, pointAtImage, regionMean, stdDev, type Lum } from './png.ts';

/**
 * Every enlarger control must change the actual developed print, measured on
 * the exported PNG files (not the preview).
 */

async function freshSheet(page: Page) {
  const stage = await state<string>(page, 's.stage');
  if (stage === 'finished') await page.getByTestId('print-again').click();
  await until(page, "s.stage === 'enlarger' && !s.locked");
  await page.evaluate(() => {
    const S = window.__iris!.session;
    S.setFraming({ zoom: 1, offsetX: 0, offsetY: 0 });
    S.setFocus(0.5);
    S.setGrade(2.5);
    S.setTool('none');
  });
}

async function setRange(page: Page, testId: string, value: number) {
  await page.getByTestId(testId).fill(String(value));
}

async function exposeAndWait(page: Page) {
  await page.keyboard.press('e');
  await until(page, "s.lamp.mode === 'expose'");
  await until(page, "s.lamp.mode === 'off' && s.paper === 'easel'");
}

async function plainPrint(page: Page, time = 8): Promise<Lum> {
  await freshSheet(page);
  await setRange(page, 'time', time);
  await exposeAndWait(page);
  return developAndDownload(page);
}

test.describe('manual darkroom controls affect the developed print', () => {
  let baseline: Lum;

  test.beforeEach(async ({ page }) => {
    await ready(page, '/?speed=8&mode=manual');
    await until(page, "s.stage === 'enlarger'");
  });

  test('exposure time: longer is darker, shorter is lighter', async ({ page }) => {
    const short = await plainPrint(page, 3);
    const normal = await plainPrint(page, 8);
    const long = await plainPrint(page, 16);
    const m = (l: Lum) => regionMean(l, 0, 0, 1, 1);
    expect(m(long)).toBeLessThan(m(normal) - 15);
    expect(m(short)).toBeGreaterThan(m(normal) + 15);
    baseline = normal;
  });

  test('reset is reproducible: the same settings give the same print', async ({ page }) => {
    const a = await plainPrint(page, 8);
    const b = await plainPrint(page, 8);
    for (const [u, v] of [[0.2, 0.2], [0.5, 0.5], [0.8, 0.7]]) {
      expect(Math.abs(regionMean(a, u - 0.1, v - 0.1, u + 0.1, v + 0.1) - regionMean(b, u - 0.1, v - 0.1, u + 0.1, v + 0.1))).toBeLessThan(2.5);
    }
  });

  test('contrast grade steepens the tonal response', async ({ page }) => {
    await freshSheet(page);
    await setRange(page, 'grade', -0.5);
    await setRange(page, 'time', 8);
    await exposeAndWait(page);
    const soft = await developAndDownload(page);
    await freshSheet(page);
    await setRange(page, 'grade', 5);
    await setRange(page, 'time', 8);
    await exposeAndWait(page);
    const hard = await developAndDownload(page);
    expect(stdDev(hard)).toBeGreaterThan(stdDev(soft) + 12);
  });

  test('focus changes sharpness of the print', async ({ page }) => {
    await freshSheet(page);
    await setRange(page, 'focus', 0.12);
    expect(await state(page, 's.settings.focus')).toBeCloseTo(0.12, 2);
    await setRange(page, 'time', 8);
    await exposeAndWait(page);
    const soft = await developAndDownload(page);
    const sharp = await plainPrint(page, 8);
    expect(gradientEnergy(soft)).toBeLessThan(gradientEnergy(sharp) * 0.4);
  });

  test('crop: enlarging changes the composition in the output', async ({ page }) => {
    const full = await plainPrint(page, 8);
    await freshSheet(page);
    await setRange(page, 'zoom', 2);
    await setRange(page, 'time', 8);
    await exposeAndWait(page);
    const cropped = await developAndDownload(page);
    // the 2× print matches the centre of the full-frame print...
    const cells = 12;
    const fullCentre: number[] = [];
    for (let r = 0; r < cells; r++) for (let c = 0; c < cells; c++) {
      const u0 = 0.25 + (c / cells) * 0.5, v0 = 0.25 + (r / cells) * 0.5;
      fullCentre.push(regionMean(full, u0, v0, u0 + 0.5 / cells, v0 + 0.5 / cells));
    }
    expect(correlation(grid(cropped, cells, cells), fullCentre)).toBeGreaterThan(0.85);
    // ...and differs from the full frame
    expect(correlation(grid(cropped, cells, cells), grid(full, cells, cells))).toBeLessThan(0.8);
  });

  test('dodging lightens the shaded region only', async ({ page }) => {
    const plain = baseline ?? (await plainPrint(page, 8));
    await freshSheet(page);
    await setRange(page, 'time', 8);
    await page.getByTestId('tool-dodge').click();
    await pointAtImage(page, 0.25, 0.7);
    await exposeAndWait(page);
    await page.keyboard.press('Escape');
    const dodged = await developAndDownload(page);
    const inside = (l: Lum) => regionMean(l, 0.2, 0.65, 0.3, 0.75);
    const far = (l: Lum) => regionMean(l, 0.7, 0.15, 0.9, 0.35);
    expect(inside(dodged)).toBeGreaterThan(inside(plain) + 25);
    expect(Math.abs(far(dodged) - far(plain))).toBeLessThan(3);
  });

  test('burning darkens the burned region only', async ({ page }) => {
    const plain = baseline ?? (await plainPrint(page, 8));
    await freshSheet(page);
    await setRange(page, 'time', 8);
    await exposeAndWait(page);
    await page.getByTestId('tool-burn').click();
    await pointAtImage(page, 0.7, 0.25);
    await page.keyboard.press('b');
    await until(page, "s.lamp.mode === 'burn'");
    await until(page, "s.lamp.mode === 'off'");
    expect(await state<number>(page, 's.burnedSeconds')).toBeGreaterThan(3.5);
    await page.keyboard.press('Escape');
    const burned = await developAndDownload(page);
    const inside = (l: Lum) => regionMean(l, 0.65, 0.2, 0.75, 0.3);
    const far = (l: Lum) => regionMean(l, 0.1, 0.6, 0.3, 0.85);
    expect(inside(burned)).toBeLessThan(inside(plain) - 20);
    expect(Math.abs(far(burned) - far(plain))).toBeLessThan(3);
  });

  test('settings lock once the sheet is exposed; a new sheet unlocks them', async ({ page }) => {
    await freshSheet(page);
    await exposeAndWait(page);
    await expect(page.getByTestId('focus')).toBeDisabled();
    const before = await state<number>(page, 's.settings.grade');
    await page.evaluate(() => window.__iris!.session.setGrade(5));
    expect(await state(page, 's.settings.grade')).toBe(before);
    await page.getByTestId('new-sheet').click();
    await expect(page.getByTestId('focus')).toBeEnabled();
  });
});
