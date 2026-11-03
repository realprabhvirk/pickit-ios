import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { canvasCentre, fixture, openApp, openImage, watchErrors } from './helpers';

const tool = (page: Page, name: string) => page.getByRole('toolbar', { name: 'Editing tools' }).getByRole('button', { name, exact: true }).click();
const apply = async (page: Page) => {
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
};
const closeSheet = async (page: Page) => {
  await page.getByRole('dialog').getByRole('button').first().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
};

async function drag(page: Page, x0: number, y0: number, x1: number, y1: number) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x0 + ((x1 - x0) * i) / 10, y0 + ((y1 - y0) * i) / 10);
  await page.mouse.up();
}

/** Opens Export, waits for the real file, and downloads it. */
async function exportFile(page: Page, format: 'JPEG' | 'PNG' | 'WebP', strip = true) {
  await page.getByRole('button', { name: 'Export or share' }).click();
  const sheet = page.getByRole('dialog', { name: 'Export' });
  await sheet.getByRole('radio', { name: format }).click();
  const sw = sheet.getByRole('switch', { name: 'Remove location and camera info' });
  if ((await sw.getAttribute('aria-checked')) !== String(strip)) await sw.click();
  await expect(sheet.locator('.estimate-size')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(600);
  await expect(sheet.locator('.estimate-size')).toBeVisible({ timeout: 60_000 });
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), sheet.getByRole('button', { name: 'Save' }).click()]);
  const path = await dl.path();
  await closeSheet(page);
  return { name: dl.suggestedFilename(), bytes: readFileSync(path!) };
}

/** Decodes bytes in the page and returns size and one pixel. */
async function inspect(page: Page, bytes: Buffer, type: string, at?: [number, number]) {
  return page.evaluate(
    async ({ b64, type, at }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bin], { type }));
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      const x = c.getContext('2d')!;
      x.drawImage(bmp, 0, 0);
      const px = at ? [...x.getImageData(Math.floor(bmp.width * at[0]), Math.floor(bmp.height * at[1]), 1, 1).data] : null;
      return { w: bmp.width, h: bmp.height, px };
    },
    { b64: bytes.toString('base64'), type, at },
  );
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('crop to a square, export as JPEG: a new file of the cropped size', async ({ page }) => {
  const errors = watchErrors(page);
  await openImage(page, 'dusk-portrait.jpg');
  await tool(page, 'Crop');
  await page.getByRole('radio', { name: 'Square' }).click();
  await apply(page);
  const out = await exportFile(page, 'JPEG');
  expect(out.name).toBe('dusk-portrait edited.jpg');
  expect(out.bytes[0]).toBe(0xff);
  expect(out.bytes[1]).toBe(0xd8);
  const info = await inspect(page, out.bytes, 'image/jpeg');
  expect([info.w, info.h]).toEqual([1500, 1500]);
  expect(errors).toEqual([]);
});

test('undo and redo walk through edits', async ({ page }) => {
  await openImage(page, 'snow-landscape.jpg');
  await tool(page, 'Rotate');
  await page.getByRole('button', { name: /Right/ }).click();
  await apply(page);
  await tool(page, 'Details');
  await expect(page.getByRole('dialog')).toContainText('1500 × 2000');
  await closeSheet(page);
  await page.getByRole('button', { name: 'Undo' }).click();
  await tool(page, 'Details');
  await expect(page.getByRole('dialog')).toContainText('2000 × 1500');
  await closeSheet(page);
  await page.getByRole('button', { name: 'Redo' }).click();
  await tool(page, 'Details');
  await expect(page.getByRole('dialog')).toContainText('1500 × 2000');
});

test('redaction replaces the pixels themselves, and survives export', async ({ page }) => {
  await openImage(page, 'snow-landscape.jpg');
  const before = await canvasCentre(page);
  expect(before.r + before.g + before.b).toBeGreaterThan(300);
  await tool(page, 'Privacy');
  await page.getByRole('radio', { name: 'Redact' }).click();
  const box = (await page.locator('canvas.editor-canvas').boundingBox())!;
  // The photo is fitted above the sheet; drag across its middle.
  const cx = box.x + box.width / 2;
  const top = await page.evaluate(() => document.querySelector('.editor-top')!.getBoundingClientRect().bottom);
  const sheetTop = await page.evaluate(() => document.querySelector('.sheet')!.getBoundingClientRect().top);
  const cy = (top + sheetTop) / 2;
  await drag(page, cx - 60, cy - 30, cx + 60, cy + 30);
  await page.waitForTimeout(800);
  await apply(page);
  const out = await exportFile(page, 'PNG');
  // Find the photo's centre relative to the drag: the fitted photo is centred in the same area.
  const info = await inspect(page, out.bytes, 'image/png', [0.5, 0.5]);
  expect([info.w, info.h]).toEqual([2000, 1500]);
  expect(info.px!.slice(0, 3).every((v) => v < 10)).toBe(true);
});

test('markup draws into the exported file', async ({ page }) => {
  await openImage(page, 'snow-landscape.jpg');
  await tool(page, 'Markup');
  await page.getByRole('radio', { name: 'Rectangle' }).click();
  const box = (await page.locator('canvas.editor-canvas').boundingBox())!;
  const top = await page.evaluate(() => document.querySelector('.editor-top')!.getBoundingClientRect().bottom);
  const sheetTop = await page.evaluate(() => document.querySelector('.sheet')!.getBoundingClientRect().top);
  await drag(page, box.x + 40, top + 30, box.x + box.width - 40, sheetTop - 30);
  await apply(page);
  const out = await exportFile(page, 'PNG');
  expect(out.bytes.length).toBeGreaterThan(1000);
});

