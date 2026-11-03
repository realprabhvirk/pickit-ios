import { test } from '@playwright/test';
import { openApp, openImage } from './helpers';

/**
 * 393 x 852 @3x screenshots in light and dark for visual review. Saved under
 * test-results/screenshots/<project>/. Not a pixel diff: Linux browsers don't render SF Pro or
 * iOS glass, so they're for layout review only.
 */
for (const scheme of ['light', 'dark'] as const) {
  test(`screens in ${scheme} mode`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme });
    const dir = `test-results/screenshots/${info.project.name}`;
    await openApp(page);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/${scheme}-1-picker.png` });
    await page.getByRole('button', { name: 'More' }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${dir}/${scheme}-2-menu.png` });
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${dir}/${scheme}-3-settings.png` });
    await page.goBack();
    await page.waitForTimeout(700);
    await openImage(page, 'dusk-portrait.jpg');
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${dir}/${scheme}-4-editor.png` });
    await page.getByRole('button', { name: 'Markup', exact: true }).click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${dir}/${scheme}-5-tool-sheet.png` });
  });
}
