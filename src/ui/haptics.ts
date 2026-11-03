/**
 * Best-effort system haptic. iOS has no Vibration API, but toggling a native
 * <input type="checkbox" switch> from a user gesture plays the switch haptic on recent iOS.
 * Off unless Settings > Haptics is on. Does nothing elsewhere.
 */
let label: HTMLLabelElement | null = null;
let enabled = false;

export function setHapticsEnabled(on: boolean) {
  enabled = on;
}

export function haptic() {
  if (!enabled) return;
  try {
    if (!label) {
      label = document.createElement('label');
      label.setAttribute('aria-hidden', 'true');
      label.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      input.tabIndex = -1;
      label.appendChild(input);
      document.body.appendChild(label);
    }
    label.click();
  } catch {
    /* no haptic, no problem */
  }
}
