import { signal } from '@preact/signals';
import { isIOS, isStandalone } from './env';
import { settings, updateSettings } from '../store/settings';
import { Sheet } from '../ui/Sheet';
import { Icon, type IconName } from '../ui/Icon';
import { Button } from '../ui/Button';

const open = signal(false);

export function openInstallHelp() {
  open.value = true;
}

/** Show once, automatically, in a Safari tab on iPhone. Never once installed. */
export function maybeShowInstallHelp() {
  if (isStandalone() || !isIOS() || settings.value.installHelpSeen) return;
  setTimeout(() => {
    if (!isStandalone()) open.value = true;
  }, 900);
}

function Step({ n, icon, children }: { n: number; icon: IconName; children: preact.ComponentChildren }) {
  return (
    <li class="install-step">
      <span class="install-num" aria-hidden="true">
        {n}
      </span>
      <span class="install-text">{children}</span>
      <span class="install-glyph" aria-hidden="true">
        <Icon name={icon} />
      </span>
    </li>
  );
}

/**
 * iOS has no install prompt API, so this explains the Share > Add to Home Screen route instead
 * of faking one.
 */
export function InstallHelp() {
  const dismiss = () => {
    open.value = false;
    if (!settings.value.installHelpSeen) updateSettings({ installHelpSeen: true });
  };
  return (
    <Sheet open={open.value} onDismiss={dismiss} modal detents={['large']} initial="large" title="" id="install-help">
      <div class="install">
        <div class="install-icon" aria-hidden="true">
          <img src="/icons/icon-192.png" width="72" height="72" alt="" />
        </div>
        <h2 class="t-title1 t-emph install-title">Add PicKit to your Home Screen</h2>
        <p class="t-subheadline t-secondary install-lead">
          Installed, PicKit opens full screen, works in Airplane Mode and iOS keeps your settings and unfinished edits. In a Safari tab, iOS can
          clear them after 7 days without a visit.
        </p>
        <ol class="install-steps">
          <Step n={1} icon="share">
            Tap <b>Share</b>. On iOS 26 it’s under <b>•••</b> next to the address bar.
          </Step>
          <Step n={2} icon="add-home">
            Scroll down and tap <b>Add to Home Screen</b>. You may need <b>View More</b> first.
          </Step>
          <Step n={3} icon="checkmark">
            Leave <b>Open as Web App</b> switched on, then tap <b>Add</b>.
          </Step>
        </ol>
        <Button variant="filled" large label="Got It" class="install-done" onClick={dismiss} />
      </div>
    </Sheet>
  );
}
