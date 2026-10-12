import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { quickPrint, ready, state, until } from './helpers.ts';
import { readDownload } from './png.ts';

/** A synthetic photograph: sky gradient, a dark hill, a bright sun. */
function photo(width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const hill = y > height * (0.62 + 0.08 * Math.sin((x / width) * 6));
      const sun = Math.hypot(x - width * 0.7, y - height * 0.3) < Math.min(width, height) * 0.08;
      const v = sun ? 250 : hill ? 40 + (x % 7) * 3 : 120 + (y / height) * 80;
      png.data[i] = v;
      png.data[i + 1] = v * 0.95;
      png.data[i + 2] = v * 0.9;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png, { deflateLevel: 1 });
}

async function importFile(page: Page, name: string, mimeType: string, buffer: Buffer) {
  await page.getByTestId('import-input').setInputFiles({ name, mimeType, buffer });
}

test.describe('importing your own photograph', () => {
  test.beforeEach(async ({ page }) => {
    await ready(page, '/?speed=8&mode=quick');
    await until(page, "s.stage === 'enlarger'");
  });

  test('a portrait photograph prints on a portrait sheet and stays local', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(`${r.method()} ${r.url()}`));
    await importFile(page, 'my-portrait.png', 'image/png', photo(600, 900));
    await until(page, "s.selectedId && s.selectedId.startsWith('import-') && !s.loading");
    expect(await state(page, 'S.layout.sheetH > S.layout.sheetW')).toBe(true);
    await expect(page.getByTestId(/negative-import-/)).toBeVisible();
    await quickPrint(page);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download').click()]);
    const { lum } = await readDownload(dl);
    expect(lum.height).toBe(2400);
    expect(lum.width / lum.height).toBeCloseTo(600 / 900, 2);
    // the sun (bright in the photo) prints light; the hill prints dark
    const sun = lum.data[Math.round(lum.height * 0.3) * lum.width + Math.round(lum.width * 0.7)];
    const hill = lum.data[Math.round(lum.height * 0.9) * lum.width + Math.round(lum.width * 0.5)];
    expect(sun).toBeGreaterThan(hill + 80);
    // nothing was uploaded anywhere
    expect(requests.filter((r) => r.startsWith('POST') || r.startsWith('PUT'))).toEqual([]);
  });

  test('a landscape photograph prints on a landscape sheet', async ({ page }) => {
    await importFile(page, 'wide.png', 'image/png', photo(900, 500));
    await until(page, "s.selectedId && s.selectedId.startsWith('import-') && !s.loading");
    expect(await state(page, 'S.layout.sheetW > S.layout.sheetH')).toBe(true);
    expect(await state(page, 'S.layout.aspect')).toBeCloseTo(1.8, 2);
  });

  test('large images are scaled to a safe working size', async ({ page }) => {
    await importFile(page, 'huge.png', 'image/png', photo(4800, 3200));
    await until(page, "s.selectedId && s.selectedId.startsWith('import-') && !s.loading", 60_000);
    expect(await state(page, 'Math.max(S.negative.negative.width, S.negative.negative.height)')).toBe(2000);
  });

  test('a corrupt or unsupported file shows a friendly error and keeps the darkroom usable', async ({ page }) => {
    const before = await state<string>(page, 's.selectedId');
    await importFile(page, 'broken.png', 'image/png', Buffer.from('this is not really a png'));
    await expect(page.getByTestId('message')).toContainText('could not be read');
    await importFile(page, 'notes.txt', 'text/plain', Buffer.from('hello'));
    await expect(page.getByTestId('message')).toContainText('JPEG, PNG');
    expect(await state(page, 's.selectedId')).toBe(before);
    await expect(page.getByTestId('expose')).toBeEnabled();
  });
});
