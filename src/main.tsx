import { render } from 'preact';
import { effect } from '@preact/signals';
import './design/tokens.css';
import './design/base.css';
import './design/type.css';
import './design/glass.css';
import './ui/ui.css';
import { App } from './app/App';
import { installIconSprite } from './ui/Icon';
import { isIOS, isStandalone, statusBarStyle, trackKeyboard } from './app/env';
import { loadSettings, settings } from './store/settings';
import { startPwa } from './app/pwa';
import { setHapticsEnabled } from './ui/haptics';
import { enableMotionTilt, resumeMotionTiltIfAllowed, startPointerTilt } from './app/tilt';
import { maybeShowInstallHelp } from './app/installHelp';

const root = document.documentElement;
root.dataset.standalone = String(isStandalone());
root.dataset.statusBar = statusBarStyle;
root.dataset.ios = String(isIOS());
const sim = new URLSearchParams(location.search).get('sim');
if (sim === 'iphone-14-pro') root.dataset.sim = sim;

// Page-level pinch zoom stays off; the photo canvas does its own.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

installIconSprite();

effect(() => {
  root.dataset.tint = settings.value.tint;
  setHapticsEnabled(settings.value.haptics);
});

const app = document.getElementById('app')!;
trackKeyboard(app);
render(<App />, app);

void loadSettings().then(() => {
  maybeShowInstallHelp();
  if (settings.value.motionGlass) {
    resumeMotionTiltIfAllowed();
    // iOS asks for motion permission only from a tap; re-arm on the first one.
    window.addEventListener('pointerup', () => void enableMotionTilt(), { once: true });
  }
});

startPointerTilt();
startPwa();
