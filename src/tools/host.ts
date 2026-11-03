import type { Doc } from '../engine/document';
import type { CanvasInput, CanvasView, Overlay } from '../engine/canvasView';

export type ToolId = 'crop' | 'resize' | 'rotate' | 'markup' | 'privacy' | 'background' | 'compress' | 'resizeFor' | 'details' | 'export';

export interface ToolActions {
  /** ✓ in the sheet. Return false to stay open. */
  apply?: () => boolean | void | Promise<boolean | void>;
  /** ✕ in the sheet, a swipe down, or Back. */
  cancel?: () => void | Promise<void>;
  /** Hide ✓ (sheets that only show information or act through their own buttons). */
  noApply?: boolean;
  applyDisabled?: boolean;
}

/** What a tool gets from the editor. Tools register input and overlays in effects and clean up on unmount. */
export interface ToolHost {
  doc: Doc;
  view: CanvasView;
  setInput(input: CanvasInput | null): void;
  addOverlay(fn: Overlay): () => void;
  render(): void;
  setActions(a: ToolActions): void;
  /** DOM layer over the photo, for handles and text fields. */
  overlayEl: HTMLElement;
  /** Close the sheet after the tool has done its own work. */
  close(): void;
  /** Image pixels per screen point at the current zoom (brush sizes stay constant on screen). */
  pxPerPt(): number;
}

export const TOOL_TITLES: Record<ToolId, string> = {
  crop: 'Crop',
  resize: 'Resize',
  rotate: 'Rotate',
  markup: 'Markup',
  privacy: 'Privacy',
  background: 'Remove Background',
  compress: 'Compress',
  resizeFor: 'Resize For',
  details: 'Details',
  export: 'Export',
};
