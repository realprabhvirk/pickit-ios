import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { crc32, extractUprightExif, insertJpegSegment, readMetadata, stripMetadata } from '../../src/engine/metadata';

const fixture = (n: string) => new Uint8Array(readFileSync(new URL(`../fixtures/${n}`, import.meta.url)));
const has = (b: Uint8Array, s: string) => Buffer.from(b).includes(Buffer.from(s, 'latin1'));

function pngChunk(type: string, data: Uint8Array) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out, 4, 8 + data.length), 8 + data.length);
  return out;
}

function tinyPng(extra: Buffer[]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = deflateSync(Buffer.from([0, 255, 0, 0, 255]));
  return new Uint8Array(
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), ...extra, pngChunk('IDAT', idat), pngChunk('IEND', new Uint8Array())]),
  );
}

describe('reading metadata', () => {
  it('finds camera, author, date, exposure and location in EXIF', () => {
    const m = readMetadata(fixture('gps-exif.jpg'));
    expect(m.hasExif).toBe(true);
    expect(m.camera).toBe('PicKit Test Co Fixture Cam 1');
    expect(m.author).toBe('Jane Example');
    expect(m.taken).toBe('2026:10:01 12:34:56');
    expect(m.exposure).toContain('ƒ/1.8');
    expect(m.exposure).toContain('1/250 s');
    expect(m.location!.lat).toBeCloseTo(51.5, 6);
    expect(m.location!.lon).toBeCloseTo(-0.125, 6);
    expect(m.hasXmp).toBe(true);
    expect(m.hasComment).toBe(true);
    expect(m.hasPrivateInfo).toBe(true);
  });

  it('reports nothing private for a clean file', () => {
    const m = readMetadata(fixture('dusk-portrait.jpg'));
    expect(m.location).toBeUndefined();
    expect(m.hasPrivateInfo).toBe(false);
  });

  it('never throws on damaged or random data', () => {
    expect(() => readMetadata(fixture('truncated.jpg'))).not.toThrow();
    expect(() => readMetadata(fixture('not-an-image.jpg'))).not.toThrow();
    const gps = fixture('gps-exif.jpg');
    let seed = 1;
    for (let i = 0; i < 300; i++) {
      const b = gps.slice(0, 2048);
      for (let k = 0; k < 20; k++) b[(seed = (seed * 16807) % 2147483647) % b.length] = seed & 0xff;
      expect(() => readMetadata(b)).not.toThrow();
    }
  });
});

describe('removing metadata without recompressing', () => {
  it('strips EXIF, XMP and comments from a JPEG and keeps the picture bytes', () => {
    const src = fixture('gps-exif.jpg');
    const out = stripMetadata(src)!;
    expect(out).not.toBeNull();
    expect(has(out, 'Exif\0\0')).toBe(false);
    expect(has(out, 'xmpmeta')).toBe(false);
    expect(has(out, 'Example Street')).toBe(false);
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xd8);
    expect(out[out.length - 2]).toBe(0xff);
    expect(out[out.length - 1]).toBe(0xd9);
    // The compressed image is untouched: the clean file's scan data matches the original's tail.
    const clean = fixture('dusk-portrait.jpg');
    const tail = (b: Uint8Array) => Buffer.from(b.subarray(b.length - 4096)).toString('hex');
    expect(tail(out)).toBe(tail(clean));
    expect(readMetadata(out).hasPrivateInfo).toBe(false);
  });

  it('declines a damaged JPEG rather than half-cleaning it', () => {
    expect(stripMetadata(fixture('truncated.jpg'))).toBeNull();
    expect(stripMetadata(fixture('not-an-image.jpg'))).toBeNull();
  });

  it('strips eXIf and text chunks from a PNG, keeping verified image chunks', () => {
    const exif = Buffer.concat([Buffer.from('MM\0*\0\0\0\x08', 'latin1'), Buffer.alloc(8)]);
    const png = tinyPng([pngChunk('eXIf', exif), pngChunk('tEXt', Buffer.from('Author\0Jane', 'latin1'))]);
    const out = stripMetadata(png)!;
    expect(out).not.toBeNull();
    expect(has(out, 'eXIf')).toBe(false);
    expect(has(out, 'tEXt')).toBe(false);
    expect(has(out, 'IDAT')).toBe(true);
    expect(has(out, 'IEND')).toBe(true);
  });

  it('refuses a PNG whose kept chunk fails its checksum', () => {
    const png = tinyPng([]);
    const bad = png.slice();
    bad[33 + 8] ^= 0xff; // inside IDAT data
    expect(stripMetadata(bad)).toBeNull();
  });

  it('strips EXIF and XMP chunks from a WebP and clears the flags', () => {
    const chunk = (type: string, data: Buffer) => {
      const head = Buffer.alloc(8);
      head.write(type, 0, 'latin1');
      head.writeUInt32LE(data.length, 4);
      return Buffer.concat([head, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
    };
    const vp8x = Buffer.alloc(10);
    vp8x[0] = 0x08 | 0x04;
    const body = Buffer.concat([
      Buffer.from('WEBP', 'latin1'),
      chunk('VP8X', vp8x),
      chunk('VP8L', Buffer.from([0x2f, 0, 0, 0, 0])),
      chunk('EXIF', Buffer.from('Exif\0\0MM\0*\0\0\0\x08', 'latin1')),
      chunk('XMP ', Buffer.from('<x:xmpmeta/>', 'latin1')),
    ]);
    const riff = Buffer.alloc(8);
    riff.write('RIFF', 0, 'latin1');
    riff.writeUInt32LE(body.length, 4);
    const out = stripMetadata(new Uint8Array(Buffer.concat([riff, body])))!;
    expect(out).not.toBeNull();
    expect(has(out, 'EXIF')).toBe(false);
    expect(has(out, 'XMP ')).toBe(false);
    expect(out[20] & 0x0c).toBe(0);
    expect(Buffer.from(out).readUInt32LE(4)).toBe(out.length - 8);
  });
});

describe('keeping EXIF on export', () => {
  it('carries EXIF over with orientation reset to upright', () => {
    const seg = extractUprightExif(fixture('gps-exif.jpg'))!;
    expect(seg).not.toBeNull();
    const out = insertJpegSegment(fixture('dusk-portrait.jpg'), seg);
    const m = readMetadata(out);
    expect(m.orientation).toBe(1);
    expect(m.camera).toContain('Fixture Cam');
  });

  it('can drop the location while keeping the camera', () => {
    const seg = extractUprightExif(fixture('gps-exif.jpg'), true)!;
    const m = readMetadata(insertJpegSegment(fixture('dusk-portrait.jpg'), seg));
    expect(m.location).toBeUndefined();
    expect(m.camera).toContain('Fixture Cam');
  });
});
