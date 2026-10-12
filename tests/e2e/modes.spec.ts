import { expect, test } from '@playwright/test';
import { ready, state, until } from './helpers.ts';

test('switching between Quick Print and the manual darkroom keeps the print state', async ({ page }) => {
  await ready(page, '/?speed=6&mode=quick');
  await until(page, "s.stage === 'enlarger'");
  await expect(page.getByTestId('manual-controls')).toHaveCount(0);

  await page.getByTestId('mode-manual').click();
  await expect(page.getByTestId('manual-controls')).toBeVisible();
  await page.getByTestId('grade').fill('4');
  await page.getByTestId('time').fill('10');
  expect(await state(page, 's.settings.grade')).toBe(4);

  await page.getByTestId('mode-quick').click();
  await expect(page.getByTestId('manual-controls')).toHaveCount(0);
  // quick mode uses the same pipeline and the same settings
  expect(await state(page, 's.settings.grade')).toBe(4);
  expect(await state(page, 's.settings.time')).toBe(10);
  await expect(page.getByTestId('expose')).toContainText('10.0 s');

  await page.getByTestId('expose').click();
  await until(page, "s.locked && s.lamp.mode === 'off' && s.paper === 'easel'");
  await page.getByTestId('develop').click();
  await until(page, "s.stage === 'developing' && s.dev.clock > 3");
  const clock = await state<number>(page, 's.dev.clock');
  await page.getByTestId('mode-manual').click();
  expect(await state(page, 's.stage')).toBe('developing');
  expect(await state<number>(page, 's.dev.clock')).toBeGreaterThanOrEqual(clock);
  // manual mode may pull the print early
  await expect(page.getByTestId('stop-bath')).toBeVisible();
  await page.getByTestId('agitate').click();
  await page.waitForFunction(() => window.__iris!.session.state.dev.agitation > 0.05, null, { timeout: 10_000 });
});

test('keyboard: footswitch exposes and arrow keys move the dodger', async ({ page }) => {
  await ready(page, '/?speed=6&mode=manual');
  await until(page, "s.stage === 'enlarger'");
  await page.getByTestId('tool-dodge').click();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  const p = await state<{ u: number; v: number }>(page, 'S.toolPosition');
  expect(p.u).toBeLessThan(0.5);
  await page.keyboard.press('e');
  await until(page, "s.lamp.mode === 'expose'");
  await until(page, "s.lamp.mode === 'off' && s.locked");
  // the field recorded dodging at the keyboard position
  const ops = await state<number>(page, "S.field.ops.filter(o => o.kind === 'dodge').length");
  expect(ops).toBeGreaterThan(10);
  await page.keyboard.press('Escape');
  expect(await state(page, 's.tool')).toBe('none');
});
