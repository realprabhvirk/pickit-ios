import { ScreenHost } from './ScreenHost';
import { InstallHelp } from './installHelp';
import { MenuHost } from '../ui/Menu';
import { AlertHost } from '../ui/Alert';
import { ToastHost } from '../ui/Toast';
import { Icon } from '../ui/Icon';

export function App() {
  return (
    <>
      <ScreenHost />
      <InstallHelp />
      <MenuHost />
      <AlertHost />
      <ToastHost />
      <div class="rotate-notice" aria-hidden="true">
        <div>
          <Icon name="rotate" size={40} />
          <p class="t-headline" style={{ marginTop: '12px' }}>
            Rotate to portrait
          </p>
          <p class="t-subheadline">PicKit is designed for portrait.</p>
        </div>
      </div>
    </>
  );
}
