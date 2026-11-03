import { signal } from '@preact/signals';
import type { IconName } from '../ui/Icon';

export interface MenuItem {
  label: string;
  icon?: IconName;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
}

export interface MenuState {
  anchor: DOMRect;
  items: MenuItem[];
  label: string;
}

export const menu = signal<MenuState | null>(null);

export function openMenu(anchorEl: Element, items: MenuItem[], label = 'Menu') {
  menu.value = { anchor: anchorEl.getBoundingClientRect(), items, label };
}

export interface AlertAction {
  label: string;
  style?: 'default' | 'cancel' | 'destructive' | 'preferred';
}

export interface AlertState {
  title: string;
  message?: string;
  actions: AlertAction[];
  resolve: (label: string | null) => void;
  /** A text field, for prompts (rename). */
  input?: { value: string; placeholder?: string; onInput: (v: string) => void };
}

export const alert = signal<AlertState | null>(null);

/** Shows an alert and resolves with the label of the button tapped (null if dismissed by back). */
export function showAlert(title: string, message: string | undefined, actions: AlertAction[]): Promise<string | null> {
  return new Promise((resolve) => {
    alert.value = { title, message, actions, resolve };
  });
}

/** A one-field prompt. Resolves with the text, or null if cancelled. */
export function showPrompt(title: string, message: string | undefined, value: string, okLabel = 'Save'): Promise<string | null> {
  let current = value;
  return new Promise((resolve) => {
    alert.value = {
      title,
      message,
      actions: [
        { label: 'Cancel', style: 'cancel' },
        { label: okLabel, style: 'preferred' },
      ],
      input: { value, onInput: (v) => (current = v) },
      resolve: (label) => resolve(label === okLabel ? current : null),
    };
  });
}

export interface ToastState {
  id: number;
  icon?: IconName;
  title: string;
  subtitle?: string;
  action?: { label: string; onPress: () => void };
  /** ms before it goes away by itself; 0 keeps it until dismissed. */
  duration: number;
  dismissible: boolean;
}

export const toast = signal<ToastState | null>(null);
let toastSeq = 0;

export function showToast(t: Omit<ToastState, 'id' | 'duration' | 'dismissible'> & { duration?: number; dismissible?: boolean }) {
  toast.value = { duration: 2600, dismissible: true, ...t, id: ++toastSeq };
}

export function hideToast(id?: number) {
  if (!toast.value) return;
  if (id === undefined || toast.value.id === id) toast.value = null;
}
