/**
 * Reading and removing photo metadata, byte by byte. Ported from PicKit for Windows
 * (Metadata/MetadataStripper.cs, ExifCarryOver.cs, ImageMetadataInfo.cs).
 *
 * Stripping rewrites the container (JPEG segments, PNG chunks, WebP RIFF chunks) without
 * touching compressed image data, so nothing is recompressed. Everything is keep-listed and
 * validated; anything that doesn't add up returns null and the caller re-encodes pixels instead,
 * which can't carry anything hidden.
 */

export interface PhotoMetadata {
  camera?: string;
  lens?: string;
  taken?: string;
  exposure?: string;
  location?: { lat: number; lon: number; alt?: number };
  author?: string;
  copyright?: string;
  software?: string;
  orientation?: number;
  colorProfile?: string;
  wideGamut: boolean;
  hasExif: boolean;
  hasXmp: boolean;
  hasIptc: boolean;
  hasComment: boolean;
  /** Anything a privacy-minded person would want removed. */
  hasPrivateInfo: boolean;
}

const ascii = (b: Uint8Array, from: number, len: number) => {
  let s = '';
  for (let i = from; i < from + len && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};

const startsWith = (b: Uint8Array, at: number, sig: string) => ascii(b, at, sig.length) === sig;

function indexOf(b: Uint8Array, sig: number[] | string, from = 0, limit = b.length): number {
  const s = typeof sig === 'string' ? [...sig].map((c) => c.charCodeAt(0)) : sig;
  const end = Math.min(limit, b.length) - s.length;
  outer: for (let i = from; i <= end; i++) {
    for (let j = 0; j < s.length; j++) if (b[i + j] !== s[j]) continue outer;
    return i;
  }
  return -1;
}

const be16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const be32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const le32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

// ---------- TIFF / EXIF parsing ----------

type TagValue = string | number | number[];

class Tiff {
  private little: boolean;
  constructor(private b: Uint8Array) {
    this.little = b[0] === 0x49;
    if (!((b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d))) throw new Error('not tiff');
  }
  u16(i: number) {
    if (i + 2 > this.b.length) throw new Error('eof');
    return this.little ? this.b[i] | (this.b[i + 1] << 8) : (this.b[i] << 8) | this.b[i + 1];
  }
  u32(i: number) {
    if (i + 4 > this.b.length) throw new Error('eof');
    return this.little ? le32(this.b, i) : be32(this.b, i);
  }
  get ifd0() {
    return this.u32(4);
  }
  readIfd(offset: number): Map<number, TagValue> {
    const out = new Map<number, TagValue>();
    if (offset <= 0 || offset + 2 > this.b.length) return out;
    const n = Math.min(this.u16(offset), 512);
    for (let k = 0; k < n; k++) {
      const e = offset + 2 + k * 12;
      if (e + 12 > this.b.length) break;
      const tag = this.u16(e);
      const type = this.u16(e + 2);
      const count = this.u32(e + 4);
      try {
        const v = this.value(type, count, e + 8);
        if (v !== undefined) out.set(tag, v);
      } catch {
        /* skip a damaged entry */
      }
    }
    return out;
  }
  private value(type: number, count: number, at: number): TagValue | undefined {
    const size = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8][type] ?? 0;
    if (!size || count > 1 << 20) return undefined;
    const total = size * count;
    const ptr = total <= 4 ? at : this.u32(at);
    if (ptr + total > this.b.length) return undefined;
    switch (type) {
      case 2: {
        let s = ascii(this.b, ptr, count);
        const z = s.indexOf('\0');
        if (z >= 0) s = s.slice(0, z);
        return s.trim();
      }
      case 1:
      case 7:
        return count === 1 ? this.b[ptr] : Array.from(this.b.subarray(ptr, ptr + Math.min(count, 256)));
      case 3: {
        const arr = Array.from({ length: Math.min(count, 64) }, (_, i) => this.u16(ptr + i * 2));
        return count === 1 ? arr[0] : arr;
      }
      case 4:
      case 9: {
        const arr = Array.from({ length: Math.min(count, 64) }, (_, i) => this.u32(ptr + i * 4));
        return count === 1 ? arr[0] : arr;
      }
      case 5:
      case 10: {
        const arr = Array.from({ length: Math.min(count, 16) }, (_, i) => {
          let num = this.u32(ptr + i * 8);
          let den = this.u32(ptr + i * 8 + 4);
          if (type === 10) {
            num |= 0;
            den |= 0;
          }
          return den === 0 ? 0 : num / den;
        });
        return count === 1 ? arr[0] : arr;
      }
      default:
        return undefined;
    }
  }
}

