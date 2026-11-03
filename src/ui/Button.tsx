import type { ComponentChildren, CSSProperties, HTMLAttributes } from 'preact';
import { Icon, type IconName } from './Icon';
import { pressHandlers } from './press';
import { haptic } from './haptics';

type Variant = 'glass' | 'clear' | 'tinted' | 'plain' | 'filled' | 'gray';

interface ButtonProps {
  icon?: IconName;
  label?: string;
  /** Accessible name when the button shows only an icon. */
  aria?: string;
  variant?: Variant;
  circle?: boolean;
  large?: boolean;
  tone?: 'light' | 'dark';
  disabled?: boolean;
  class?: string;
  style?: CSSProperties;
  onClick?: (e: MouseEvent) => void;
  children?: ComponentChildren;
  id?: string;
  'aria-haspopup'?: HTMLAttributes['aria-haspopup'];
  'aria-expanded'?: boolean;
  buttonRef?: (el: HTMLButtonElement | null) => void;
}

export function Button(props: ButtonProps) {
  const { icon, label, aria, variant = 'glass', circle, large, tone, disabled, onClick, children } = props;
  const glass = variant === 'glass' || variant === 'clear' || variant === 'tinted';
  const cls = [
    'btn',
    glass ? 'glass interactive' : variant,
    variant === 'clear' ? 'clear' : '',
    variant === 'tinted' ? 'tinted' : '',
    circle ? 'circle' : '',
    large ? 'large' : '',
    props.class ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      id={props.id}
      ref={props.buttonRef}
      type="button"
      class={cls}
      style={props.style}
      data-tone={tone}
      disabled={disabled}
      aria-label={aria ?? (label ? undefined : icon)}
      aria-haspopup={props['aria-haspopup']}
      aria-expanded={props['aria-expanded']}
      onClick={(e) => {
        haptic();
        onClick?.(e);
      }}
      {...pressHandlers()}
    >
      {icon && <Icon name={icon} />}
      {label && <span class="btn-label">{label}</span>}
      {children}
    </button>
  );
}

interface GroupButton {
  icon: IconName;
  aria: string;
  disabled?: boolean;
  onClick?: () => void;
}

/** Several icon buttons sharing one glass capsule. */
export function GlassGroup({
  buttons,
  clear,
  tone,
  class: cls,
}: {
  buttons: GroupButton[];
  clear?: boolean;
  tone?: 'light' | 'dark';
  class?: string;
}) {
  return (
    <div class={`glass glass-group${clear ? ' clear' : ''}${cls ? ` ${cls}` : ''}`} data-tone={tone} role="group">
      {buttons.map((b) => (
        <button
          type="button"
          class="btn circle"
          aria-label={b.aria}
          disabled={b.disabled}
          onClick={() => {
            haptic();
            b.onClick?.();
          }}
          {...pressHandlers()}
        >
          <Icon name={b.icon} />
        </button>
      ))}
    </div>
  );
}
