import type { PrintRecord } from '../session/session.ts';
import { EXPORT_LONG_SIDE, renderJob, type PrintJob, type PrintPixels } from './printRender.ts';

/**
 * Print export: re-renders the developed photograph from its recipe at high
 * resolution (in a worker when available) and encodes a PNG. The file is the
 * print itself — never a screenshot of the interface.
 */
export function jobFromRecord(rec: PrintRecord, longSide = EXPORT_LONG_SIDE, border = false): PrintJob {
  const neg = rec.negative.negative;
  return {
    transmittance: neg.transmittance.data,
    negWidth: neg.width,
    negHeight: neg.height,
    layout: rec.layout,
    settings: { framing: rec.settings.framing, focus: rec.settings.focus, grade: rec.settings.grade },
    fieldData: rec.field.data,
    fieldAspect: rec.field.aspect,
    fieldLong: rec.field.longSide,
    dev: rec.dev,
    longSide,
    border,
  };
}

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map<number, { resolve: (b: Blob) => void; reject: (e: Error) => void }>();

function pixelsToBlob(px: PrintPixels): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = px.width;
  canvas.height = px.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Canvas is unavailable'));
  ctx.putImageData(new ImageData(px.rgba as Uint8ClampedArray<ArrayBuffer>, px.width, px.height), 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'));
}

function getWorker(): Worker | null {
  if (workerBroken || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./printWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent) => {
      const { id, blob, pixels, error } = e.data as { id: number; blob?: Blob; pixels?: PrintPixels; error?: string };
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (error) p.reject(new Error(error));
      else if (blob) p.resolve(blob);
      else if (pixels) pixelsToBlob(pixels).then(p.resolve, p.reject);
    };
    worker.onerror = () => {
      workerBroken = true;
      for (const p of pending.values()) p.reject(new Error('Print worker failed'));
      pending.clear();
      worker = null;
    };
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

/** Render a job to a PNG blob. Falls back to the main thread if workers fail. */
export async function renderPNG(job: PrintJob): Promise<Blob> {
  const w = getWorker();
  if (w) {
    try {
      return await new Promise<Blob>((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        // copy the big buffers: the record keeps its own for later re-exports
        w.postMessage({ id, job: { ...job, transmittance: job.transmittance.slice(), fieldData: job.fieldData.slice() } });
      });
    } catch {
      workerBroken = true;
    }
  }
  return pixelsToBlob(renderJob(job));
}

export function printFilename(rec: PrintRecord, border: boolean): string {
  const slug = rec.negative.meta.id.replace(/[^\w-]/g, '').slice(0, 40) || 'print';
  const d = new Date(rec.createdAt);
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
  return `iris-afterimage-${slug}-${stamp}${border ? '-border' : ''}.png`;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Small in-memory thumbnail for the contact sheet. */
export async function thumbnailURL(rec: PrintRecord): Promise<string> {
  const px = renderJob(jobFromRecord(rec, 260, false));
  const canvas = document.createElement('canvas');
  canvas.width = px.width;
  canvas.height = px.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.putImageData(new ImageData(px.rgba as Uint8ClampedArray<ArrayBuffer>, px.width, px.height), 0, 0);
  return canvas.toDataURL('image/jpeg', 0.85);
}