const TAG = {
  make: 0x010f,
  model: 0x0110,
  orientation: 0x0112,
  software: 0x0131,
  dateTime: 0x0132,
  artist: 0x013b,
  copyright: 0x8298,
  exifIfd: 0x8769,
  gpsIfd: 0x8825,
  xpAuthor: 0x9c9d,
  dateTaken: 0x9003,
  exposureTime: 0x829a,
  fNumber: 0x829d,
  iso: 0x8827,
  focalLength: 0x920a,
  lensMake: 0xa433,
  lensModel: 0xa434,
};

function dms(v: TagValue | undefined): number | undefined {
  if (Array.isArray(v) && v.length >= 3) return v[0] + v[1] / 60 + v[2] / 3600;
  if (typeof v === 'number') return v;
  return undefined;
}

function utf16le(v: TagValue | undefined): string | undefined {
  if (!Array.isArray(v)) return typeof v === 'string' ? v : undefined;
  let s = '';
  for (let i = 0; i + 1 < v.length; i += 2) {
    const c = v[i] | (v[i + 1] << 8);
    if (!c) break;
    s += String.fromCharCode(c);
  }
  return s.trim() || undefined;
}

function formatExposure(t?: TagValue) {
  if (typeof t !== 'number' || t <= 0) return undefined;
  return t >= 1 ? `${+t.toFixed(1)} s` : `1/${Math.round(1 / t)} s`;
}

/** Parses an EXIF TIFF block into the fields people care about. */
export function parseExif(tiffBytes: Uint8Array, into: PhotoMetadata) {
  const t = new Tiff(tiffBytes);
  const ifd0 = t.readIfd(t.ifd0);
  const str = (v: TagValue | undefined) => (typeof v === 'string' && v ? v : undefined);
  const make = str(ifd0.get(TAG.make));
  const model = str(ifd0.get(TAG.model));
  if (make || model) into.camera = model && make && !model.startsWith(make) ? `${make} ${model}` : (model ?? make);
  into.software = str(ifd0.get(TAG.software));
  const o = ifd0.get(TAG.orientation);
  if (typeof o === 'number') into.orientation = o;
  into.author = str(ifd0.get(TAG.artist)) ?? utf16le(ifd0.get(TAG.xpAuthor));
  into.copyright = str(ifd0.get(TAG.copyright));
  into.taken = str(ifd0.get(TAG.dateTime));

  const exifPtr = ifd0.get(TAG.exifIfd);
  if (typeof exifPtr === 'number') {
    const ex = t.readIfd(exifPtr);
    into.taken = str(ex.get(TAG.dateTaken)) ?? into.taken;
    const lens = str(ex.get(TAG.lensModel));
    if (lens) into.lens = lens;
    const parts: string[] = [];
    const f = ex.get(TAG.fNumber);
    if (typeof f === 'number' && f > 0) parts.push(`ƒ/${+f.toFixed(1)}`);
    const et = formatExposure(ex.get(TAG.exposureTime));
    if (et) parts.push(et);
    const iso = ex.get(TAG.iso);
    if (typeof iso === 'number') parts.push(`ISO ${iso}`);
    else if (Array.isArray(iso) && iso.length) parts.push(`ISO ${iso[0]}`);
    const fl = ex.get(TAG.focalLength);
    if (typeof fl === 'number' && fl > 0) parts.push(`${+fl.toFixed(1)} mm`);
    if (parts.length) into.exposure = parts.join(' · ');
  }

  const gpsPtr = ifd0.get(TAG.gpsIfd);
  if (typeof gpsPtr === 'number') {
    const g = t.readIfd(gpsPtr);
    const lat = dms(g.get(2));
    const lon = dms(g.get(4));
    if (lat !== undefined && lon !== undefined && (lat !== 0 || lon !== 0)) {
      const latRef = g.get(1);
      const lonRef = g.get(3);
      const alt = g.get(6);
      into.location = {
        lat: latRef === 'S' ? -lat : lat,
        lon: lonRef === 'W' ? -lon : lon,
        alt: typeof alt === 'number' ? (g.get(5) === 1 ? -alt : alt) : undefined,
      };
    }
  }
}

