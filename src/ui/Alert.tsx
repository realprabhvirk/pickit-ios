import { useLayoutEffect, useRef } from 'preact/hooks';
import { alert, type AlertState } from '../app/overlays';
import { pushBack } from '../app/back';
import { springAnimate } from '../design/motion';
import { pressHandlers } from './press';

/** iOS 26-style alert: glass panel, capsule buttons, dimmed background. */
export function AlertHost() {
  const a = alert.value;
  if (!a) return null;
  return <AlertDialog state={a} />;
}

function AlertDialog({ state }: { state: AlertState }) {
  const panel = useRef<HTMLDivElement>(null);
  const dim = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const unregister = useRef<null | (() => void)>(null);

  const finish = (label: string | null, fromBack = false) => {
    if (done.current) return;
    done.current = true;
    if (!fromBack) unregister.current?.();
    const end = () => {
      alert.value = null;
      state.resolve(label);
    };
    dim.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: 'forwards' });
    const anim = panel.current?.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.96)' }], {
      duration: 160,
      easing: 'ease-in',
      fill: 'forwards',
    });
    anim ? anim.finished.then(end, end) : end();
  };

  useLayoutEffect(() => {
    dim.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: 'both' });
    springAnimate(panel.current!, [{ opacity: 0, transform: 'scale(1.12)' }, { opacity: 1, transform: 'scale(1)' }], { response: 0.3, damping: 0.9 });
    unregister.current = pushBack(() => finish(null, true));
    (panel.current!.querySelector('.alert-btn') as HTMLElement | null)?.focus({ preventScroll: true });
  }, []);

  const stacked = state.actions.length > 2 || state.actions.some((a) => a.label.length > 14);
  return (
    <div class="alert-layer">
      <div ref={dim} class="alert-dim" />
      <div ref={panel} class="alert glass" role="alertdialog" aria-modal="true" aria-labelledby="alert-title" aria-describedby="alert-message">
        <h2 id="alert-title" class="alert-title">
          {state.title}
        </h2>
        {state.message && (
          <p id="alert-message" class="alert-message">
            {state.message}
          </p>
        )}
        <div class={`alert-actions${stacked ? ' stacked' : ''}`}>
          {state.actions.map((a) => (
            <button type="button" class={`alert-btn ${a.style ?? 'default'}`} onClick={() => finish(a.label)} {...pressHandlers()}>
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
