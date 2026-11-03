import { popScreen } from '../app/nav';
import { NavScreen } from '../ui/NavScreen';
import { Icon } from '../ui/Icon';
import './settings.css';

export function Batch() {
  return (
    <NavScreen title="Batch" onBack={popScreen} id="batch">
      <div class="empty-state">
        <Icon name="stack" />
        <h2 class="t-title3 t-emph">Many Photos at Once</h2>
        <p class="t-subheadline t-secondary">
          Compress, resize, convert and rename a whole selection, with a preview first, Cancel while it runs and Undo after. Arrives in Phase 3.
        </p>
      </div>
    </NavScreen>
  );
}
