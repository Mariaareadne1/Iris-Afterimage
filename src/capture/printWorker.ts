/// <reference lib="webworker" />
import { renderJob, type PrintJob } from './printRender.ts';

/** Renders full-resolution prints off the main thread and encodes PNG when OffscreenCanvas allows. */
self.onmessage = async (e: MessageEvent<{ id: number; job: PrintJob }>) => {
  const { id, job } = e.data;
  try {
    const px = renderJob(job);
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(px.width, px.height);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.putImageData(new ImageData(px.rgba as Uint8ClampedArray<ArrayBuffer>, px.width, px.height), 0, 0);
        const blob = await canvas.convertToBlob({ type: 'image/png' });
        (self as unknown as Worker).postMessage({ id, blob, width: px.width, height: px.height });
        return;
      }
    }
    (self as unknown as Worker).postMessage({ id, pixels: px }, [px.rgba.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : 'Render failed' });
  }
};
