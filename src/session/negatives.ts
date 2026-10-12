import { fitDimensions } from '../photography/image.ts';
import { negativeFromRGBA, negativeViewingValue, type Negative } from '../photography/negative.ts';
import { linearToSrgb } from '../photography/color.ts';

/**
 * Loading negatives: bundled samples from `negatives/manifest.json` (swap
 * that folder to show your own work) and photographs imported locally. Imported
 * files never leave the browser: they are decoded with createImageBitmap,
 * downscaled on a canvas and turned into a negative in memory.
 */
export interface NegativeMeta {
  id: string;
  title: string;
  author: string;
  year: string;
  license: string;
  source: string;
  frame: string;
  url: string;
  imported?: boolean;
}

export interface LoadedNegative {
  meta: NegativeMeta;
  negative: Negative;
  /** light-box view of the negative (tonally inverted), small data URL */
  thumb: string;
}

/** Long side of the working negative; bounds memory for big scans. */
export const NEGATIVE_LONG_SIDE = 2000;
export const MAX_IMPORT_BYTES = 60 * 1024 * 1024;
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v.slice(0, 300) : fallback;
}

/** Parse and validate the manifest (never trust fetched JSON). */
export function parseManifest(json: unknown, baseUrl: string): NegativeMeta[] {
  const list = (json as { negatives?: unknown })?.negatives;
  if (!Array.isArray(list)) throw new Error('Negative manifest is missing a "negatives" list');
  const out: NegativeMeta[] = [];
  for (const raw of list) {
    const r = raw as Record<string, unknown>;
    const id = str(r.id);
    const file = str(r.file);
    if (!/^[\w-]{1,64}$/.test(id) || !/^[\w.-]{1,128}$/.test(file) || file.includes('..')) continue;
    out.push({
      id,
      title: str(r.title, 'Untitled'),
      author: str(r.author),
      year: str(r.year),
      license: str(r.license),
      source: /^https:\/\//.test(str(r.source)) ? str(r.source) : '',
      frame: str(r.frame, '00').slice(0, 3),
      url: `${baseUrl}${file}`,
    });
  }
  if (out.length === 0) throw new Error('Negative manifest has no usable entries');
  return out;
}

export async function loadManifest(baseUrl = `${import.meta.env.BASE_URL}negatives/`): Promise<NegativeMeta[]> {
  const res = await fetch(`${baseUrl}manifest.json`);
  if (!res.ok) throw new Error(`Could not load negatives (${res.status})`);
  return parseManifest(await res.json(), baseUrl);
}

function canvasFor(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Decode → downscale → RGBA. Releases the bitmap as soon as it is drawn. */
async function rasterize(source: Blob): Promise<ImageData> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This file could not be read as an image.');
  }
  try {
    if (bitmap.width < 16 || bitmap.height < 16) throw new Error('This image is too small to print.');
    const { width, height } = fitDimensions(bitmap.width, bitmap.height, NEGATIVE_LONG_SIDE);
    const canvas = canvasFor(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas is unavailable in this browser.');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height);
  } finally {
    bitmap.close();
  }
}

/** Light-box thumbnail of a negative: inverted tones on a faint warm base. */
export function negativeThumbnail(neg: Negative, longSide = 220): string {
  const { width, height } = fitDimensions(neg.width, neg.height, longSide);
  const canvas = canvasFor(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(width, height);
  const t = neg.transmittance;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = Math.min(t.width - 1, Math.floor(((x + 0.5) / width) * t.width));
      const sy = Math.min(t.height - 1, Math.floor(((y + 0.5) / height) * t.height));
      const v = linearToSrgb(negativeViewingValue(t.data[sy * t.width + sx]));
      const i = (y * width + x) * 4;
      // clear film base has a faint grey-violet cast
      img.data[i] = Math.round(v * 236);
      img.data[i + 1] = Math.round(v * 232);
      img.data[i + 2] = Math.round(v * 238);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.82);
}

function seedFor(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

async function fromBlob(meta: NegativeMeta, blob: Blob): Promise<LoadedNegative> {
  const data = await rasterize(blob);
  const negative = negativeFromRGBA(data.data, data.width, data.height, { seed: seedFor(meta.id) });
  return { meta, negative, thumb: negativeThumbnail(negative) };
}

export async function loadBundledNegative(meta: NegativeMeta): Promise<LoadedNegative> {
  const res = await fetch(meta.url);
  if (!res.ok) throw new Error(`Could not load “${meta.title}” (${res.status})`);
  return fromBlob(meta, await res.blob());
}

let importCounter = 0;

/** Import a local photograph. Throws user-friendly errors. */
export async function importNegative(file: File): Promise<LoadedNegative> {
  if (!file || file.size === 0) throw new Error('That file is empty.');
  if (file.type && !ACCEPTED_TYPES.includes(file.type)) {
    throw new Error('Please choose a JPEG, PNG, WebP, GIF or AVIF photograph.');
  }
  if (file.size > MAX_IMPORT_BYTES) throw new Error('That photograph is larger than 60 MB.');
  importCounter++;
  const name = file.name.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 60) || 'Your photograph';
  const meta: NegativeMeta = {
    id: `import-${Date.now().toString(36)}-${importCounter}`,
    title: name,
    author: 'Your photograph',
    year: '',
    license: 'Yours — stays in this browser',
    source: '',
    frame: String(30 + importCounter).padStart(2, '0'),
    url: '',
    imported: true,
  };
  return fromBlob(meta, file);
}
