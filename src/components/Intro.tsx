import { useApp, useSessionState } from './hooks.ts';

export function Intro() {
  const { session, embed } = useApp();
  const s = useSessionState();
  if (s.stage !== 'intro') return null;
  const ready = s.negatives.length > 0 && !s.loading;
  return (
    <section className={`intro ${embed ? 'intro--embed' : ''}`} aria-labelledby="intro-title">
      <div className="intro__inner">
        <p className="eyebrow">A darkroom in the browser</p>
        <h1 id="intro-title" className="wordmark">
          <span>IRIS</span>
          <span className="wordmark__slash">/</span>
          <span>AFTERIMAGE</span>
        </h1>
        <p className="intro__subtitle">An experiment in light, time, and memory.</p>
        {!embed && (
          <p className="intro__lede">
            Choose a negative, expose a sheet of paper under the enlarger, and watch your photograph surface in the developer.
          </p>
        )}
        <div className="intro__actions">
          <button className="btn btn--primary" disabled={!ready} onClick={() => session.enter('quick')} data-testid="enter-quick">
            {ready ? 'Make a print' : 'Warming the safelight…'}
          </button>
          <button className="btn btn--ghost" disabled={!ready} onClick={() => session.enter('manual')} data-testid="enter-manual">
            Manual darkroom
          </button>
        </div>
        {!embed && <p className="intro__note">Best with sound off and the lights low. Your photographs never leave this browser.</p>}
      </div>
    </section>
  );
}
