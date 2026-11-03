import { expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

/** Collects console errors, page errors and CSP violations. */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (/Content Security Policy|Refused to/i.test(m.text())) errors.push(`CSP: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

/** Loads the app as a returning visitor: the one-time install help is already dismissed. */
export async function openApp(page: Page, query = '?sim=iphone-14-pro') {
  await page.goto(`/${query}`);
  // In a Safari-tab context the install help appears once, shortly after launch.
  const help = page.locator('#install-help');
  const shown = await help.waitFor({ state: 'visible', timeout: 4000 }).then(
    () => true,
    () => false,
  );
  if (shown) {
    await page.getByRole('button', { name: 'Got It' }).click();
    await expect(help).toHaveCount(0);
  }
  await expect(page.getByRole('heading', { name: 'PicKit' })).toBeVisible();
}

/** Waits until the service worker controls the page. */
export async function waitForServiceWorker(page: Page) {
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 30_000 });
}

export async function openImage(page: Page, name: string) {
  await page.locator('input[type=file]').setInputFiles(fixture(name));
  await expect(page.locator('canvas.editor-canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();
}

/** Average of the middle of the photo canvas, to prove it actually drew. */
export async function canvasCentre(page: Page) {
  return page.locator('canvas.editor-canvas').evaluate((c: HTMLCanvasElement) => {
    const probe = document.createElement('canvas');
    probe.width = 8;
    probe.height = 8;
    const ctx = probe.getContext('2d')!;
    ctx.drawImage(c, c.width / 2 - 4, c.height / 2 - 4, 8, 8, 0, 0, 8, 8);
    const d = ctx.getImageData(0, 0, 8, 8).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    return { r: r / n, g: g / n, b: b / n };
  });
}
