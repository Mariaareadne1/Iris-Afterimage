import { useEffect, useRef } from 'react';
import { densityToSrgb, developImage, negativeViewingValue, linearToSrgb } from '../photography/index.ts';
import { useApp, useSessionState } from './hooks.ts';
import { Intro } from './Intro.tsx';
import { FilmStrip, NegativeCaption } from './FilmStrip.tsx';
import { EnlargerPanel } from './EnlargerPanel.tsx';
import { DevelopPanel, ProcessPanel } from './DevelopPanel.tsx';
import { FinishedPanel } from './FinishedPanel.tsx';
import { Messages } from './Messages.tsx';

/**
 * Without WebGL the darkroom still works: the same session and photographic
 * model drive a flat 2D view of the easel and the developing tray.
 */
export function Fallback2D({ reason }: { reason: string }) {
  const { session } = useApp();
  const s = useSessionState();
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      session.tick((now - last) / 1000);
      last = now;
      draw();
    };
    const draw = () => {
      const c = canvas.current;
      const st = session.state;
      const proj = session.projection;
      if (!c || !proj) return;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      const scale = 0.5;
      const w = Math.round(proj.width * scale);
      const h = Math.round(proj.height * scale);
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      const img = ctx.createImageData(w, h);
      const fill = (fn: (sx: number, sy: number) => [number, number, number]) => {
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const [r, g, b] = fn(Math.floor(x / scale), Math.floor(y / scale));
            const i = (y * w + x) * 4;
            img.data[i] = r;
            img.data[i + 1] = g;
            img.data[i + 2] = b;
            img.data[i + 3] = 255;
          }
      };
      const developed = ['developing', 'stop', 'fix', 'wash', 'finished'].includes(st.stage);
      if (developed && session.finalDensity && session.onset) {
        const d = developImage(session.finalDensity, session.onset, st.dev);
        const lit = st.lightsOn;
        fill((sx, sy) => {
          const v = densityToSrgb(d.data[sy * d.width + sx]) * 255;
          return lit ? [v, v, v] : [v, v * 0.22, v * 0.12];
        });
      } else if (st.lamp.mode !== 'off' && st.stage === 'enlarger') {
        fill((sx, sy) => {
          const v = linearToSrgb(negativeViewingValue(proj.data[sy * proj.width + sx])) * 255;
          return [v, v * 0.9, v * 0.72];
        });
      } else {
        fill(() => [150, 34, 20]);
      }
      ctx.putImageData(img, 0, 0);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [session]);

  return (
    <div className="fallback">
      <p className="fallback__note" role="note">
        {reason}. Showing the flat darkroom instead — every print is still made with the full photographic model.
      </p>
      {s.stage !== 'intro' && <canvas ref={canvas} className="fallback__canvas" aria-label="Easel and developing tray" />}
      <div className="chrome">
        <Intro />
        <div className="dock">
          <FilmStrip />
          <NegativeCaption />
          <EnlargerPanel />
          <DevelopPanel />
          <ProcessPanel />
          <FinishedPanel onCapture={() => undefined} />
        </div>
        <Messages />
      </div>
    </div>
  );
}
