import { useLayoutEffect, useRef } from 'preact/hooks';
import { menu, type MenuState } from '../app/overlays';
import { pushBack } from '../app/back';
import { springAnimate, springs } from '../design/motion';
import { Icon } from './Icon';
import { pressHandlers } from './press';
import { haptic } from './haptics';

/** Glass popover menu that grows out of the button that opened it. */
export function MenuHost() {
  const m = menu.value;
  if (!m) return null;
  return <MenuPopover key={m.anchor.top + m.anchor.left} state={m} />;
}

function MenuPopover({ state }: { state: MenuState }) {
  const panel = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const unregister = useRef<null | (() => void)>(null);

  const close = (after?: () => void, fromBack = false) => {
    if (closing.current) return;
    closing.current = true;
    if (!fromBack) unregister.current?.();
    const el = panel.current;
    const done = () => {
      menu.value = null;
      after?.();
    };
    if (!el) return done();
    const a = springAnimate(el, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0.5)', opacity: 0 }], { response: 0.25, damping: 1 });
    a.finished.then(done, done);
  };

  useLayoutEffect(() => {
    const el = panel.current!;
    const app = document.getElementById('app')!.getBoundingClientRect();
    const a = state.anchor;
    const top = a.bottom - app.top + 8;
    const right = app.right - a.right;
    el.style.top = `${top}px`;
    // Align with the trigger's nearer edge.
    const triggerCenter = a.left + a.width / 2 - app.left;
    if (triggerCenter > app.width / 2) {
      el.style.right = `${Math.max(16, right)}px`;
      el.style.transformOrigin = `calc(100% - ${a.width / 2}px) -8px`;
    } else {
      el.style.left = `${Math.max(16, a.left - app.left)}px`;
      el.style.transformOrigin = `${a.width / 2}px -8px`;
    }
    springAnimate(el, [{ transform: 'scale(0.4)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], springs.default);
    unregister.current = pushBack(() => close(undefined, true));
    (el.querySelector('button:not(:disabled)') as HTMLElement | null)?.focus({ preventScroll: true });
  }, []);

  return (
    <>
      <div class="menu-catcher" onPointerDown={() => close()} aria-hidden="true" />
      <div ref={panel} class="menu glass" role="menu" aria-label={state.label} onKeyDown={(e) => e.key === 'Escape' && close()}>
        {state.items.map((item) => (
          <>
            {item.separatorBefore && <div class="menu-sep" role="separator" />}
            <button
              type="button"
              role="menuitem"
              class={`menu-item${item.destructive ? ' destructive' : ''}`}
              disabled={item.disabled}
              onClick={() => {
                haptic();
                close(item.onSelect);
              }}
              {...pressHandlers()}
            >
              {item.icon && <Icon name={item.icon} />}
              <span>{item.label}</span>
            </button>
          </>
        ))}
      </div>
    </>
  );
}
