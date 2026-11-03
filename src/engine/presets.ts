import data from './presets.json';

/**
 * "Resize for" presets, copied as-is from PicKit for Windows (src/PicKit.Core/Presets/presets.json).
 * Each has a note and, where checked, a source. `fitOnly` presets scale without cropping.
 */
export interface Preset {
  name: string;
  width: number;
  height: number;
  note: string;
  source?: string;
  fitOnly?: boolean;
}

export interface PresetGroup {
  name: string;
  presets: Preset[];
}

export interface PresetCatalog {
  verified: string;
  groups: PresetGroup[];
}

function isPreset(p: unknown): p is Preset {
  const o = p as Record<string, unknown>;
  return (
    !!o &&
    typeof o.name === 'string' &&
    Number.isInteger(o.width) &&
    Number.isInteger(o.height) &&
    (o.width as number) > 0 &&
    (o.height as number) > 0 &&
    typeof o.note === 'string'
  );
}

/** Validates the catalogue; a bad entry is dropped rather than breaking the list. */
export function loadPresets(raw: unknown = data): PresetCatalog {
  const r = raw as { verified?: unknown; groups?: unknown };
  const groups: PresetGroup[] = [];
  if (Array.isArray(r?.groups)) {
    for (const g of r.groups as { name?: unknown; presets?: unknown }[]) {
      if (typeof g?.name !== 'string' || !Array.isArray(g.presets)) continue;
      const presets = g.presets.filter(isPreset);
      if (presets.length) groups.push({ name: g.name, presets });
    }
  }
  return { verified: typeof r?.verified === 'string' ? r.verified : '', groups };
}
