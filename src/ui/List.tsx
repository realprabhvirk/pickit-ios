import type { ComponentChildren } from 'preact';
import { Icon, type IconName } from './Icon';
import { pressHandlers } from './press';

export function Section({ header, footer, children, id }: { header?: string; footer?: ComponentChildren; children: ComponentChildren; id?: string }) {
  return (
    <section class="section" id={id} aria-label={header}>
      {header && <h2 class="section-header">{header}</h2>}
      <div class="section-body">{children}</div>
      {footer && <p class="section-footer">{footer}</p>}
    </section>
  );
}

interface RowProps {
  title: ComponentChildren;
  subtitle?: ComponentChildren;
  detail?: ComponentChildren;
  icon?: IconName;
  /** Tile colour for the leading icon, e.g. 'var(--blue)'. */
  iconColor?: string;
  chevron?: boolean;
  checked?: boolean;
  accessory?: ComponentChildren;
  onClick?: () => void;
  destructive?: boolean;
  tinted?: boolean;
  stacked?: boolean;
  children?: ComponentChildren;
  id?: string;
  label?: string;
}

/** A grouped-list row in the style of Settings. Pressable when it has onClick. */
export function Row(p: RowProps) {
  const cls = [
    'row',
    p.icon ? 'has-icon' : '',
    p.onClick ? 'pressable' : '',
    p.destructive ? 'destructive' : '',
    p.tinted ? 'tinted' : '',
    p.stacked ? 'stacked' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const inner = (
    <>
      {p.icon && (
        <span class="row-icon" style={{ background: p.iconColor ?? 'var(--gray)' }} aria-hidden="true">
          <Icon name={p.icon} />
        </span>
      )}
      <span class="row-text">
        <span class="row-title">{p.title}</span>
        {p.subtitle && <span class="row-subtitle">{p.subtitle}</span>}
      </span>
      {p.detail !== undefined && <span class="row-detail">{p.detail}</span>}
      {p.accessory}
      {p.checked && <Icon name="checkmark" class="row-check" />}
      {p.chevron && <Icon name="chevron-right" class="row-chevron" />}
    </>
  );

  if (p.stacked) {
    return (
      <div class={cls} id={p.id}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>{inner}</div>
        {p.children}
      </div>
    );
  }
  if (p.onClick) {
    return (
      <button
        type="button"
        class={cls}
        id={p.id}
        aria-label={p.label}
        aria-checked={p.checked === undefined ? undefined : p.checked}
        role={p.checked === undefined ? undefined : 'menuitemradio'}
        onClick={p.onClick}
        {...pressHandlers()}
      >
        {inner}
      </button>
    );
  }
  return (
    <div class={cls} id={p.id}>
      {inner}
    </div>
  );
}
