import { useEffect, useRef, useState } from 'react';
import { CanvasRecorder, extensionFor, supportedVideoType } from '../capture/recorder.ts';
import { runShowcase } from '../capture/showcase.ts';
import { downloadBlob } from '../capture/export.ts';
import { printPNG } from './FinishedPanel.tsx';
import { printFilename } from '../capture/export.ts';
import { useApp, useSessionState } from './hooks.ts';

interface Props {
  onClose: () => void;
  /** hide all interface chrome while capturing */
  setClean: (clean: boolean) => void;
  clean: boolean;
}

export function CapturePanel({ onClose, setClean, clean }: Props) {
  const { session, room } = useApp();
  const s = useSessionState();
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [beat, setBeat] = useState<string | null>(null);
  const recorder = useRef<CanvasRecorder | null>(null);
  const abort = useRef<AbortController | null>(null);
  const mime = supportedVideoType();
  const rec = s.prints.find((p) => p.id === s.currentPrintId);

  useEffect(() => () => abort.current?.abort(), []);

  const startRecording = () => {
    if (!room) return;
    try {
      recorder.current = new CanvasRecorder(room.canvas);
      recorder.current.start();
      setRecording(true);
      setStatus(null);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Recording failed');
    }
  };

  const stopRecording = async () => {
    const r = recorder.current;
    if (!r) return;
    setRecording(false);
    const blob = await r.stop();
    const ext = extensionFor(r.mime);
    downloadBlob(blob, `iris-afterimage-${Date.now()}.${ext}`);
    setStatus(ext === 'webm' ? 'Saved as WebM. For MP4, run scripts/webm-to-mp4.sh on it.' : 'Saved as MP4.');
  };

  const showcase = async (record: boolean) => {
    if (!room) return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setClean(true);
    if (record && mime) startRecording();
    try {
      await runShowcase(session, room, { signal: ctrl.signal, onBeat: setBeat });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setStatus((e as Error).message);
    } finally {
      setBeat(null);
      if (record && recorder.current?.recording) await stopRecording();
      setClean(false);
    }
  };

  return (
    <>
      {beat && clean && <p className="beat" aria-live="polite">{beat}</p>}
      {clean ? (
        <button className="capture-exit" onClick={() => { abort.current?.abort(); if (recording) void stopRecording(); setClean(false); }} data-testid="capture-exit">
          {recording ? '■ Stop recording' : 'Show interface'}
        </button>
      ) : (
        <div className="sheet" role="dialog" aria-modal="true" aria-label="Capture and share" onClick={onClose}>
          <div className="sheet__inner sheet__inner--narrow" onClick={(e) => e.stopPropagation()}>
            <div className="sheet__head">
              <p className="eyebrow">Capture &amp; share</p>
              <button className="btn btn--text" onClick={onClose}>Close</button>
            </div>
            <div className="capture">
              <button className="btn btn--ghost" onClick={() => setClean(true)} data-testid="clean-mode">Hide interface</button>
              {mime ? (
                <button className="btn btn--ghost" onClick={recording ? stopRecording : startRecording} data-testid="record">
                  {recording ? '■ Stop & save' : `● Record the canvas (${extensionFor(mime).toUpperCase()})`}
                </button>
              ) : (
                <p className="panel__hint">Video recording isn’t supported in this browser.</p>
              )}
              <button className="btn btn--primary" onClick={() => { onClose(); void showcase(false); }} data-testid="showcase">
                ▶ Watch a print being made
              </button>
              {mime && (
                <button className="btn btn--ghost" onClick={() => { onClose(); void showcase(true); }} data-testid="showcase-record">
                  ▶ Record the showcase
                </button>
              )}
              {rec && (
                <button className="btn btn--ghost" onClick={() => printPNG(rec, true).then((b) => downloadBlob(b, printFilename(rec, true)))}>
                  Save the last print (PNG)
                </button>
              )}
              <p className="panel__hint">
                Recordings capture only the darkroom, never the interface. Use a 16:9 or 1:1 window for social video.
              </p>
              {status && <p className="panel__note" role="status">{status}</p>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export { runShowcase };