test('location and camera details: shown, removed on export, and removable from the original', async ({ page }) => {
  await openImage(page, 'gps-exif.jpg');
  await tool(page, 'Details');
  const sheet = page.getByRole('dialog', { name: 'Details' });
  await expect(sheet).toContainText('51.50000° N');
  await expect(sheet).toContainText('Jane Example');
  await expect(sheet).toContainText('Fixture Cam');
  await sheet.getByRole('button', { name: 'Make a Copy Without Details' }).click();
  const shareBtn = sheet.getByRole('button', { name: /Share .*no details/ });
  await expect(shareBtn).toBeVisible();
  await expect(sheet).toContainText('isn’t recompressed');
  const [dl] = await Promise.all([page.waitForEvent('download'), shareBtn.click()]);
  const clean = readFileSync((await dl.path())!);
  expect(clean.includes(Buffer.from('Exif\0\0'))).toBe(false);
  expect(clean.includes(Buffer.from('Jane Example'))).toBe(false);
  await closeSheet(page);

  const stripped = await exportFile(page, 'JPEG', true);
  expect(stripped.bytes.includes(Buffer.from('Exif\0\0'))).toBe(false);
  const kept = await exportFile(page, 'JPEG', false);
  expect(kept.bytes.includes(Buffer.from('Exif\0\0'))).toBe(true);
  expect(kept.bytes.includes(Buffer.from('Fixture Cam'))).toBe(true);
});

test('compress to a target size fits under it', async ({ page }) => {
  await openImage(page, 'dusk-portrait.jpg');
  await tool(page, 'Compress');
  const sheet = page.getByRole('dialog', { name: 'Compress' });
  await sheet.getByRole('radio', { name: 'JPEG' }).click();
  await sheet.getByRole('radio', { name: '250 KB' }).click();
  await page.waitForTimeout(500);
  await expect(sheet.locator('.estimate-size')).toBeVisible({ timeout: 60_000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), sheet.getByRole('button', { name: 'Save' }).click()]);
  const bytes = readFileSync((await dl.path())!);
  expect(bytes.length).toBeLessThanOrEqual(250_000);
  expect(bytes.length).toBeGreaterThan(150_000);
});

test('several photos open side by side, each with its own edits', async ({ page }) => {
  await page.locator('input[type=file]').setInputFiles([fixture('dusk-portrait.jpg'), fixture('snow-landscape.jpg')]);
  await expect(page.getByRole('button', { name: /All photos, 2 open/ })).toBeVisible();
  await tool(page, 'Rotate');
  await page.getByRole('button', { name: /Right/ }).click();
  await apply(page);
  await page.getByRole('button', { name: /All photos/ }).click();
  await page.getByRole('button', { name: /Edit snow-landscape/ }).click();
  await expect(page.locator('.editor-name-text')).toHaveText('snow-landscape.jpg');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

test('batch: compress two photos and save them as a ZIP', async ({ page }) => {
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Batch' }).click();
  await page.locator('#batch input[type=file]').setInputFiles([fixture('dusk-portrait.jpg'), fixture('snow-landscape.jpg')]);
  await expect(page.locator('.batch-row')).toHaveCount(2);
  await page.getByRole('button', { name: 'Compress 2 Photos' }).click();
  await expect(page.getByText('Done', { exact: true })).toBeVisible({ timeout: 60_000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save as ZIP' }).click()]);
  const zip = readFileSync((await dl.path())!);
  expect(zip.readUInt32LE(0)).toBe(0x04034b50);
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(zip.readUInt16LE(end + 10)).toBe(2);
  // Undo puts the settings back and discards the results.
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: 'Compress 2 Photos' })).toBeVisible();
});

test('batch rename previews names and flags clashes', async ({ page }) => {
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Batch' }).click();
  await page.locator('#batch input[type=file]').setInputFiles([fixture('dusk-portrait.jpg'), fixture('snow-landscape.jpg')]);
  await page.getByRole('radio', { name: 'Rename' }).click();
  await page.getByRole('button', { name: 'Photo {number}' }).click();
  await expect(page.locator('.batch-row').first()).toContainText('Photo 001.jpg');
  await page.getByRole('textbox', { name: 'Name pattern' }).fill('same');
  await expect(page.getByText('Some names have problems')).toBeVisible();
});

test('edits survive the app being closed: Resume brings them back', async ({ page }) => {
  await openImage(page, 'dusk-portrait.jpg');
  await tool(page, 'Crop');
  await page.getByRole('radio', { name: 'Square' }).click();
  await apply(page);
  await page.waitForTimeout(2500); // autosave settles
  await page.reload();
  await expect(page.locator('#resume')).toBeVisible({ timeout: 10_000 });
  await page.locator('#resume').click();
  await expect(page.locator('.editor-name-text')).toHaveText('dusk-portrait.jpg');
  await tool(page, 'Details');
  await expect(page.getByRole('dialog')).toContainText('1500 × 1500');
});
