import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { openApp, openImage, waitForServiceWorker, watchErrors } from './helpers';

/**
 * Privacy, verified: through a full session the app requests nothing from any other origin.
 * Fails the run if it ever does.
 */
test('makes no request to any other origin', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const foreign: string[] = [];
  const watch = (url: string) => {
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    if (new URL(url).origin !== origin) foreign.push(url);
  };
  page.on('request', (r) => watch(r.url()));
  page.context().on('request', (r) => watch(r.url()));
  const errors = watchErrors(page);

  await openApp(page);
  await waitForServiceWorker(page);
  await openImage(page, 'snow-landscape.jpg');
  for (const tool of ['Crop', 'Compress', 'Resize For', 'Details']) {
    await page.getByRole('button', { name: tool, exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button').first().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.locator('#row-offline').click();
  await expect(page.locator('#codecs-ok')).toHaveCount(1, { timeout: 30_000 });

  expect(foreign).toEqual([]);
  expect(errors).toEqual([]);
});

test('ships a strict Content Security Policy', async ({ page }) => {
  await page.goto('/');
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("connect-src 'self'");
  expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(csp).not.toMatch(/\s'unsafe-eval'/);
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);

  // Cloudflare serves the same policy as a header, plus frame-ancestors.
  const headers = readFileSync('public/_headers', 'utf8');
  const header = headers.match(/Content-Security-Policy: (.+)/)![1].trim();
  expect(header.replace(" frame-ancestors 'none';", '')).toBe(csp);
  expect(header).toContain("frame-ancestors 'none'");
});
