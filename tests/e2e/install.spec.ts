import { expect, test } from '@playwright/test';

test('install help shows once in a Safari tab on iPhone, and never again after Got It', async ({ page }) => {
  await page.goto('/');
  const sheet = page.locator('#install-help');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Add to Home Screen');
  await expect(sheet).toContainText('Open as Web App');
  await page.getByRole('button', { name: 'Got It' }).click();
  await expect(sheet).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'PicKit' })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(sheet).toHaveCount(0);

  // Still reachable from the menu.
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Add to Home Screen' }).click();
  await expect(sheet).toBeVisible();
});

test('the manifest describes a standalone app with maskable icons', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m.display).toBe('standalone');
  expect(m.start_url).toBe('/');
  expect(m.scope).toBe('/');
  expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect(m.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
  for (const path of ['/icons/apple-touch-icon.png', '/splash/iphone-14-pro-light.png', '/splash/iphone-14-pro-dark.png']) {
    expect((await request.get(path)).ok()).toBe(true);
  }
});
