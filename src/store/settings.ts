import { effect, signal } from '@preact/signals';
import { getItem, setItem } from './db';

export type Tint = 'blue' | 'indigo' | 'purple' | 'pink' | 'red' | 'orange' | 'yellow' | 'green' | 'gray';
export type ExportFormat = 'jpeg' | 'png' | 'webp';

export interface Settings {
  tint: Tint;
  exportFormat: ExportFormat;
  exportQuality: number;
  stripMetadata: boolean;
  motionGlass: boolean;
  haptics: boolean;
  installHelpSeen: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  tint: 'blue',
  exportFormat: 'jpeg',
  exportQuality: 82,
  stripMetadata: true,
  motionGlass: false,
  haptics: false,
  installHelpSeen: false,
};

export const TINTS: { id: Tint; name: string }[] = [
  { id: 'blue', name: 'Blue' },
  { id: 'indigo', name: 'Indigo' },
  { id: 'purple', name: 'Purple' },
  { id: 'pink', name: 'Pink' },
  { id: 'red', name: 'Red' },
  { id: 'orange', name: 'Orange' },
  { id: 'yellow', name: 'Yellow' },
  { id: 'green', name: 'Green' },
  { id: 'gray', name: 'Graphite' },
];

export const settings = signal<Settings>(readFastSettings());
export const settingsLoaded = signal(false);

const KEY = 'settings';
const FAST_KEY = 'pickit.tint';

/** The tint is mirrored to localStorage so the first frame already has the right colour. */
function readFastSettings(): Settings {
  try {
    const tint = localStorage.getItem(FAST_KEY) as Tint | null;
    if (tint && TINTS.some((t) => t.id === tint)) return { ...DEFAULT_SETTINGS, tint };
  } catch {
    /* blocked */
  }
  return { ...DEFAULT_SETTINGS };
}

export function updateSettings(patch: Partial<Settings>) {
  settings.value = { ...settings.value, ...patch };
}

export async function loadSettings() {
  const saved = await getItem<Partial<Settings>>(KEY);
  if (saved && typeof saved === 'object') {
    const merged = { ...DEFAULT_SETTINGS };
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      if (k in saved && typeof saved[k] === typeof DEFAULT_SETTINGS[k]) (merged as Record<string, unknown>)[k] = saved[k];
    }
    settings.value = merged;
  }
  settingsLoaded.value = true;
  effect(() => {
    const s = settings.value;
    void setItem(KEY, s);
    try {
      localStorage.setItem(FAST_KEY, s.tint);
    } catch {
      /* blocked */
    }
  });
}
