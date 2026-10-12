import { useEffect } from 'react';
import { FOCUS_SHARP, GRADE_MAX, GRADE_MIN, gradeLabel, MAX_TIME, MAX_ZOOM, MIN_TIME, focusBlurFraction } from '../photography/index.ts';
import { formatSeconds, useApp, useSessionState } from './hooks.ts';

function focusReadout(focus: number): string {
  const blur = focusBlurFraction(focus);
  if (blur < 0.0008) return 'sharp';
  if (blur < 0.004) return 'slightly soft';
  if (blur < 0.012) return 'soft';
  return 'very soft';
}

/** Keyboard dodging/burning: arrow keys move the tool across the paper. */
function useToolKeys() {
  const { session } = useApp();
  const s = useSessionState();
  useEffect(() => {
    if (s.tool !== 'dodge' && s.tool !== 'burn') return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /input|textarea|select/i.test(target.tagName) && (target as HTMLInputElement).type !== 'button') return;
      const step = e.shiftKey ? 0.08 : 0.03;
      const cur = session.toolPosition ?? { u: 0.5, v: 0.5 };
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const m = moves[e.key];
      if (m) {
        e.preventDefault();
        session.setToolPointer({ u: Math.min(1.1, Math.max(-0.1, cur.u + m[0])), v: Math.min(1.1, Math.max(-0.1, cur.v + m[1])) });
      } else if (e.key === 'Escape') {
        session.setTool('none');
        session.setToolPointer(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s.tool, session]);
}

export function EnlargerPanel() {
  const { session } = useApp();
  const s = useSessionState();
  useToolKeys();
  if (s.stage !== 'enlarger') return null;
  const lampRunning = s.lamp.mode === 'expose' || s.lamp.mode === 'burn';
  const exposed = s.locked && s.exposedSeconds > 0;
  const placing = s.paper === 'placing';
  return (
    <section className="panel panel--enlarger" aria-label="Enlarger">
      {lampRunning ? (
        <ExposureProgress />
      ) : placing ? (
        <p className="panel__status" role="status">Sliding a fresh sheet onto the easel…</p>
      ) : (
        <>
          <div className="panel__primary">
            {exposed ? (
              <>
                <p className="panel__note">
                  The paper now holds a <em>latent image</em> — invisible until it meets the developer.
                </p>
                <div className="panel__row">
                  {s.mode === 'manual' && (
                    <button className="btn btn--ghost" onClick={() => session.expose()} data-testid="expose-again" title="Give the whole sheet more light">
                      Expose again · {formatSeconds(s.settings.time)}
                    </button>
                  )}
                  <button className="btn btn--primary btn--glow" onClick={() => session.develop()} data-testid="develop">
                    Into the developer
                  </button>
                </div>
                <p className="panel__hint">or pick the sheet up and drop it in the tray yourself</p>
              </>
            ) : (
              <>
                {s.mode === 'quick' && (
                  <p className="panel__note">
                    The enlarger is focused and timed with a test strip. When you’re ready, expose the paper.
                  </p>
                )}
                <div className="panel__row">
                  <button className="btn btn--primary btn--expose" onClick={() => session.expose()} disabled={s.loading || !session.negative} data-testid="expose">
                    <span className="btn__dot" aria-hidden="true" />
                    Expose · {formatSeconds(s.settings.time)}
                  </button>
                  {s.mode === 'quick' && (
                    <button className="btn btn--text" onClick={() => session.setMode('manual')}>
                      Adjust it yourself
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function ExposureProgress() {
  const { session } = useApp();
  const s = useSessionState();
  const remaining = Math.max(0, s.lamp.duration - s.lamp.elapsed);
  const pct = s.lamp.duration > 0 ? (s.lamp.elapsed / s.lamp.duration) * 100 : 0;
  const burning = s.lamp.mode === 'burn';
  return (
    <div className="exposing" role="status" aria-live="polite">
      <p className="exposing__label">{burning ? 'Burning in' : 'Exposing'}</p>
      <p className="exposing__time" data-testid="lamp-remaining">{remaining.toFixed(1)}</p>
      <div className="meter" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
      <p className="panel__hint">
        {s.tool === 'dodge'
          ? 'Hold the dodger over areas to keep lighter — keep it moving gently.'
          : burning
            ? 'Move the card’s hole over the areas that should go darker.'
            : 'Light is passing through the negative onto the paper.'}
      </p>
      <button className="btn btn--text" onClick={() => session.stopLamp()} data-testid="stop-lamp">
        Switch off
      </button>
    </div>
  );
}

/** The manual darkroom instruments, as a rail on the right (bottom drawer on phones). */
export function ManualControls() {
  const { session } = useApp();
  const s = useSessionState();
  if (s.stage !== 'enlarger' || s.mode !== 'manual') return null;
  const lampRunning = s.lamp.mode === 'expose' || s.lamp.mode === 'burn';
  const locked = s.locked || lampRunning;
  const f = s.settings.framing;
  return (
    <aside className="controls" aria-label="Enlarger controls" data-testid="manual-controls">
      {s.locked && (
        <div className="controls__lock">
          <span>Sheet exposed · enlarger locked</span>
          <button className="btn btn--text" onClick={() => session.printAgain()} data-testid="new-sheet">New sheet</button>
        </div>
      )}
      <fieldset className="control" disabled={locked}>
        <legend>Focus</legend>
        <input
          type="range" min={0} max={1} step={0.005} value={s.settings.focus}
          onChange={(e) => session.setFocus(Number(e.target.value))}
          aria-label="Focus" aria-valuetext={focusReadout(s.settings.focus)} data-testid="focus"
        />
        <div className="control__foot">
          <span className={`readout ${Math.abs(s.settings.focus - FOCUS_SHARP) < 0.01 ? 'readout--ok' : ''}`}>{focusReadout(s.settings.focus)}</span>
          <button className="btn btn--text" onClick={() => session.autoFocus()}>Grain focus</button>
        </div>
      </fieldset>

      <fieldset className="control" disabled={locked}>
        <legend>Time</legend>
        <div className="stepper">
          <button onClick={() => session.setTime(s.settings.time - 0.5)} aria-label="Shorter exposure">−</button>
          <input
            type="range" min={MIN_TIME} max={MAX_TIME / 2} step={0.5} value={s.settings.time}
            onChange={(e) => session.setTime(Number(e.target.value))} aria-label="Exposure time" data-testid="time"
          />
          <button onClick={() => session.setTime(s.settings.time + 0.5)} aria-label="Longer exposure">+</button>
        </div>
        <div className="control__foot">
          <span className="readout">{formatSeconds(s.settings.time)}</span>
          <button className="btn btn--text" onClick={() => session.setTime(s.suggestedTime)} title="What a test strip suggests for this negative">
            Test strip: {formatSeconds(s.suggestedTime)}
          </button>
        </div>
        <p className="control__hint">Longer = darker print.</p>
      </fieldset>

      <fieldset className="control" disabled={locked}>
        <legend>Contrast</legend>
        <input
          type="range" min={GRADE_MIN} max={GRADE_MAX} step={0.5} value={s.settings.grade}
          onChange={(e) => session.setGrade(Number(e.target.value))}
          aria-label="Contrast grade" aria-valuetext={`grade ${gradeLabel(s.settings.grade)}`} data-testid="grade"
        />
        <div className="control__foot">
          <span className="readout">grade {gradeLabel(s.settings.grade)}</span>
          <span className="control__hint">{s.settings.grade < 1.5 ? 'soft' : s.settings.grade > 3.5 ? 'hard' : 'normal'}</span>
        </div>
      </fieldset>

      <fieldset className="control" disabled={locked}>
        <legend>Framing</legend>
        <input
          type="range" min={1} max={MAX_ZOOM} step={0.01} value={f.zoom}
          onChange={(e) => session.setFraming({ ...f, zoom: Number(e.target.value) })} aria-label="Enlargement (crop)" data-testid="zoom"
        />
        <div className="control__foot">
          <button
            className={`chip ${s.tool === 'frame' ? 'chip--on' : ''}`}
            onClick={() => session.setTool(s.tool === 'frame' ? 'none' : 'frame')}
            aria-pressed={s.tool === 'frame'} data-testid="tool-frame"
          >
            Move image
          </button>
          <button className="btn btn--text" onClick={() => session.setFraming({ zoom: 1, offsetX: 0, offsetY: 0 })}>Full frame</button>
        </div>
      </fieldset>

      <fieldset className="control control--tools" disabled={s.lamp.mode === 'burn'}>
        <legend>Dodge &amp; burn</legend>
        <div className="segmented segmented--small" role="group" aria-label="Hand tools">
          <button aria-pressed={s.tool === 'none' || s.tool === 'frame'} onClick={() => session.setTool('none')}>Hands</button>
          <button aria-pressed={s.tool === 'dodge'} onClick={() => session.setTool('dodge')} data-testid="tool-dodge">Dodge</button>
          <button aria-pressed={s.tool === 'burn'} onClick={() => session.setTool('burn')} data-testid="tool-burn">Burn</button>
        </div>
        <p className="control__hint">
          {s.tool === 'burn'
            ? 'Burn — make an area darker. Give extra light through the card’s hole.'
            : 'Dodge — make an area lighter. Shade it during the exposure.'}
        </p>
        {(s.tool === 'dodge' || s.tool === 'burn') && (
          <>
            <input
              type="range" min={0.05} max={0.32} step={0.005} value={s.toolRadius}
              onChange={(e) => session.setToolRadius(Number(e.target.value))} aria-label="Tool size" data-testid="tool-size"
            />
            <p className="control__hint">Arrow keys move the tool · Esc puts it down</p>
          </>
        )}
        {s.tool === 'burn' && (
          <div className="panel__row">
            <div className="stepper stepper--compact">
              <button onClick={() => session.setBurnSeconds(s.burnSeconds - 1)} aria-label="Shorter burn">−</button>
              <span className="readout">{formatSeconds(s.burnSeconds)}</span>
              <button onClick={() => session.setBurnSeconds(s.burnSeconds + 1)} aria-label="Longer burn">+</button>
            </div>
            <button className="btn btn--ghost" onClick={() => session.burn()} disabled={!s.locked || lampRunning} data-testid="burn" title={s.locked ? '' : 'Make the main exposure first'}>
              Burn in
            </button>
          </div>
        )}
      </fieldset>
    </aside>
  );
}
