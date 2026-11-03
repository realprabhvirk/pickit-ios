/**
 * Generates the test photos in tests/fixtures with Chromium's canvas, so they're reproducible
 * and carry no one's real pictures or metadata. Run: node scripts/make-fixtures.mjs
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../tests/fixtures/', import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage();

async function make(name, w, h, kind, type = 'image/jpeg') {
  const b64 = await page.evaluate(
    async ({ w, h, kind, type }) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const x = c.getContext('2d');
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      if (kind === 'dusk') {
        const g = x.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#1b2a4a');
        g.addColorStop(0.55, '#e0785a');
        g.addColorStop(1, '#2a1a2e');
        x.fillStyle = g;
        x.fillRect(0, 0, w, h);
        x.fillStyle = '#ffd27a';
        x.beginPath();
        x.arc(w * 0.68, h * 0.52, w * 0.09, 0, Math.PI * 2);
        x.fill();
        for (const [base, col] of [[0.62, '#3b2340'], [0.7, '#24152b'], [0.8, '#140c18']]) {
          x.fillStyle = col;
          x.beginPath();
          x.moveTo(0, h);
          let y = h * base;
          for (let i = 0; i <= 24; i++) {
            y += (rnd() - 0.5) * h * 0.05;
            x.lineTo((w * i) / 24, y);
          }
          x.lineTo(w, h);
          x.fill();
        }
      } else if (kind === 'snow') {
        const g = x.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#dfeefc');
        g.addColorStop(0.5, '#ffffff');
        g.addColorStop(1, '#eef3f7');
        x.fillStyle = g;
        x.fillRect(0, 0, w, h);
        x.fillStyle = '#c9d6e2';
        x.beginPath();
        x.moveTo(0, h * 0.7);
        x.lineTo(w * 0.35, h * 0.42);
        x.lineTo(w * 0.6, h * 0.6);
        x.lineTo(w * 0.8, h * 0.48);
        x.lineTo(w, h * 0.66);
        x.lineTo(w, h);
        x.lineTo(0, h);
        x.fill();
      } else {
        x.fillStyle = '#808080';
        x.fillRect(0, 0, w, h);
      }
      // Grain, so encoders and samplers see something photo-like (skipped for the big flat one).
      if (kind === 'gray') {
        const blob = await new Promise((r) => c.toBlob(r, type, 0.5));
        const buf = new Uint8Array(await blob.arrayBuffer());
        let s = '';
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return btoa(s);
      }
      const img = x.getImageData(0, 0, w, h);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = (rnd() - 0.5) * 18;
        img.data[i] += n;
        img.data[i + 1] += n;
        img.data[i + 2] += n;
      }
      x.putImageData(img, 0, 0);
      const blob = await new Promise((r) => c.toBlob(r, type, 0.86));
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    },
    { w, h, kind, type },
  );
  writeFileSync(out + name, Buffer.from(b64, 'base64'));
  console.log('wrote', name);
}

await make('dusk-portrait.jpg', 1500, 2000, 'dusk');
await make('snow-landscape.jpg', 2000, 1500, 'snow');
// 24 MP: over the 16.7 MP working limit, so it must be reduced (and say so).
await make('large-6000x4000.jpg', 6000, 4000, 'gray');
// A file that claims to be a JPEG but is cut off after the header.
const dusk = Buffer.from(await (await import('node:fs/promises')).readFile(out + 'dusk-portrait.jpg'));
writeFileSync(out + 'truncated.jpg', dusk.subarray(0, 600));
writeFileSync(out + 'not-an-image.jpg', Buffer.from('This is a text file pretending to be a photo.\n'));
await browser.close();
