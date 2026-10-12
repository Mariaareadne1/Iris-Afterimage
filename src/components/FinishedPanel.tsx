import { useEffect, useRef, useState } from 'react';
import { downloadBlob, jobFromRecord, printFilename, renderPNG, thumbnailURL } from '../capture/export.ts';
import { DEVELOPER, gradeLabel } from '../photography/index.ts';
import type { PrintRecord } from '../session/session.ts';
import { formatSeconds, useApp, useSessionState } from './hooks.ts';

function describe(rec: PrintRecord): string {
  const ops = rec.field.ops;
  let burn = 0;
  let dodgeSeconds = 0;
  for (const op of ops) {
    if (op.kind === 'dodge') dodgeSeconds += op.seconds;
    if (op.kind === 'burn') burn += op.seconds;
  }
  const parts = [`${formatSeconds(rec.field.totalBaseSeconds)} exposure`, `grade ${gradeLabel(rec.settings.grade)}`];
  if (dodgeSeconds > 0.2) parts.push(`dodged ${formatSeconds(dodgeSeconds)}`);
  if (burn > 0.2) parts.push(`burned ${formatSeconds(burn)}`);
  if (rec.settings.framing.zoom > 1.01) parts.push(`cropped ×${rec.settings.framing.zoom.toFixed(2)}`);
  if (rec.dev.clock < DEVELOPER.recommendedMin) parts.push(`pulled at ${Math.round(rec.dev.clock)} s`);
  return parts.join(' · ');
}

/** Cache of rendered PNGs per print (object URLs), revoked when the app unloads. */
const pngCache = new Map<string, Promise<Blob>>();

export function printPNG(rec: PrintRecord, border: boolean): Promise<Blob> {
  const key = `${rec.id}:${border ? 'b' : 'c'}`;
  let p = pngCache.get(key);
  if (!p) {
    p = renderPNG(jobFromRecord(rec, undefined, border));
    p.catch(() => pngCache.delete(key));
    pngCache.set(key, p);
  }
  return p;
}

export function FinishedPanel({ onCapture }: { onCapture: () => void }) {
  const { session, embed } = useApp();
  const s = useSessionState();
  const [busy, setBusy] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = s.prints.find((p) => p.id === s.currentPrintId) ?? null;

  // contact-sheet thumbnail + warm the export cache in the background
  useEffect(() => {
    if (!rec || rec.thumb) return;
    let alive = true;
    const t = setTimeout(() => {
      thumbnailURL(rec).then((url) => alive && session.setPrintThumb(rec.id, url)).catch(() => undefined);
      printPNG(rec, false).catch(() => undefined);
    }, 900);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [rec, session]);

  if (s.stage !== 'finished' || !rec) return null;

  const download = async (border: boolean) => {
    setBusy(border ? 'border' : 'clean');
    setError(null);
    try {
      downloadBlob(await printPNG(rec, border), printFilename(rec, border));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not export the print.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <section className="panel panel--finished" aria-label="Finished print">
        <p className="eyebrow">Your print</p>
        <h2 className="finished__title">{rec.negative.meta.title}</h2>
        <p className="finished__meta" data-testid="print-recipe">{describe(rec)}</p>
        <div className="panel__row panel__row--wrap">
          <button className="btn btn--primary" onClick={() => download(false)} disabled={busy !== null} data-testid="download">
            {busy === 'clean' ? 'Printing file…' : 'Download print'}
          </button>
          <button className="btn btn--ghost" onClick={() => download(true)} disabled={busy !== null} data-testid="download-border">
            {busy === 'border' ? 'Printing file…' : 'With paper border'}
          </button>
          <button className="btn btn--ghost" onClick={() => setViewing(true)} data-testid="view-print">Inspect</button>
        </div>
        <div className="panel__row panel__row--wrap">
          <button className="btn btn--text" onClick={() => session.printAgain()} data-testid="print-again">Print again</button>
          <button className="btn btn--text" onClick={() => session.printAgain()} data-testid="another-negative">Try another negative</button>
          {!embed && <button className="btn btn--text" onClick={onCapture}>Share / capture</button>}
        </div>
        {error && <p className="panel__error" role="alert">{error}</p>}
      </section>
      {viewing && <PrintViewer rec={rec} onClose={() => setViewing(false)} />}
    </>
  );
}

export function PrintViewer({ rec, onClose }: { rec: PrintRecord; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    printPNG(rec, true).then((b) => {
      if (!alive) return;
      objectUrl = URL.createObjectURL(b);
      setUrl(objectUrl);
    });
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      alive = false;
      window.removeEventListener('keydown', onKey);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [rec, onClose]);
  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label="Print viewer" onClick={onClose}>
      <button ref={closeRef} className="viewer__close" onClick={onClose} aria-label="Close">×</button>
      {url ? (
        <img
          src={url}
          alt={`Black-and-white print of ${rec.negative.meta.title}`}
          className={`viewer__img ${zoom ? 'viewer__img--zoom' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setZoom(!zoom);
          }}
          data-testid="viewer-image"
        />
      ) : (
        <p className="viewer__loading">Printing at full resolution…</p>
      )}
      <p className="viewer__caption">{describe(rec)} — click to {zoom ? 'fit' : 'look closer'}</p>
    </div>
  );
}

export function Gallery({ onClose }: { onClose: () => void }) {
  const s = useSessionState();
  const [viewing, setViewing] = useState<PrintRecord | null>(null);
  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="Contact sheet" onClick={onClose}>
      <div className="sheet__inner" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__head">
          <p className="eyebrow">Contact sheet · this session</p>
          <button className="btn btn--text" onClick={onClose}>Close</button>
        </div>
        {s.prints.length === 0 ? (
          <p className="sheet__empty">No prints yet. Your finished prints collect here — they stay in this browser tab only.</p>
        ) : (
          <ul className="sheet__grid">
            {s.prints.map((p, i) => (
              <li key={p.id}>
                <button className="sheet__print" onClick={() => setViewing(p)}>
                  {p.thumb ? <img src={p.thumb} alt={p.negative.meta.title} /> : <span className="sheet__pending" />}
                  <span className="sheet__num">{String(s.prints.length - i).padStart(2, '0')}</span>
                  <span className="sheet__title">{p.negative.meta.title}</span>
                </button>
                <div className="sheet__actions">
                  <button className="btn btn--text" onClick={() => printPNG(p, false).then((b) => downloadBlob(b, printFilename(p, false)))}>PNG</button>
                  <button className="btn btn--text" onClick={() => printPNG(p, true).then((b) => downloadBlob(b, printFilename(p, true)))}>Bordered</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {viewing && <PrintViewer rec={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
