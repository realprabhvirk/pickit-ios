/**
 * Renders the app icon and iPhone 14 Pro launch images from src/assets/app-icon/icon.svg into
 * public/. Uses Playwright's Chromium. Run after changing the icon: npm run assets
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const svg = readFileSync(`${root}src/assets/app-icon/icon.svg`, 'utf8');
const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

const icons = [
  { file: 'public/icons/apple-touch-icon.png', size: 180 },
  { file: 'public/icons/icon-192.png', size: 192 },
  { file: 'public/icons/icon-512.png', size: 512 },
  { file: 'public/icons/icon-maskable-512.png', size: 512 },
];

// Launch images match the first screen without content (HIG): just its background.
const splashes = [
  { file: 'public/splash/iphone-14-pro-light.png', bg: '#FFFFFF' },
  { file: 'public/splash/iphone-14-pro-dark.png', bg: '#000000' },
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const { file, size } of icons) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0"><img src="${dataUrl}" width="${size}" height="${size}" style="display:block"></body></html>`);
  await page.waitForFunction(() => document.querySelector('img').complete);
  await page.screenshot({ path: `${root}${file}`, omitBackground: false });
  console.log('wrote', file);
}
for (const { file, bg } of splashes) {
  await page.setViewportSize({ width: 1179, height: 2556 });
  await page.setContent(`<html><body style="margin:0;background:${bg};width:1179px;height:2556px"></body></html>`);
  await page.screenshot({ path: `${root}${file}` });
  console.log('wrote', file);
}
await browser.close();
