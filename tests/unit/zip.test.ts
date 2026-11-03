import { describe, expect, it } from 'vitest';
import { makeZip } from '../../src/engine/zip';
import { crc32 } from '../../src/engine/metadata';

describe('zip', () => {
  it('writes a valid stored archive that reads back', async () => {
    const enc = new TextEncoder();
    const files = [
      { name: 'one.jpg', data: enc.encode('hello') },
      { name: 'café.png', data: new Uint8Array([1, 2, 3, 4]) },
    ];
    const buf = Buffer.from(await makeZip(files).arrayBuffer());
    const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    expect(end).toBeGreaterThan(0);
    expect(buf.readUInt16LE(end + 10)).toBe(2);
    let cd = buf.readUInt32LE(end + 16);
    for (const f of files) {
      expect(buf.readUInt32LE(cd)).toBe(0x02014b50);
      const nameLen = buf.readUInt16LE(cd + 28);
      expect(buf.subarray(cd + 46, cd + 46 + nameLen).toString('utf8')).toBe(f.name);
      expect(buf.readUInt32LE(cd + 16)).toBe(crc32(f.data));
      const local = buf.readUInt32LE(cd + 42);
      expect(buf.readUInt32LE(local)).toBe(0x04034b50);
      const ln = buf.readUInt16LE(local + 26);
      const data = buf.subarray(local + 30 + ln, local + 30 + ln + f.data.length);
      expect(Buffer.compare(data, Buffer.from(f.data))).toBe(0);
      cd += 46 + nameLen;
    }
  });

  it('crc32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});
