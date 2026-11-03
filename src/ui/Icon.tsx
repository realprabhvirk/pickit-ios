import sprite from '../assets/icons.svg?raw';

export type IconName =
  | 'xmark' | 'chevron-left' | 'chevron-right' | 'chevron-down' | 'checkmark' | 'plus'
  | 'undo' | 'redo' | 'share' | 'ellipsis'
  | 'crop' | 'resize' | 'rotate' | 'markup' | 'privacy' | 'background' | 'compress' | 'resize-for' | 'details'
  | 'photo' | 'photo-stack' | 'paste' | 'gear' | 'stack' | 'add-home' | 'grid'
  | 'drop' | 'location-slash' | 'wifi-slash' | 'drive' | 'motion' | 'waveform' | 'doc' | 'lock' | 'slider'
  | 'arrow-down-circle' | 'trash'
  | 'rotate-left' | 'flip-h' | 'flip-v' | 'highlighter' | 'arrow' | 'line' | 'square' | 'rounded' | 'circle' | 'text'
  | 'eraser' | 'select' | 'brush' | 'plus-circle' | 'minus-circle' | 'copy' | 'folder' | 'pencil' | 'zip';

/** Puts the one icon sprite into the document, once. Every <Icon> references a symbol in it. */
export function installIconSprite() {
  if (document.getElementById('pk-icons')) return;
  const holder = document.createElement('div');
  holder.id = 'pk-icons';
  holder.setAttribute('aria-hidden', 'true');
  holder.style.display = 'none';
  holder.innerHTML = sprite;
  document.body.prepend(holder);
}

interface IconProps {
  name: IconName;
  size?: number;
  class?: string;
  label?: string;
}

export function Icon({ name, size, class: cls, label }: IconProps) {
  return (
    <svg
      class={`icon${cls ? ` ${cls}` : ''}`}
      style={size ? { fontSize: `${size}px` } : undefined}
      viewBox="0 0 24 24"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
      focusable="false"
    >
      <use href={`#i-${name}`} />
    </svg>
  );
}
