import { expect, type Page } from '@playwright/test';

/** Wait until the session has loaded its first negative. */
export async function ready(page: Page, path = '/?speed=6') {
  await page.goto(path);
  await page.waitForFunction(() => {
    const i = window.__iris;
    return !!i && i.session.state.negatives.length > 0 && !i.session.state.loading && !!i.session.negative;
  }, null, { timeout: 60_000 });
}

/** Poll a predicate over session state (serialised function source). */
export async function until(page: Page, predicate: string, timeout = 90_000) {
  await page.waitForFunction(`(() => { const s = window.__iris.session.state; return (${predicate}); })()`, null, { timeout, polling: 100 });
}

export async function state<T = unknown>(page: Page, expr: string): Promise<T> {
  return page.evaluate(`(() => { const s = window.__iris.session.state; const S = window.__iris.session; const R = window.__iris.room; return (${expr}); })()`) as Promise<T>;
}

/** Run the full quick-print flow through the UI. */
export async function quickPrint(page: Page) {
  await page.getByTestId('expose').click();
  await until(page, "s.locked && s.lamp.mode === 'off' && s.paper === 'easel' && s.exposedSeconds > 0");
  await page.getByTestId('develop').click();
  await until(page, "s.stage === 'developing'");
  await until(page, 's.devProgress >= 1');
  await page.getByTestId('stop-bath').click();
  await until(page, "s.stage === 'finished'");
  await expect(page.getByTestId('download')).toBeVisible();
}
