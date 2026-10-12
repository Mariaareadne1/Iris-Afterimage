import { DEVELOPER } from '../photography/development.ts';
import { formatClock, useApp, useSessionState } from './hooks.ts';

export function DevelopPanel() {
  const { session, room } = useApp();
  const s = useSessionState();
  if (s.stage === 'transfer') {
    return (
      <section className="panel panel--compact" aria-label="Developer">
        <p className="panel__status" role="status">Into the developer — face up, quickly and evenly.</p>
      </section>
    );
  }
  if (s.stage !== 'developing') return null;
  const done = s.devProgress >= 1;
  const early = s.dev.clock < DEVELOPER.recommendedMin;
  const phase = s.dev.clock < 6 ? 'Nothing yet… the shadows come first.' : s.dev.clock < 18 ? 'The image is surfacing.' : done ? 'Fully developed.' : 'Mid-tones filling in.';
  return (
    <section className="panel panel--develop" aria-label="Developer">
      <div className="devclock">
        <span className="devclock__time" data-testid="dev-clock">{formatClock(s.dev.clock)}</span>
        <div className="meter meter--thin" aria-hidden="true"><span style={{ width: `${s.devProgress * 100}%` }} /></div>
        <span className="devclock__label" role="status" aria-live="polite">{phase}</span>
      </div>
      <div className="panel__row">
        <button
          className="btn btn--ghost"
          onClick={() => room?.rockTray(2.6)}
          data-testid="agitate"
          title="Rock the tray: fresh developer, more even development"
        >
          Rock the tray
        </button>
        {(s.mode === 'manual' || done) && (
          <button
            className={`btn ${done ? 'btn--primary btn--glow' : 'btn--ghost'}`}
            onClick={() => session.stopBath()}
            data-testid="stop-bath"
            title={early ? 'Pulling early leaves the print underdeveloped and flat' : ''}
          >
            {done ? 'Stop · fix · wash' : 'Pull it now'}
          </button>
        )}
      </div>
      <p className="panel__hint">
        {s.mode === 'manual' && early && !done
          ? 'Pulling early stops development: the print stays lighter and greyer.'
          : 'Drag the tray to rock it, or nudge the print — agitation evens out development.'}
      </p>
    </section>
  );
}

const STEPS = [
  { stage: 'stop', label: 'Stop bath', note: 'Development halts.' },
  { stage: 'fix', label: 'Fixer', note: 'Unexposed silver dissolves — the print becomes light-safe.' },
  { stage: 'wash', label: 'Wash', note: 'Lights on. Rinsing out the chemistry.' },
] as const;

export function ProcessPanel() {
  const s = useSessionState();
  const idx = STEPS.findIndex((x) => x.stage === s.stage);
  if (idx < 0) return null;
  return (
    <section className="panel panel--compact" aria-label="Processing">
      <ol className="process" role="status" aria-live="polite">
        {STEPS.map((step, i) => (
          <li key={step.stage} className={`process__step ${i < idx ? 'is-done' : i === idx ? 'is-current' : ''}`}>
            <span className="process__label">{step.label}</span>
            {i === idx && <span className="process__note">{step.note}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
