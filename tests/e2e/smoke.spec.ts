import { expect, test } from '@playwright/test';
import { ready, state } from './helpers.ts';

test('darkroom boots with a WebGL renderer', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ready(page, '/');
  await expect(page.getByRole('heading', { name: /IRIS/ })).toBeVisible();
  const info = await state<{ room: boolean; gl: string }>(page, "({ room: !!R, gl: R ? R.renderer.getContext().getParameter(R.renderer.getContext().VERSION) : '' })");
  expect(info.room).toBe(true);
  await page.waitForTimeout(3000);
  const fps = await state<number>(page, 'R.fps');
  console.log('GL', info.gl, 'fps', fps.toFixed(1));
  expect(errors).toEqual([]);
});
