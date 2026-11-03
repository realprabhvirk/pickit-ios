import { signal } from '@preact/signals';
import { pushBack } from './back';

export type ScreenName = 'picker' | 'editor' | 'settings' | 'about' | 'offline' | 'batch';

export interface ScreenEntry {
  key: number;
  name: ScreenName;
  /** 'push' slides in from the right (lists); 'modal' fades and scales (the editor). */
  style: 'push' | 'modal';
  leaving?: boolean;
}

let seq = 0;
export const screens = signal<ScreenEntry[]>([{ key: ++seq, name: 'picker', style: 'push' }]);

const unregisters = new Map<number, () => void>();

export function pushScreen(name: ScreenName, style: ScreenEntry['style'] = name === 'editor' ? 'modal' : 'push') {
  const entry: ScreenEntry = { key: ++seq, name, style };
  screens.value = [...screens.value.filter((s) => !s.leaving), entry];
  unregisters.set(
    entry.key,
    pushBack(() => {
      unregisters.delete(entry.key);
      markLeaving(entry.key);
    }),
  );
}

/** Close the top screen (with its exit animation). */
export function popScreen() {
  const live = screens.value.filter((s) => !s.leaving);
  if (live.length <= 1) return;
  const top = live[live.length - 1];
  const un = unregisters.get(top.key);
  unregisters.delete(top.key);
  un?.();
  markLeaving(top.key);
}

function markLeaving(key: number) {
  screens.value = screens.value.map((s) => (s.key === key ? { ...s, leaving: true } : s));
}

/** Called by the screen host once a leaving screen's animation has finished. */
export function removeScreen(key: number) {
  screens.value = screens.value.filter((s) => s.key !== key);
}

export const topScreen = () => {
  const live = screens.value.filter((s) => !s.leaving);
  return live[live.length - 1]?.name;
};
