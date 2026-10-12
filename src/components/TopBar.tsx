import type { Stage } from '../session/session.ts';
import { useApp, useSessionState } from './hooks.ts';

const STEPS: { label: string; stages: Stage[] }[] = [
  { label: 'Negative', stages: [] },
  { label: 'Expose', stages: ['enlarger'] },
  { label: 'Develop', stages: ['transfer', 'developing'] },
  { label: 'Fix', stages: ['stop', 'fix', 'wash'] },
  { label: 'Print', stages: ['finished'] },
];

function stepIndex(stage: Stage, exposed: boolean): number {
  if (stage === 'enlarger') return exposed ? 1 : 0.5;
  const i = STEPS.findIndex((s) => s.stages.includes(stage));
  return i < 0 ? 0 : i;
}

interface TopBarProps {
  onGallery: () => void;
  onCapture: () => void;
}

export function TopBar({ onGallery, onCapture }: TopBarProps) {
  const { session, embed } = useApp();
  const s = useSessionState();
  if (s.stage === 'intro') return null;
  const idx = stepIndex(s.stage, s.locked);
  return (
    <header className="topbar">
      <button className="topbar__mark" onClick={() => window.location.reload()} title="Iris: Afterimage">
        IRIS <span>/</span> AFTERIMAGE
      </button>
      <ol className="steps" aria-label="Printing steps">
        {STEPS.map((step, i) => {
          const state = i < Math.floor(idx) ? 'done' : i === Math.ceil(idx) || i === Math.floor(idx) ? 'current' : 'todo';
          return (
            <li key={step.label} className={`steps__item steps__item--${state}`} aria-current={state === 'current' ? 'step' : undefined}>
              <span className="steps__num">{['I', 'II', 'III', 'IV', 'V'][i]}</span>
              <span className="steps__label">{step.label}</span>
            </li>
          );
        })}
      </ol>
      <div className="topbar__right">
        <div className="segmented" role="group" aria-label="Mode">
          <button aria-pressed={s.mode === 'quick'} onClick={() => session.setMode('quick')} data-testid="mode-quick">
            Quick print
          </button>
          <button aria-pressed={s.mode === 'manual'} onClick={() => session.setMode('manual')} data-testid="mode-manual">
            Darkroom
          </button>
        </div>
        {!embed && (
          <>
            <button className="iconbtn" onClick={onGallery} title="Contact sheet of this session's prints" aria-label="Prints from this session" data-testid="open-gallery">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M3 5h7v6H3zM14 5h7v6h-7zM3 14h7v6H3zM14 14h7v6h-7z" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>
              {s.prints.length > 0 && <span className="iconbtn__badge">{s.prints.length}</span>}
            </button>
            <button className="iconbtn" onClick={onCapture} title="Capture & share" aria-label="Capture and share" data-testid="open-capture">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.3" /><circle cx="12" cy="12" r="3" fill="currentColor" /></svg>
            </button>
          </>
        )}
      </div>
    </header>
  );
}
