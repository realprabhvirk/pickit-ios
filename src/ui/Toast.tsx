import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { hideToast, toast, type ToastState } from '../app/overlays';
import { springAnimate } from '../design/motion';
import { Icon } from './Icon';
import { pressHandlers } from './press';

/** Glass capsule that drops out of the Dynamic Island area. */
export function ToastHost() {
  const t = toast.value;
  return <div class="toast-layer">{t && <ToastView key={t.id} t={t} />}</div>;
}

function ToastView({ t }: { t: ToastState }) {
  const el = useRef<HTMLDivElement>(null);

  const leave = () => {
    const node = el.current;
    if (!node) return hideToast(t.id);
    const a = springAnimate(node, [{ transform: 'translateY(0) scale(1)', opacity: 1 }, { transform: 'translateY(-60px) scale(0.6)', opacity: 0 }], {
      response: 0.3,
      damping: 1,
    });
    a.finished.then(() => hideToast(t.id), () => hideToast(t.id));
  };

  useLayoutEffect(() => {
    springAnimate(el.current!, [{ transform: 'translateY(-60px) scale(0.5)', opacity: 0 }, { transform: 'translateY(0) scale(1)', opacity: 1 }], {
      response: 0.42,
      damping: 0.78,
    });
  }, []);

  useEffect(() => {
    if (!t.duration) return;
    const id = setTimeout(leave, t.duration);
    return () => clearTimeout(id);
  }, []);

  return (
    <div ref={el} class="toast glass" role="status" aria-live="polite">
      {t.icon && <Icon name={t.icon} />}
      <div class="toast-text">
        <span class="toast-title">{t.title}</span>
        {t.subtitle && <span class="toast-sub">{t.subtitle}</span>}
      </div>
      {t.action && (
        <button
          type="button"
          class="toast-action"
          onClick={() => {
            t.action!.onPress();
            leave();
          }}
          {...pressHandlers()}
        >
          {t.action.label}
        </button>
      )}
      {t.dismissible && (
        <button type="button" class="toast-close" aria-label="Dismiss" onClick={leave}>
          <Icon name="xmark" />
        </button>
      )}
    </div>
  );
}
