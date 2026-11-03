/**
 * Builds tests/fixtures/gps-exif.jpg: the dusk test photo with a hand-made EXIF block carrying
 * a camera, an author, a date and a GPS position (51.5° N, 0.125° W), plus an XMP packet and
 * a comment. Used to prove PicKit finds and removes all of it.
 * Run: node scripts/make-exif-fixture.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../tests/fixtures/', import.meta.url));

/** Big-endian TIFF with IFD0, an EXIF IFD and a GPS IFD. */
export function buildExif() {
  const ascii = (s) => [...Buffer.from(s + '\0', 'latin1')];
  const rat = (n, d) => [n, d];
  const ifds = {
    ifd0: [
      [0x010f, 2, ascii('PicKit Test Co')],
      [0x0110, 2, ascii('Fixture Cam 1')],
      [0x0112, 3, [1]],
      [0x013b, 2, ascii('Jane Example')],
      [0x8769, 4, ['EXIF']],
      [0x8825, 4, ['GPS']],
    ],
    EXIF: [
      [0x829a, 5, [rat(1, 250)]],
      [0x829d, 5, [rat(18, 10)]],
      [0x8827, 3, [100]],
      [0x9003, 2, ascii('2026:10:01 12:34:56')],
    ],
    GPS: [
      [0x0001, 2, ascii('N')],
      [0x0002, 5, [rat(51, 1), rat(30, 1), rat(0, 1)]],
      [0x0003, 2, ascii('W')],
      [0x0004, 5, [rat(0, 1), rat(7, 1), rat(30, 1)]],
    ],
  };
  const size = { 2: 1, 3: 2, 4: 4, 5: 8 };
  const order = ['ifd0', 'EXIF', 'GPS'];
  // Lay out: header(8), then each IFD followed by its data.
  const offsets = {};
  let pos = 8;
  const layout = {};
  for (const name of order) {
    offsets[name] = pos;
    const entries = ifds[name];
    let dataPos = pos + 2 + entries.length * 12 + 4;
    layout[name] = entries.map(([tag, type, values]) => {
      const count = type === 2 ? values.length : values.length;
      const bytes = size[type] * count;
      const out = { tag, type, values, count, ptr: null };
      if (bytes > 4) {
        out.ptr = dataPos;
        dataPos += bytes + (bytes % 2);
      }
      return out;
    });
    pos = dataPos;
  }
  const buf = Buffer.alloc(pos);
  buf.write('MM', 0, 'latin1');
  buf.writeUInt16BE(42, 2);
  buf.writeUInt32BE(8, 4);
  const writeVal = (type, v, at) => {
    if (type === 2) buf.writeUInt8(v, at);
    else if (type === 3) buf.writeUInt16BE(v, at);
    else if (type === 4) buf.writeUInt32BE(typeof v === 'string' ? offsets[v] : v, at);
    else if (type === 5) {
      buf.writeUInt32BE(v[0], at);
      buf.writeUInt32BE(v[1], at + 4);
    }
  };
  for (const name of order) {
    let p = offsets[name];
    const entries = layout[name];
    buf.writeUInt16BE(entries.length, p);
    p += 2;
    for (const e of entries) {
      buf.writeUInt16BE(e.tag, p);
      buf.writeUInt16BE(e.type, p + 2);
      buf.writeUInt32BE(e.count, p + 4);
      const target = e.ptr ?? p + 8;
      if (e.ptr !== null) buf.writeUInt32BE(e.ptr, p + 8);
      e.values.forEach((v, i) => writeVal(e.type, v, target + i * size[e.type]));
      p += 12;
    }
    buf.writeUInt32BE(0, p);
  }
  return buf;
}

function segment(marker, payload) {
  const head = Buffer.alloc(4);
  head[0] = 0xff;
  head[1] = marker;
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

const jpeg = readFileSync(dir + 'dusk-portrait.jpg');
const app1 = segment(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), buildExif()]));
const xmp = segment(
  0xe1,
  Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><dc:creator>Jane Example</dc:creator></rdf:RDF></x:xmpmeta>', 'latin1'),
);
const com = segment(0xfe, Buffer.from('Taken at 1 Example Street', 'latin1'));
// Insert after SOI, keeping any JFIF APP0 first.
let at = 2;
if (jpeg[2] === 0xff && jpeg[3] === 0xe0) at = 4 + jpeg.readUInt16BE(4);
const out = Buffer.concat([jpeg.subarray(0, at), app1, xmp, com, jpeg.subarray(at)]);
writeFileSync(dir + 'gps-exif.jpg', out);
console.log('wrote gps-exif.jpg', out.length, 'bytes');
