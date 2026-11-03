/**
 * Fails the build if the output could reach anything other than its own origin: absolute URLs
 * in scripts, styles or HTML, external <script>/<link>, or protocol-relative references.
 * Known-harmless strings (XML namespaces, licence comments, dead code for other runtimes) are
 * allow-listed explicitly, so anything new has to be looked at.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist', import.meta.url));

const ALLOW = [
  /^http:\/\/www\.w3\.org\//, // SVG/XHTML/XLink namespaces
  /^https:\/\/localhost$/, // OxiPNG glue: only runs under Node or Cloudflare Workers, never in the app
  /^https?:\/\/(www\.)?apache\.org\/licenses\//, // licence headers
  /^https:\/\/github\.com\/(preactjs|GoogleChrome|GoogleChromeLabs|jamsinclair|mozilla|shssoichiro|emscripten-core)\b/, // source links in comments/licences
  /^https:\/\/goo\.gl\/[A-Za-z0-9]+$/, // Workbox error-message help links (text only)
  /^https:\/\/developer\.chrome\.com\/docs\/workbox\b/, // Workbox docs link in error text
  /^https:\/\/github\.com\/realprabhvirk\//, // our own repo links in About text
  /^https:\/\/chromium\.googlesource\.com\/webm\/libwebp$/, // licence list text
  /^https:\/\/bit\.ly\/wb-precache$/, // Workbox error-message text
  /^http:\/\/ns\.adobe\.com\/xap$/, // XMP signature the metadata stripper looks for inside photo bytes
  // "Resize for" preset citations from presets.json (copied as-is from PicKit for Windows).
  // Shown as text, never fetched.
  /^https:\/\/buffer\.com\/resources\/ideal-cover-photo-size\/$/,
  /^https:\/\/www\.lilachbullock\.com\/social-media-image-size-checker\/$/,
  /^https:\/\/support\.google\.com\/youtube\/answer\/72431$/,
  /^https:\/\/www\.constantcontact\.com\/blog\/social-media-image-sizes\/$/,
];

const TEXT = /\.(js|mjs|css|html|webmanifest|json|svg|txt)$/;
const URL_RE = /\b(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?(?:\/[^\s"'`)<>\\]*)?|https?:\/\/localhost\b/gi;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

const problems = [];
for (const file of walk(dist)) {
  if (!TEXT.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(URL_RE)) {
    let url = m[0];
    if (url.startsWith('//')) {
      // Protocol-relative only counts in markup attributes; in JS it's usually a comment marker.
      if (!file.endsWith('.html')) continue;
    }
    url = url.replace(/[.,;]+$/, '');
    if (ALLOW.some((re) => re.test(url))) continue;
    problems.push(`${relative(dist, file)}: ${url}`);
  }
  if (file.endsWith('.html')) {
    for (const m of text.matchAll(/<(script|link|img|iframe)\b[^>]*(src|href)="([^"]+)"/g)) {
      if (/^(https?:)?\/\//.test(m[3])) problems.push(`${relative(dist, file)}: external <${m[1]}> ${m[3]}`);
    }
  }
}

if (problems.length) {
  console.error('\nBundle audit failed: references to other origins found.\n');
  for (const p of [...new Set(problems)]) console.error('  ' + p);
  console.error('\nRemove them, or add a justified entry to ALLOW in scripts/audit-bundle.mjs.\n');
  process.exit(1);
}
console.log('Bundle audit passed: no references to other origins.');
