import { Icon, type IconName } from './Icon';
import { pressHandlers } from './press';
import { haptic } from './haptics';

export interface ToolItem<T extends string> {
  id: T;
  icon: IconName;
  label: string;
}

interface ToolbarProps<T extends string> {
  items: ToolItem<T>[];
  active?: T | null;
  onSelect: (id: T, el: HTMLElement) => void;
  toolbarRef?: (el: HTMLDivElement | null) => void;
  label?: string;
}

/**
 * Floating glass toolbar, concentric with the display corners. Scrolls sideways when the tools
 * don't fit. Follows the system appearance: light glass in light mode, dark in dark mode.
 */
export function Toolbar<T extends string>({ items, active, onSelect, toolbarRef, label = 'Tools' }: ToolbarProps<T>) {
  return (
    <div ref={toolbarRef} class="toolbar glass" role="toolbar" aria-label={label}>
      <div class="toolbar-scroll">
        {items.map((t) => (
          <button
            type="button"
            class="tool"
            aria-pressed={active === t.id}
            onClick={(e) => {
              haptic();
              onSelect(t.id, e.currentTarget as HTMLElement);
            }}
            {...pressHandlers()}
          >
            <Icon name={t.icon} />
            <span class="tool-label">{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
