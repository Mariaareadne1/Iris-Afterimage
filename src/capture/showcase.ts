import type { DarkroomSession, SessionState } from '../session/session.ts';
import { FOCUS_SHARP } from '../photography/enlarger.ts';
import type { Darkroom } from '../rendering/darkroom.ts';

/**
 * Automated showcase driven through the real session API — the same calls a
 * visitor's clicks make. Negative in the enlarger, a focus pull, a dodged
 * exposure, the sheet carried into the developer, the image surfacing,
 * stop/fix/wash with the lights coming up, and the print hung on the line.
 */
export interface ShowcaseOptions {
  negativeId?: string;
  /** called on each narrative beat (for captions) */
  onBeat?: (text: string) => void;
  signal?: AbortSignal;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Showcase stopped', 'AbortError'));
    });
  });
}

function until(session: DarkroomSession, pred: (s: SessionState) => boolean, signal?: AbortSignal, timeoutMs = 120000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (pred(session.state)) return resolve();
    const timer = setTimeout(() => {
      unsub();
      reject(new Error('Showcase timed out'));
    }, timeoutMs);
    const unsub = session.store.subscribe(() => {
      if (pred(session.state)) {
        clearTimeout(timer);
        unsub();
        resolve();
      }
    });
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      unsub();
      reject(new DOMException('Showcase stopped', 'AbortError'));
    });
  });
}

export async function runShowcase(session: DarkroomSession, room: Darkroom, opts: ShowcaseOptions = {}): Promise<void> {
  const { signal, onBeat = () => undefined } = opts;
  const beat = (t: string) => onBeat(t);
  if (session.state.stage === 'intro') session.enter('manual');
  else if (session.state.stage !== 'enlarger') session.printAgain();
  session.setMode('manual');
  await until(session, (s) => s.negatives.length > 0 && !s.loading, signal);
  const id = opts.negativeId ?? session.state.negatives[0].id;
  if (session.state.selectedId !== id || session.state.locked) {
    session.printAgain();
    await session.selectNegative(id);
  }
  session.setTool('none');
  session.setGrade(2.5);
  session.setTime(session.state.suggestedTime);

  beat('A negative in the enlarger');
  session.setFocus(FOCUS_SHARP - 0.28);
  await sleep(1400, signal);
  beat('Bringing it into focus');
  const steps = 40;
  for (let i = 1; i <= steps; i++) {
    session.setFocus(FOCUS_SHARP - 0.28 * (1 - i / steps) * Math.cos((i / steps) * Math.PI * 0.5));
    await sleep(45, signal);
  }
  session.setFocus(FOCUS_SHARP);
  await sleep(900, signal);

  beat('Light through the negative');
  session.setTool('dodge');
  session.setToolRadius(0.16);
  session.expose();
  await until(session, (s) => s.lamp.mode === 'expose', signal);
  // dodge the lower-left foreground for part of the exposure, in a gentle circle
  const start = performance.now();
  while (session.state.lamp.mode === 'expose') {
    const t = (performance.now() - start) / 1000;
    if (t < session.state.lamp.duration * 0.45) {
      session.setToolPointer({ u: 0.24 + Math.cos(t * 4) * 0.035, v: 0.8 + Math.sin(t * 4) * 0.03 });
    } else {
      session.setToolPointer(null);
    }
    await sleep(16, signal);
  }
  session.setToolPointer(null);
  session.setTool('none');
  await sleep(900, signal);

  beat('The latent image, into the developer');
  session.develop();
  await until(session, (s) => s.stage === 'developing', signal);
  beat('Watching it appear');
  // the reveal is the centrepiece — but keep a social clip moving
  const baseSpeed = session.speed;
  session.speed = baseSpeed * 1.6;
  try {
    await sleep(2500, signal);
    room.rockTray(3);
    await until(session, (s) => s.dev.clock > 22, signal);
    room.rockTray(2.5);
    await until(session, (s) => s.devProgress >= 1, signal);
  } finally {
    session.speed = baseSpeed;
  }
  await sleep(1200, signal);

  beat('Stop, fix — lights on');
  session.stopBath();
  await until(session, (s) => s.stage === 'finished', signal);
  beat('The finished print');
  await sleep(7000, signal);
}