/** Display P3 and friends, from an ICC profile's description or by name. */
function profileName(icc: Uint8Array): string | undefined {
  try {
    const count = be32(icc, 128);
    for (let i = 0; i < Math.min(count, 64); i++) {
      const e = 132 + i * 12;
      if (ascii(icc, e, 4) !== 'desc') continue;
      const off = be32(icc, e + 4);
      const type = ascii(icc, off, 4);
      if (type === 'desc') {
        const len = be32(icc, off + 8);
        return ascii(icc, off + 12, Math.min(len, 128)).replace(/\0.*$/, '').trim() || undefined;
      }
      if (type === 'mluc') {
        const recLen = be32(icc, off + 20);
        const recOff = be32(icc, off + 24);
        let s = '';
        for (let k = 0; k + 1 < Math.min(recLen, 256); k += 2) s += String.fromCharCode(be16(icc, off + recOff + k));
        return s.replace(/\0.*$/, '').trim() || undefined;
      }
    }
  } catch {
    /* damaged profile */
  }
  return undefined;
}

const WIDE = /display p3|p3|adobe rgb|prophoto|rec\.?\s?2020|bt\.?2020/i;

/** Reads what a photo says about itself. Never throws; damaged parts are skipped. */
export function readMetadata(bytes: Uint8Array): PhotoMetadata {
  const m: PhotoMetadata = { wideGamut: false, hasExif: false, hasXmp: false, hasIptc: false, hasComment: false, hasPrivateInfo: false };
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xd8) readJpeg(bytes, m);
    else if (startsWith(bytes, 0, '\x89PNG')) readPng(bytes, m);
    else if (startsWith(bytes, 0, 'RIFF') && startsWith(bytes, 8, 'WEBP')) readWebp(bytes, m);
    else if (startsWith(bytes, 4, 'ftyp')) readHeif(bytes, m);
  } catch {
    /* keep what was read */
  }
  m.wideGamut = !!m.colorProfile && WIDE.test(m.colorProfile);
  m.hasPrivateInfo = !!(m.location || m.camera || m.author || m.copyright || m.taken || m.lens || m.hasXmp || m.hasIptc || m.hasComment);
  return m;
}

function readJpeg(b: Uint8Array, m: PhotoMetadata) {
  let p = 2;
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) return;
    const marker = b[p + 1];
    if (marker === 0xff) {
      p++;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return;
    const len = be16(b, p + 2);
    if (len < 2 || p + 2 + len > b.length) return;
    const body = p + 4;
    if (marker === 0xe1 && startsWith(b, body, 'Exif\0\0')) {
      m.hasExif = true;
      try {
        parseExif(b.subarray(body + 6, p + 2 + len), m);
      } catch {
        /* damaged EXIF */
      }
    } else if (marker === 0xe1 && startsWith(b, body, 'http://ns.adobe.com/xap')) m.hasXmp = true;
    else if (marker === 0xed) m.hasIptc = true;
    else if (marker === 0xfe) m.hasComment = true;
    else if (marker === 0xe2 && startsWith(b, body, 'ICC_PROFILE\0')) {
      m.colorProfile ??= profileName(b.subarray(body + 14, p + 2 + len));
    }
    p += 2 + len;
  }
}

