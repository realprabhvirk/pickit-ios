/** Where we're running. Decided once at startup. */
const nav = typeof navigator !== 'undefined' ? navigator : undefined;

export const isStandalone = (): boolean =>
  (nav as Navigator & { standalone?: boolean })?.standalone === true ||
  (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);

/** iPhone, iPad, or an iPad that reports itself as a Mac. */
export const isIOS = (): boolean => {
  if (!nav) return false;
  const ua = nav.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1);
};

export const hasTouch = (): boolean => !!nav && nav.maxTouchPoints > 0;

export const appVersion: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
export const statusBarStyle: string = typeof __STATUS_BAR_STYLE__ === 'string' ? __STATUS_BAR_STYLE__ : 'default';

/** Height of the on-screen keyboard (0 when hidden), published as --kb for sheets. */
export function trackKeyboard(root: HTMLElement) {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    root.style.setProperty('--kb', `${Math.round(kb)}px`);
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}
