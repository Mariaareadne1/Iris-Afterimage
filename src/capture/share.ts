import type { PrintRecord } from '../session/session.ts';
import { printFilename } from './export.ts';

export type ShareResult = 'shared-file' | 'shared-link' | 'copied' | 'cancelled' | 'unavailable';

/** Public URL of the experience (without test/embed parameters). */
export function shareURL(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

/**
 * Share a finished print: the native share sheet with the PNG attached where
 * the browser supports file sharing, else the link, else copy the link.
 */
export async function sharePrint(rec: PrintRecord, png: Blob): Promise<ShareResult> {
  const url = shareURL();
  const title = 'Iris: Afterimage';
  const text = `A black-and-white print I made in a darkroom in the browser — “${rec.negative.meta.title}”.`;
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  try {
    if (typeof nav.share === 'function') {
      const file = new File([png], printFilename(rec, false), { type: 'image/png' });
      if (nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title, text: `${text} ${url}` });
        return 'shared-file';
      }
      await nav.share({ title, text, url });
      return 'shared-link';
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    // fall through to copying the link
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    return 'copied';
  } catch {
    return 'unavailable';
  }
}