function readPng(b: Uint8Array, m: PhotoMetadata) {
  let p = 8;
  while (p + 12 <= b.length) {
    const len = be32(b, p);
    const type = ascii(b, p + 4, 4);
    const data = p + 8;
    if (data + len > b.length) return;
    if (type === 'eXIf') {
      m.hasExif = true;
      try {
        parseExif(b.subarray(data, data + len), m);
      } catch {
        /* damaged */
      }
    } else if (type === 'iTXt' || type === 'tEXt' || type === 'zTXt') {
      const key = ascii(b, data, Math.min(80, len)).split('\0')[0];
      if (key === 'XML:com.adobe.xmp') m.hasXmp = true;
      else m.hasComment = true;
    } else if (type === 'iCCP') {
      m.colorProfile ??= ascii(b, data, Math.min(80, len)).split('\0')[0] || undefined;
    } else if (type === 'IEND') return;
    p += 12 + len;
  }
}

function readWebp(b: Uint8Array, m: PhotoMetadata) {
  let p = 12;
  const end = Math.min(b.length, 8 + le32(b, 4));
  while (p + 8 <= end) {
    const type = ascii(b, p, 4);
    const size = le32(b, p + 4);
    const data = p + 8;
    if (data + size > end) return;
    if (type === 'EXIF') {
      m.hasExif = true;
      const off = startsWith(b, data, 'Exif\0\0') ? 6 : 0;
      try {
        parseExif(b.subarray(data + off, data + size), m);
      } catch {
        /* damaged */
      }
    } else if (type === 'XMP ') m.hasXmp = true;
    else if (type === 'ICCP') m.colorProfile ??= profileName(b.subarray(data, data + size));
    p += 8 + size + (size % 2);
  }
}

/** HEIC/AVIF: find the EXIF item and the colour profile without a full ISO-BMFF parser. */
function readHeif(b: Uint8Array, m: PhotoMetadata) {
  const limit = Math.min(b.length, 4 * 1024 * 1024);
  const at = indexOf(b, 'Exif\0\0', 0, limit);
  if (at >= 0 && (startsWith(b, at + 6, 'MM') || startsWith(b, at + 6, 'II'))) {
    m.hasExif = true;
    try {
      parseExif(b.subarray(at + 6, Math.min(b.length, at + 6 + 256 * 1024)), m);
    } catch {
      /* damaged */
    }
  }
  if (indexOf(b, '<x:xmpmeta', 0, limit) >= 0) m.hasXmp = true;
  const prof = indexOf(b, 'prof', 0, limit);
  if (prof >= 0) m.colorProfile ??= profileName(b.subarray(prof + 4, Math.min(b.length, prof + 4 + 64 * 1024)));
}

// ---------- stripping ----------

const METADATA_SIGNATURES: number[][] = [
  [...'Exif\0\0'].map((c) => c.charCodeAt(0)),
  [...'<x:xmpmeta'].map((c) => c.charCodeAt(0)),
  [...'http://ns.adobe.com/xap'].map((c) => c.charCodeAt(0)),
  [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00],
  [0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08],
];

const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'acTL', 'fcTL', 'fdAT']);
const WEBP_KEEP = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF', 'ICCP']);

class Bad extends Error {}

