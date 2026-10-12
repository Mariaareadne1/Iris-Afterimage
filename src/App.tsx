import { useEffect, useMemo, useRef, useState } from 'react';
import { DarkroomSession } from './session/session.ts';
import { Darkroom, WebGLUnavailableError } from './rendering/darkroom.ts';
import { AppContext, useSessionState } from './components/hooks.ts';
import { Intro } from './components/Intro.tsx';
import { TopBar } from './components/TopBar.tsx';
import { FilmStrip, NegativeCaption } from './components/FilmStrip.tsx';
import { EnlargerPanel, ManualControls } from './components/EnlargerPanel.tsx';
import { DevelopPanel, ProcessPanel } from './components/DevelopPanel.tsx';
import { FinishedPanel, Gallery } from './components/FinishedPanel.tsx';
import { CapturePanel } from './components/CapturePanel.tsx';
import { Messages } from './components/Messages.tsx';
import { Fallback2D } from './components/Fallback2D.tsx';
import { runShowcase } from './capture/showcase.ts';

export interface AppOptions {
  embed: boolean;
  speed: number;
  showcase: boolean;
  clean: boolean;
  mode: 'quick' | 'manual' | null;
}

export function readOptions(search = window.location.search): AppOptions {
  const q = new URLSearchParams(search);
  const flag = (k: string) => q.get(k) === '1' || q.get(k) === 'true';
  const speed = Number(q.get('speed'));
  const mode = q.get('mode');
  return {
    embed: flag('embed'),
    speed: Number.isFinite(speed) && speed > 0 && speed <= 40 ? speed : 1,
    showcase: flag('showcase'),
    clean: flag('capture'),
    mode: mode === 'manual' || mode === 'quick' ? mode : null,
  };
}

declare global {
  interface Window {
    __iris?: { session: DarkroomSession; room: Darkroom | null };
  }
}

export function App({ options }: { options: AppOptions }) {
  const session = useMemo(() => {
    const s = new DarkroomSession();
    s.speed = options.speed;
    return s;
  }, [options.speed]);
  const host = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState<Darkroom | null>(null);
  const [glError, setGlError] = useState<string | null>(null);
  const [gallery, setGallery] = useState(false);
  const [capture, setCapture] = useState(false);
  const [clean, setClean] = useState(options.clean);

  useEffect(() => {
    void session.init().then(() => {
      if (options.mode) session.enter(options.mode);
    });
  }, [session, options.mode]);

  useEffect(() => {
    if (!host.current) return;
    let r: Darkroom | null = null;
    try {
      r = new Darkroom(host.current, session);
      setRoom(r);
    } catch (e) {
      setGlError(e instanceof WebGLUnavailableError ? e.message : 'The 3D darkroom could not start on this device.');
    }
    window.__iris = { session, room: r };
    return () => {
      r?.dispose();
      setRoom(null);
    };
  }, [session]);

  // ?showcase=1 plays the automated demo once the first negative is loaded
  useEffect(() => {
    if (!options.showcase || !room) return;
    const ctrl = new AbortController();
    const unsub = session.store.subscribe(() => {
      if (session.state.negatives.length && !session.state.loading && session.negative) {
        unsub();
        setClean(true);
        void runShowcase(session, room, { signal: ctrl.signal }).catch(() => undefined);
      }
    });
    return () => {
      unsub();
      ctrl.abort();
    };
  }, [options.showcase, room, session]);

  useCameraInsets(room, clean);
  const ctx = useMemo(() => ({ session, room, embed: options.embed }), [session, room, options.embed]);

  return (
    <AppContext.Provider value={ctx}>
      <div className={`app ${options.embed ? 'app--embed' : ''} ${clean ? 'app--clean' : ''}`}>
        <div className="stage" ref={host} />
        {glError ? (
          <Fallback2D reason={glError} />
        ) : (
          <>
            <Vignette />
            <div className="chrome" aria-hidden={clean}>
              <Intro />
              <TopBar onGallery={() => setGallery(true)} onCapture={() => setCapture(true)} />
              <FilmStrip />
              <ManualControls />
              <div className="dock">
                <NegativeCaption />
                <EnlargerPanel />
                <DevelopPanel />
                <ProcessPanel />
                <FinishedPanel onCapture={() => setCapture(true)} />
              </div>
              <Messages />
            </div>
            {gallery && <Gallery onClose={() => setGallery(false)} />}
            {(capture || clean) && <CapturePanel onClose={() => setCapture(false)} clean={clean} setClean={setClean} />}
          </>
        )}
      </div>
    </AppContext.Provider>
  );
}

/**
 * Measure the screen area covered by the interface (top bar, film strip,
 * manual controls, bottom dock) and let the camera frame the scene around it.
 */
function useCameraInsets(room: Darkroom | null, clean: boolean) {
  useEffect(() => {
    if (!room) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      if (clean) {
        room.setInsets({ top: 0, right: 0, bottom: 0, left: 0 });
        return;
      }
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const box = (sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 ? r : null;
      };
      let top = box('.topbar')?.bottom ?? 0;
      let dockTop = vh;
      document.querySelectorAll('.dock > *').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.height > 0) dockTop = Math.min(dockTop, r.top);
      });
      const strip = box('.filmstrip');
      const controls = box('.controls');
      const vertical = !!strip && strip.height > strip.width;
      const left = strip && vertical ? strip.right : 0;
      if (strip && !vertical) top = Math.max(top, strip.bottom);
      const rail = !!controls && controls.left > vw * 0.5;
      const right = controls && rail ? vw - controls.left : 0;
      if (controls && !rail) dockTop = Math.min(dockTop, controls.top);
      room.setInsets({ top, bottom: vh - dockTop, left, right });
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    const chrome = document.querySelector('.app');
    const mo = new MutationObserver(schedule);
    if (chrome) mo.observe(chrome, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    const interval = setInterval(schedule, 800); // catches CSS animations settling
    schedule();
    return () => {
      mo.disconnect();
      window.removeEventListener('resize', schedule);
      clearInterval(interval);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [room, clean]);
}

/** A subtle red rim glow that breathes with the safelight. */
function Vignette() {
  const s = useSessionState();
  return <div className={`safeglow ${s.lightsOn ? 'safeglow--off' : ''}`} aria-hidden="true" />;
}
