import { pressHandlers } from './press';
import { haptic } from './haptics';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  id?: string;
}

/** iOS switch, 51 x 31 pt. The knob stretches toward its destination while pressed. */
export function Switch({ checked, onChange, label, disabled, id }: SwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      class="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        haptic();
        onChange(!checked);
      }}
      {...pressHandlers()}
    >
      <span class="switch-knob" />
    </button>
  );
}