class Out {
  parts: Uint8Array[] = [];
  length = 0;
  push(b: Uint8Array) {
    this.parts.push(b);
    this.length += b.length;
  }
  bytes() {
    const out = new Uint8Array(this.length);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}

/**
 * The file without metadata, or null if it isn't a JPEG, PNG or WebP that can be rewritten
 * safely. Callers then re-encode pixels.
 */
export function stripMetadata(file: Uint8Array): Uint8Array | null {
  try {
    let out: Uint8Array | null = null;
    if (file.length > 2 && file[0] === 0xff && file[1] === 0xd8) out = stripJpeg(file);
    else if (startsWith(file, 0, '\x89PNG\r\n\x1a\n')) out = stripPng(file);
    else if (file.length >= 12 && startsWith(file, 0, 'RIFF') && startsWith(file, 8, 'WEBP')) out = stripWebp(file);
    if (!out) return null;
    // Final check: a damaged size field could fold metadata into a kept structure.
    for (const sig of METADATA_SIGNATURES) if (indexOf(out, sig) >= 0) return null;
    return out;
  } catch {
    return null;
  }
}

const isFrameMarker = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

function validImageSegment(marker: number, p: Uint8Array): boolean {
  if (isFrameMarker(marker)) return p.length >= 6 && p.length === 6 + 3 * p[5];
  if (marker === 0xdb) {
    let i = 0;
    while (i < p.length) {
      const wide = p[i] >> 4;
      if (wide > 1) return false;
      i += 1 + (wide === 0 ? 64 : 128);
    }
    return p.length > 0 && i === p.length;
  }
  if (marker === 0xc4) {
    let i = 0;
    while (i < p.length) {
      if (i + 17 > p.length) return false;
      let symbols = 0;
      for (let k = 0; k < 16; k++) symbols += p[i + 1 + k];
      i += 17 + symbols;
    }
    return p.length > 0 && i === p.length;
  }
  if (marker === 0xdd) return p.length === 2;
  return false;
}

function stripJpeg(f: Uint8Array): Uint8Array {
  const out = new Out();
  out.push(f.subarray(0, 2));
  let p = 2;
  let hasFrame = false;
  for (;;) {
    if (p + 1 >= f.length || f[p] !== 0xff) throw new Bad('marker');
    const marker = f[p + 1];
    if (marker === 0xff) {
      p++;
      continue;
    }
    if (marker === 0xda) {
      const len = be16(f, p + 2);
      const comps = f[p + 4];
      if (!hasFrame || comps < 1 || comps > 4 || len !== 6 + 2 * comps) throw new Bad('scan');
      // Walk the entropy-coded data to the real end; anything after (a second picture) is dropped.
      let e = p;
      while (e + 1 < f.length && !(f[e] === 0xff && f[e + 1] === 0xd9)) e++;
      if (e + 1 >= f.length) throw new Bad('no EOI');
      out.push(f.subarray(p, e + 2));
      return out.bytes();
    }
    if (marker === 0xd9) {
      out.push(f.subarray(p, p + 2));
      return out.bytes();
    }
    const len = be16(f, p + 2);
    if (len < 2 || p + 2 + len > f.length) throw new Bad('segment length');
    const payload = f.subarray(p + 4, p + 2 + len);
    let keep: boolean;
    if (marker === 0xfe) keep = false;
    else if (marker < 0xe0 || marker > 0xef) {
      if (!validImageSegment(marker, payload)) throw new Bad('segment type');
      keep = true;
    } else if (marker === 0xe0) keep = startsWith(payload, 0, 'JFIF\0');
    else if (marker === 0xe2) keep = startsWith(payload, 0, 'ICC_PROFILE\0');
    else if (marker === 0xee) keep = startsWith(payload, 0, 'Adobe');
    else keep = false;
    if (keep) out.push(f.subarray(p, p + 2 + len));
    hasFrame ||= isFrameMarker(marker);
    p += 2 + len;
  }
}

let crcTable: Uint32Array | null = null;
export function crc32(data: Uint8Array, start = 0, end = data.length, seed = 0): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = ~seed >>> 0;
  for (let i = start; i < end; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return ~crc >>> 0;
}

function stripPng(f: Uint8Array): Uint8Array {
  const out = new Out();
  out.push(f.subarray(0, 8));
  let p = 8;
  while (p + 12 <= f.length) {
    const len = be32(f, p);
    if (p + 12 + len > f.length) throw new Bad('chunk length');
    const type = ascii(f, p + 4, 4);
    if (PNG_KEEP.has(type)) {
      if (crc32(f, p + 4, p + 8 + len) !== be32(f, p + 8 + len)) throw new Bad('crc');
      out.push(f.subarray(p, p + 12 + len));
    }
    p += 12 + len;
    if (type === 'IEND') return out.bytes();
  }
  throw new Bad('no IEND');
}

function stripWebp(f: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let bodyLen = 4;
  const end = Math.min(f.length, 8 + le32(f, 4));
  let p = 12;
  let stills = 0;
  let headers = 0;
  while (p + 8 <= end) {
    const type = ascii(f, p, 4);
    const size = le32(f, p + 4);
    const padded = size + (size % 2);
    if (p + 8 + padded > end) throw new Bad('chunk length');
    stills += type === 'VP8 ' || type === 'VP8L' ? 1 : 0;
    headers += type === 'VP8X' ? 1 : 0;
    if (stills > 1 || headers > 1 || (type === 'VP8X' && p !== 12)) throw new Bad('unexpected chunk');
    if (WEBP_KEEP.has(type)) {
      const chunk = f.slice(p, p + 8 + padded);
      if (type === 'VP8X') chunk[8] &= ~(0x08 | 0x04);
      parts.push(chunk);
      bodyLen += chunk.length;
    }
    p += 8 + padded;
  }
  const out = new Uint8Array(8 + bodyLen);
  out.set([0x52, 0x49, 0x46, 0x46], 0);
  out[4] = bodyLen & 0xff;
  out[5] = (bodyLen >> 8) & 0xff;
  out[6] = (bodyLen >> 16) & 0xff;
  out[7] = (bodyLen >>> 24) & 0xff;
  out.set([0x57, 0x45, 0x42, 0x50], 8);
  let o = 12;
  for (const c of parts) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

// ---------- carrying EXIF over ----------

/**
 * The JPEG's APP1 EXIF segment with orientation reset to 1 (exported pixels are already
 * upright), or null. Location can be dropped while keeping the rest.
 */
export function extractUprightExif(jpeg: Uint8Array, dropLocation = false): Uint8Array | null {
  try {
    let p = 2;
    while (p + 4 <= jpeg.length && jpeg[p] === 0xff) {
      const marker = jpeg[p + 1];
      if (marker === 0xda) return null;
      const len = be16(jpeg, p + 2);
      if (marker === 0xe1 && startsWith(jpeg, p + 4, 'Exif\0\0')) {
        const seg = jpeg.slice(p, p + 2 + len);
        const tiff = seg.subarray(10);
        const t = new Tiff(tiff);
        const little = tiff[0] === 0x49;
        const w16 = (i: number, v: number) => {
          if (little) {
            tiff[i] = v & 0xff;
            tiff[i + 1] = v >> 8;
          } else {
            tiff[i] = v >> 8;
            tiff[i + 1] = v & 0xff;
          }
        };
        const dir = t.ifd0;
        const n = t.u16(dir);
        for (let i = 0; i < n; i++) {
          const e = dir + 2 + i * 12;
          const tag = t.u16(e);
          if (tag === TAG.orientation && t.u16(e + 2) === 3) w16(e + 8, 1);
          // Dropping location: retag the GPS pointer as a harmless private tag and blank its IFD.
          if (dropLocation && tag === TAG.gpsIfd) {
            const ptr = t.u32(e + 8);
            if (ptr > 0 && ptr + 2 <= tiff.length) {
              const count = t.u16(ptr);
              tiff.fill(0, ptr + 2, Math.min(tiff.length, ptr + 2 + count * 12));
            }
          }
        }
        return seg;
      }
      p += 2 + len;
    }
  } catch {
    /* a damaged EXIF block isn't worth carrying over */
  }
  return null;
}

/** Inserts a segment straight after the JPEG's start marker. */
export function insertJpegSegment(jpeg: Uint8Array, segment: Uint8Array): Uint8Array {
  const out = new Uint8Array(jpeg.length + segment.length);
  out.set(jpeg.subarray(0, 2), 0);
  out.set(segment, 2);
  out.set(jpeg.subarray(2), 2 + segment.length);
  return out;
}

export function formatLocation(l: { lat: number; lon: number }) {
  const f = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(5)}° ${v >= 0 ? pos : neg}`;
  return `${f(l.lat, 'N', 'S')}, ${f(l.lon, 'E', 'W')}`;
}
