/**
 * Paper sheet and easel layout. Sheets are 8×10 inches, turned to match the
 * negative's orientation. The easel blades are set to the negative's aspect
 * with at least a half-inch white border, the classic full-frame print.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PrintLayout {
  /** sheet size in inches */
  sheetW: number;
  sheetH: number;
  /** image area in inches, origin top-left of the sheet */
  image: Rect;
  /** image area in sheet UV (0..1, v down) */
  imageUV: Rect;
  /** image-area aspect (w/h), equal to the negative's aspect */
  aspect: number;
}

export const SHEET_LONG_IN = 10;
export const SHEET_SHORT_IN = 8;
export const MIN_BORDER_IN = 0.5;

export function computeLayout(negWidth: number, negHeight: number): PrintLayout {
  if (!(negWidth > 0 && negHeight > 0)) throw new Error('Invalid negative size');
  const aspect = negWidth / negHeight;
  const landscape = aspect > 1.0001;
  const sheetW = landscape ? SHEET_LONG_IN : SHEET_SHORT_IN;
  const sheetH = landscape ? SHEET_SHORT_IN : SHEET_LONG_IN;
  const maxW = sheetW - 2 * MIN_BORDER_IN;
  const maxH = sheetH - 2 * MIN_BORDER_IN;
  let w = maxW;
  let h = w / aspect;
  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }
  // optically centred: a touch more border below than above, like a mat
  const x = (sheetW - w) / 2;
  const spare = sheetH - h;
  const y = spare * 0.46;
  return {
    sheetW,
    sheetH,
    aspect,
    image: { x, y, w, h },
    imageUV: { x: x / sheetW, y: y / sheetH, w: w / sheetW, h: h / sheetH },
  };
}

/** Output pixel size of the image area for a target long side. */
export function imagePixelSize(layout: PrintLayout, longSide: number): { width: number; height: number } {
  const a = layout.aspect;
  const n = Math.max(8, Math.round(longSide));
  return a >= 1
    ? { width: n, height: Math.max(8, Math.round(n / a)) }
    : { width: Math.max(8, Math.round(n * a)), height: n };
}
