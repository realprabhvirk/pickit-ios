import { signal } from '@preact/signals';
import type { DecodedImage } from '../engine/decode';

/** The photo open in the editor. Phase 2 turns this into a list for the photo switcher. */
export const currentImage = signal<DecodedImage | null>(null);

export function closeCurrentImage() {
  currentImage.value?.bitmap.close();
  currentImage.value = null;
}
