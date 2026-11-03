/**
 * Feeds --tilt-x / --tilt-y (-1..1) to the glass specular highlight.
 * Desktop: follows the pointer. iPhone: follows device motion, only when the user turns on
 * Settings > Motion-reactive glass (iOS asks for permission from that tap). Off by default.
 */
let raf = 0;
let tx = 0;
let ty = 0;
let pointerBound = false;
let orientationHandler: ((e: DeviceOrientationEvent) => void) | null = null;

function write() {
  raf = 0;
  const root = document.documentElement.style;
  root.setProperty('--tilt-x', tx.toFixed(3));
  root.setProperty('--tilt-y', ty.toFixed(3));
}

function set(x: number, y: number) {
  tx = Math.max(-1, Math.min(1, x));
  ty = Math.max(-1, Math.min(1, y));
  if (!raf) raf = requestAnimationFrame(write);
}

export function startPointerTilt() {
  if (pointerBound || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  pointerBound = true;
  window.addEventListener(
    'pointermove',
    (e) => {
      if (orientationHandler) return;
      set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
    },
    { passive: true },
  );
}

type OrientationCtor = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

/** Must be called from a tap. Resolves false if permission is refused or motion isn't available. */
export async function enableMotionTilt(): Promise<boolean> {
  const Ctor = (window as unknown as { DeviceOrientationEvent?: OrientationCtor }).DeviceOrientationEvent;
  if (!Ctor) return false;
  try {
    if (typeof Ctor.requestPermission === 'function') {
      const r = await Ctor.requestPermission();
      if (r !== 'granted') return false;
    }
  } catch {
    return false;
  }
  if (!orientationHandler) {
    orientationHandler = (e) => {
      if (e.gamma == null || e.beta == null) return;
      // Portrait, held at a natural ~40 degree reading angle.
      set(e.gamma / 30, (e.beta - 40) / 30);
    };
    window.addEventListener('deviceorientation', orientationHandler);
  }
  return true;
}

export function disableMotionTilt() {
  if (orientationHandler) window.removeEventListener('deviceorientation', orientationHandler);
  orientationHandler = null;
  set(0, 0);
}

/** Re-attach on launch when the setting is already on (permission persists for the session only on iOS). */
export function resumeMotionTiltIfAllowed() {
  const Ctor = (window as unknown as { DeviceOrientationEvent?: OrientationCtor }).DeviceOrientationEvent;
  if (Ctor && typeof Ctor.requestPermission !== 'function') void enableMotionTilt();
}
