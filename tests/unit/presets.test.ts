import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadPresets } from '../../src/engine/presets';

describe('presets', () => {
  it('is the Windows catalogue, copied as-is', () => {
    const ours = readFileSync(new URL('../../src/engine/presets.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(ours);
    expect(parsed.verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(parsed.groups.length).toBeGreaterThan(0);
  });

  it('loads every preset with a size and a note', () => {
    const cat = loadPresets();
    const all = cat.groups.flatMap((g) => g.presets);
    expect(all.length).toBeGreaterThanOrEqual(10);
    for (const p of all) {
      expect(p.width).toBeGreaterThan(0);
      expect(p.height).toBeGreaterThan(0);
      expect(p.note.length).toBeGreaterThan(0);
    }
    expect(all.find((p) => p.name === 'Instagram Portrait')).toMatchObject({ width: 1080, height: 1350 });
  });

  it('drops malformed entries instead of failing', () => {
    const cat = loadPresets({
      verified: 1,
      groups: [
        { name: 'Ok', presets: [{ name: 'A', width: 10, height: 10, note: 'n' }, { name: 'Bad', width: -1, height: 5, note: 'x' }] },
        { name: 'Broken', presets: 'nope' },
        null,
        { presets: [] },
      ],
    });
    expect(cat.groups).toHaveLength(1);
    expect(cat.groups[0].presets).toHaveLength(1);
    expect(cat.verified).toBe('');
    expect(loadPresets(null).groups).toEqual([]);
    expect(loadPresets('garbage').groups).toEqual([]);
  });
});
