import { expect, test } from '@playwright/test';
import { canvasCentre, openApp, openImage, watchErrors } from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('opens a photo, draws it, and zooms with double-tap and the keyboard', async ({ page }) => {
  const errors = watchErrors(page);
  await openImage(page, 'dusk-portrait.jpg');
  const c = await canvasCentre(page);
  expect(c.r + c.g + c.b).toBeGreaterThan(30);

  const zoom = page.locator('.editor-zoom');
  await expect(zoom).toHaveText(/%$/);
  const fitted = await zoom.textContent();

  const box = (await page.locator('canvas.editor-canvas').boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.click(x, y);
  await page.mouse.click(x, y);
  await expect(zoom).not.toHaveText(fitted!, { timeout: 3000 });

  await page.locator('canvas.editor-canvas').focus();
  await page.keyboard.press('0');
  await expect(zoom).toHaveText(fitted!, { timeout: 3000 });
  await page.keyboard.press('1');
  await expect(zoom).toHaveText('100%', { timeout: 3000 });
  expect(errors).toEqual([]);
});

test('every tool opens its sheet from the toolbar and closes again', async ({ page }) => {
  await openImage(page, 'snow-landscape.jpg');
  for (const tool of ['Crop', 'Resize', 'Rotate', 'Markup', 'Privacy', 'Background', 'Compress', 'Resize For', 'Details']) {
    await page.getByRole('toolbar', { name: 'Editing tools' }).getByRole('button', { name: tool, exact: true }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button').first().click();
    await expect(sheet).toHaveCount(0);
  }
});

test('Details reports the real size and format', async ({ page }) => {
  await openImage(page, 'snow-landscape.jpg');
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Details' });
  await expect(sheet).toContainText('2000 × 1500');
  await expect(sheet).toContainText('JPEG');
  await expect(sheet).toContainText('full resolution');
});

test('a photo over the canvas budget is reduced, and the app says so', async ({ page }) => {
  await openImage(page, 'large-6000x4000.jpg');
  await expect(page.getByRole('status')).toContainText('Reduced to 16.7 MP for editing');
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Details' })).toContainText('6000 × 4000');
});

test('damaged and fake files fail with a clear message, not a hang', async ({ page }) => {
  for (const name of ['truncated.jpg', 'not-an-image.jpg']) {
    await page.locator('input[type=file]').setInputFiles(`tests/fixtures/${name}`);
    const alert = page.getByRole('alertdialog');
    await expect(alert).toBeVisible({ timeout: 25_000 });
    await expect(alert).toContainText("can't be opened");
    await alert.getByRole('button', { name: 'OK' }).click();
    await expect(alert).toHaveCount(0);
  }
  await expect(page.getByRole('heading', { name: 'PicKit' })).toBeVisible();
});

test('the back gesture closes the top layer instead of leaving the app', async ({ page }) => {
  await openImage(page, 'dusk-portrait.jpg');
  await page.getByRole('button', { name: 'Crop', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Close' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'PicKit' })).toBeVisible();
});
