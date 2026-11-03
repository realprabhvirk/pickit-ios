/**
 * The one mapping between viewport points (CSS px) and image pixels. Zooming and panning only
 * change this mapping, never the image. Ported from PicKit for Windows (Rendering/ViewTransform.cs)
 * with one addition: `insets`, the part of the viewport covered by floating chrome, so "fit"
 * means fit between the top buttons and the toolbar (or the sheet), while a zoomed image can
 * still slide under them.
 */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Limits {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export class ViewTransform {
  /** Device pixels per CSS px. "Actual size" means one image pixel per device pixel. */
  dpr = 1;
  /** Largest zoom, in image pixels per device pixel. */
  maxDeviceZoom = 16;
  /** Smallest zoom relative to fit while settled. */
  minFitFraction = 1;

  zoom = 1;
  offsetX = 0;
  offsetY = 0;
  imageWidth = 0;
  imageHeight = 0;
  viewportWidth = 0;
  viewportHeight = 0;
  insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  /** While true, viewport or inset changes re-fit the image rather than holding the zoom. */
  isFitted = true;

  get actualZoom() {
    return 1 / this.dpr;
  }

  get maxZoom() {
    return Math.max(this.maxDeviceZoom / this.dpr, this.fitZoom);
  }

  get minZoom() {
    return this.fitZoom * this.minFitFraction;
  }

  get availWidth() {
    return Math.max(1, this.viewportWidth - this.insets.left - this.insets.right);
  }

  get availHeight() {
    return Math.max(1, this.viewportHeight - this.insets.top - this.insets.bottom);
  }

  /** Zoom that shows the whole image inside the uncovered area. */
  get fitZoom() {
    if (this.imageWidth <= 0 || this.imageHeight <= 0) return 1;
    return Math.min(this.availWidth / this.imageWidth, this.availHeight / this.imageHeight);
  }

  setImage(width: number, height: number, refit: boolean) {
    this.imageWidth = width;
    this.imageHeight = height;
    if (refit) this.fit();
    else this.clamp();
  }

  setViewport(width: number, height: number) {
    this.viewportWidth = width;
    this.viewportHeight = height;
    if (this.isFitted) this.fit();
    else this.clamp();
  }

  setInsets(insets: Insets) {
    this.insets = { ...insets };
    if (this.isFitted) this.fit();
    else this.clamp();
  }

  imageToView(x: number, y: number) {
    return { x: x * this.zoom + this.offsetX, y: y * this.zoom + this.offsetY };
  }

  viewToImage(x: number, y: number) {
    return { x: (x - this.offsetX) / this.zoom, y: (y - this.offsetY) / this.zoom };
  }

  /** Shows the whole image in the uncovered area, centred. */
  fit() {
    this.isFitted = true;
    if (this.imageWidth <= 0 || this.imageHeight <= 0 || this.viewportWidth <= 0 || this.viewportHeight <= 0) return;
    this.zoom = this.fitZoom;
    this.clamp();
  }

  /** Zooms while keeping the image point under `anchor` stationary. */
  zoomAt(ax: number, ay: number, zoom: number, clamp = true) {
    this.isFitted = false;
    const ix = (ax - this.offsetX) / this.zoom;
    const iy = (ay - this.offsetY) / this.zoom;
    this.zoom = clamp ? Math.min(this.maxZoom, Math.max(this.minZoom, zoom)) : zoom;
    this.offsetX = ax - ix * this.zoom;
    this.offsetY = ay - iy * this.zoom;
    if (clamp) this.clamp();
  }

  panBy(dx: number, dy: number, clamp = true) {
    this.isFitted = false;
    this.offsetX += dx;
    this.offsetY += dy;
    if (clamp) this.clamp();
  }

  /** Allowed offsets at a zoom: centred on an axis that fits, otherwise no gap inside the uncovered area. */
  limitsAt(zoom: number): Limits {
    const axis = (size: number, start: number, avail: number) => {
      if (size <= avail) {
        const c = start + (avail - size) / 2;
        return [c, c] as const;
      }
      return [start + avail - size, start] as const;
    };
    const [minX, maxX] = axis(this.imageWidth * zoom, this.insets.left, this.availWidth);
    const [minY, maxY] = axis(this.imageHeight * zoom, this.insets.top, this.availHeight);
    return { minX, maxX, minY, maxY };
  }

  get limits(): Limits {
    return this.limitsAt(this.zoom);
  }

  clamp() {
    const l = this.limits;
    this.offsetX = Math.min(l.maxX, Math.max(l.minX, this.offsetX));
    this.offsetY = Math.min(l.maxY, Math.max(l.minY, this.offsetY));
  }

  /** Percentage shown in the UI, where 100% is one image pixel per device pixel. */
  get percent() {
    return Math.round(this.zoom * this.dpr * 100);
  }
}
