import { expect, test } from '@playwright/test';
import { canvasCentre, openApp, openImage, waitForServiceWorker, watchErrors } from './helpers';

test('installs the service worker, verifies the precache, and works fully offline', async ({ page, context }) => {
  const errors = watchErrors(page);
  await openApp(page);
  await waitForServiceWorker(page);

  // Settings > Ready Offline checks the cache contents and runs every WASM encoder.
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(page.locator('#row-offline')).toContainText('Ready', { timeout: 30_000 });
  await page.locator('#row-offline').click();
  await expect(page.locator('#offline-ready')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#codecs-ok')).toHaveCount(1, { timeout: 30_000 });

  // Airplane mode, then a full reload: everything must come from the cache.
  await context.setOffline(true);
  await page.goto('/?sim=iphone-14-pro');
  await expect(page.getByRole('heading', { name: 'PicKit' })).toBeVisible();

  await openImage(page, 'dusk-portrait.jpg');
  const c = await canvasCentre(page);
  expect(c.r + c.g + c.b).toBeGreaterThan(30);

  // The encoders still load and run with no network.
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.locator('#row-offline').click();
  await expect(page.locator('#offline-ready')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#codecs-ok')).toHaveCount(1, { timeout: 30_000 });

  await context.setOffline(false);
  expect(errors).toEqual([]);
});
