import { describe, expect, it } from 'vitest';
import { buildName, checkName, naturalSort, previewRenames, uniqueName } from '../../src/engine/rename';

describe('rename engine', () => {
  const rule = { pattern: '{name}-{number}', start: 1, padding: 3 };

  it('fills tokens and keeps the extension', () => {
    expect(buildName({ name: 'IMG_1.HEIC' }, rule, 0)).toBe('IMG_1-001.HEIC');
    expect(buildName({ name: 'a.jpg', lastModified: Date.UTC(2026, 0, 5, 12) }, { pattern: '{date}', start: 1, padding: 1 }, 0)).toMatch(/^2026-01-0[45]\.jpg$/);
    expect(buildName({ name: 'a.jpg', width: 10, height: 20 }, { pattern: '{width}x{height}', start: 1, padding: 1 }, 0)).toBe('10x20.jpg');
  });

  it('flags duplicates, empty names and characters files can’t have', () => {
    const p = previewRenames([{ name: 'a.jpg' }, { name: 'b.jpg' }], { pattern: 'same', start: 1, padding: 1 });
    expect(p.every((x) => x.problem?.includes('More than one'))).toBe(true);
    expect(checkName('.jpg')).toBeTruthy();
    expect(checkName('a/b.jpg')).toBeTruthy();
    expect(checkName('a:b.jpg')).toBeTruthy();
    expect(checkName('fine name.jpg')).toBeNull();
  });

  it('sorts like Files, numbers in order', () => {
    expect(naturalSort(['10.jpg', '2.jpg', '1.jpg'], (x) => x)).toEqual(['1.jpg', '2.jpg', '10.jpg']);
  });

  it('makes names unique without overwriting', () => {
    const taken = new Set(['photo.jpg', 'photo 2.jpg']);
    expect(uniqueName('Photo.jpg', taken)).toBe('Photo 3.jpg');
  });
});
