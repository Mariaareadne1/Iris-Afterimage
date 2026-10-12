import { useRef } from 'react';
import { ACCEPTED_TYPES } from '../session/negatives.ts';
import { useApp, useSessionState } from './hooks.ts';

/**
 * Negative selector styled as a strip of 35mm film on a light box: sprocket
 * holes, frame numbers, and the negatives in their true inverted tones.
 */
export function FilmStrip() {
  const { session } = useApp();
  const s = useSessionState();
  const input = useRef<HTMLInputElement>(null);
  if (s.stage !== 'enlarger' && s.stage !== 'finished') return null;
  const disabled = session.isBusy() || s.loading;
  return (
    <nav className="filmstrip" aria-label="Negatives">
      <div className="filmstrip__label">
        <span>Negatives</span>
        <span className="filmstrip__hint">{s.locked ? 'choosing a negative starts a new sheet' : 'choose a frame to print'}</span>
      </div>
      <div className="filmstrip__strip">
        <div className="filmstrip__sprockets" aria-hidden="true" />
        <ul className="filmstrip__frames">
          {s.negatives.map((n) => {
            const selected = n.id === s.selectedId;
            const thumb = s.thumbs[n.id];
            return (
              <li key={n.id}>
                <button
                  className={`frame ${selected ? 'frame--selected' : ''}`}
                  onClick={() => session.selectNegative(n.id)}
                  disabled={disabled && !selected}
                  aria-pressed={selected}
                  title={`${n.title}${n.author ? ` — ${n.author}` : ''}${n.year ? `, ${n.year}` : ''}`}
                  data-testid={`negative-${n.id}`}
                >
                  <span className="frame__num">{n.frame}</span>
                  {thumb ? (
                    <img src={thumb} alt="" />
                  ) : n.url ? (
                    <img src={n.url} alt="" className="frame__raw" />
                  ) : (
                    <span className="frame__blank">{n.title.slice(0, 18)}</span>
                  )}
                  <span className="frame__arrow" aria-hidden="true">▸</span>
                </button>
              </li>
            );
          })}
          <li>
            <button className="frame frame--import" onClick={() => input.current?.click()} disabled={disabled} data-testid="import-button">
              <span className="frame__num">+</span>
              <span className="frame__blank">Your photograph</span>
            </button>
            <input
              ref={input}
              type="file"
              accept={ACCEPTED_TYPES.join(',')}
              hidden
              data-testid="import-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) session.importFile(f);
                e.target.value = '';
              }}
            />
          </li>
        </ul>
        <div className="filmstrip__sprockets" aria-hidden="true" />
      </div>
      {s.loading && <p className="filmstrip__status" role="status">Developing the negative…</p>}
    </nav>
  );
}

export function NegativeCaption() {
  const { session } = useApp();
  const s = useSessionState();
  const neg = session.negative;
  if (!neg || (s.stage !== 'enlarger' && s.stage !== 'finished')) return null;
  const m = neg.meta;
  return (
    <p className="caption">
      <span className="caption__title">{m.title}</span>
      {m.author && <span> · {m.author}</span>}
      {m.year && <span>, {m.year}</span>}
      {m.license && (
        <span className="caption__license">
          {' '}
          — {m.source ? <a href={m.source} target="_blank" rel="noreferrer noopener">{m.license}</a> : m.license}
        </span>
      )}
    </p>
  );
}
