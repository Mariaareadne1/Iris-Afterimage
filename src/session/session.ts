import {
  advanceDevelopment,
  clampFraming,
  computeLayout,
  computeOnsetMaps,
  DEFAULT_FRAMING,
  DEFAULT_GRADE,
  developmentProgress,
  DEVELOPER,
  ExposureField,
  finalDensity,
  FOCUS_SHARP,
  GRADE_MAX,
  GRADE_MIN,
  imagePixelSize,
  initialDevelopState,
  MAX_TIME,
  MIN_TIME,
  projectNegative,
  suggestExposureTime,
  type DevelopState,
  type Framing,
  type GrayImage,
  type OnsetMaps,
  type PrintLayout,
} from '../photography/index.ts';
import { Store } from './store.ts';
import {
  importNegative,
  loadBundledNegative,
  loadManifest,
  type LoadedNegative,
  type NegativeMeta,
} from './negatives.ts';

export type Stage = 'intro' | 'enlarger' | 'transfer' | 'developing' | 'stop' | 'fix' | 'wash' | 'finished';
export type Mode = 'quick' | 'manual';
export type Tool = 'none' | 'dodge' | 'burn' | 'frame';
export type LampMode = 'off' | 'focus' | 'expose' | 'burn';
export type PaperPhase = 'safe' | 'placing' | 'easel';

export interface Settings {
  focus: number;
  grade: number;
  /** base exposure time in seconds */
  time: number;
  framing: Framing;
}

export interface LampState {
  mode: LampMode;
  elapsed: number;
  duration: number;
}

export interface PrintRecord {
  id: string;
  negative: LoadedNegative;
  layout: PrintLayout;
  settings: Settings;
  field: ExposureField;
  dev: DevelopState;
  thumb: string;
  createdAt: number;
}

export interface SessionState {
  stage: Stage;
  /** seconds since the stage began (simulated time) */
  stageTime: number;
  mode: Mode;
  negatives: NegativeMeta[];
  thumbs: Record<string, string>;
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  notice: string | null;
  settings: Settings;
  suggestedTime: number;
  /** settings are locked once the current sheet has seen light */
  locked: boolean;
  paper: PaperPhase;
  tool: Tool;
  toolRadius: number;
  burnSeconds: number;
  lamp: LampState;
  exposedSeconds: number;
  burnedSeconds: number;
  dev: DevelopState;
  devProgress: number;
  lightsOn: boolean;
  prints: PrintRecord[];
  currentPrintId: string | null;
  /** bumps whenever the projection image changes */
  projectionVersion: number;
  /** bumps whenever the latent/final density changes */
  latentVersion: number;
}

/** Working resolution for interactive textures (long side, px). */
export const WORK_LONG = 640;
export const DEFAULT_TOOL_RADIUS = 0.14;
export const TOOL_FEATHER = 0.85;

/** Durations of automated stages, in simulated seconds. */
export const STAGE_SECONDS = {
  place: 1.3,
  transfer: 2.6,
  stop: 2.4,
  fix: 3.6,
  wash: 3.0,
} as const;

const initialSettings: Settings = {
  focus: FOCUS_SHARP,
  grade: DEFAULT_GRADE,
  time: 8,
  framing: DEFAULT_FRAMING,
};

export class DarkroomSession {
  readonly store: Store<SessionState>;
  /** simulated seconds per real second (tests and showcase may raise this) */
  speed = 1;

  private cache = new Map<string, LoadedNegative>();
  private current: LoadedNegative | null = null;
  layout: PrintLayout | null = null;
  field: ExposureField | null = null;
  projection: GrayImage | null = null;
  finalDensity: GrayImage | null = null;
  onset: OnsetMaps | null = null;
  private projectionDirty = false;
  private toolUV: { u: number; v: number } | null = null;
  private agitationInput = 0;
  private loadToken = 0;
  private printCounter = 0;

  constructor() {
    this.store = new Store<SessionState>({
      stage: 'intro',
      stageTime: 0,
      mode: 'quick',
      negatives: [],
      thumbs: {},
      selectedId: null,
      loading: false,
      error: null,
      notice: null,
      settings: initialSettings,
      suggestedTime: 8,
      locked: false,
      paper: 'safe',
      tool: 'none',
      toolRadius: DEFAULT_TOOL_RADIUS,
      burnSeconds: 4,
      lamp: { mode: 'off', elapsed: 0, duration: 0 },
      exposedSeconds: 0,
      burnedSeconds: 0,
      dev: initialDevelopState(),
      devProgress: 0,
      lightsOn: false,
      prints: [],
      currentPrintId: null,
      projectionVersion: 0,
      latentVersion: 0,
    });
  }

  get state(): SessionState {
    return this.store.get();
  }

  get negative(): LoadedNegative | null {
    return this.current;
  }

  get toolPosition(): { u: number; v: number } | null {
    return this.toolUV;
  }

  // ───────────────────────────── loading ─────────────────────────────

  async init(): Promise<void> {
    try {
      const negatives = await loadManifest();
      this.store.set({ negatives });
      await this.selectNegative(negatives[0].id);
    } catch (e) {
      this.fail(e);
    }
  }

  private fail(e: unknown) {
    const msg = e instanceof Error ? e.message : 'Something went wrong in the darkroom.';
    this.store.set({ error: msg, loading: false });
  }

  dismissMessage() {
    this.store.set({ error: null, notice: null });
  }

  async selectNegative(id: string): Promise<void> {
    if (this.isBusy()) return;
    const meta = this.state.negatives.find((n) => n.id === id);
    if (!meta) return;
    const token = ++this.loadToken;
    this.store.set({ loading: true, error: null, selectedId: id });
    try {
      let loaded = this.cache.get(id);
      if (!loaded) {
        loaded = await loadBundledNegative(meta);
        this.cache.set(id, loaded);
      }
      if (token !== this.loadToken) return;
      this.store.set({ thumbs: { ...this.state.thumbs, [id]: loaded.thumb } });
      this.useNegative(loaded);
    } catch (e) {
      if (token === this.loadToken) this.fail(e);
    }
  }

  async importFile(file: File): Promise<void> {
    if (this.isBusy()) return;
    const token = ++this.loadToken;
    this.store.set({ loading: true, error: null });
    try {
      const loaded = await importNegative(file);
      if (token !== this.loadToken) return;
      this.cache.set(loaded.meta.id, loaded);
      this.store.set({
        negatives: [...this.state.negatives, loaded.meta],
        thumbs: { ...this.state.thumbs, [loaded.meta.id]: loaded.thumb },
        selectedId: loaded.meta.id,
      });
      this.useNegative(loaded);
    } catch (e) {
      if (token === this.loadToken) this.fail(e);
    }
  }

  /** Busy = paper is in chemistry or the lamp is on; negatives can't change then. */
  isBusy(): boolean {
    const s = this.state;
    return s.lamp.mode === 'expose' || s.lamp.mode === 'burn' || !['intro', 'enlarger', 'finished'].includes(s.stage);
  }

  private useNegative(loaded: LoadedNegative) {
    this.current = loaded;
    this.layout = computeLayout(loaded.negative.width, loaded.negative.height);
    // a new negative means a fresh sheet and recentred framing
    const settings = { ...this.state.settings, framing: DEFAULT_FRAMING };
    this.store.set({ settings, loading: false });
    this.freshSheet();
    this.rebuildProjection();
    const suggested = suggestExposureTime(this.projection!.data);
    const time = this.state.mode === 'quick' || !this.state.locked ? suggested : this.state.settings.time;
    this.store.set({ suggestedTime: suggested, settings: { ...this.state.settings, time } });
    if (this.state.stage === 'finished') this.goto('enlarger');
  }

  private rebuildProjection() {
    if (!this.current || !this.layout) return;
    const { width, height } = imagePixelSize(this.layout, WORK_LONG);
    const s = this.state.settings;
    this.projection = projectNegative(this.current.negative, s.framing, s.focus, width, height);
    this.projectionDirty = false;
    this.store.set({ projectionVersion: this.state.projectionVersion + 1 });
  }

  // ───────────────────────────── stages ─────────────────────────────

  enter(mode: Mode) {
    this.store.set({ mode });
    if (this.state.stage === 'intro') this.goto('enlarger');
  }

  setMode(mode: Mode) {
    // both modes share the same pipeline and state; only the controls differ
    this.store.set({ mode, tool: mode === 'quick' ? 'none' : this.state.tool });
  }

  private goto(stage: Stage) {
    const lamp: LampState =
      stage === 'enlarger' && this.state.paper !== 'easel' ? { mode: 'focus', elapsed: 0, duration: 0 } : { mode: 'off', elapsed: 0, duration: 0 };
    this.store.set({ stage, stageTime: 0, lamp });
  }

  /** Discard the current sheet: new paper, unlocked settings, cleared chemistry. */
  freshSheet() {
    if (this.layout) this.field = new ExposureField(this.layout.aspect, 256);
    this.finalDensity = null;
    this.onset = null;
    this.store.set({
      locked: false,
      paper: 'safe',
      exposedSeconds: 0,
      burnedSeconds: 0,
      dev: initialDevelopState(Math.floor(Math.random() * 1e6)),
      devProgress: 0,
      lightsOn: false,
      currentPrintId: null,
      lamp: { mode: this.state.stage === 'enlarger' || this.state.stage === 'intro' ? 'focus' : 'off', elapsed: 0, duration: 0 },
    });
  }

  printAgain() {
    this.freshSheet();
    this.goto('enlarger');
  }

  // ───────────────────────────── enlarger ─────────────────────────────

  private updateSettings(patch: Partial<Settings>) {
    if (this.state.locked) {
      this.store.set({ notice: 'This sheet has been exposed — start a new sheet to change the enlarger.' });
      return;
    }
    const s = { ...this.state.settings, ...patch };
    s.focus = Math.min(Math.max(Number.isFinite(s.focus) ? s.focus : FOCUS_SHARP, 0), 1);
    s.grade = Math.min(Math.max(Number.isFinite(s.grade) ? s.grade : DEFAULT_GRADE, GRADE_MIN), GRADE_MAX);
    s.time = Math.round(Math.min(Math.max(Number.isFinite(s.time) ? s.time : 8, MIN_TIME), MAX_TIME) * 2) / 2;
    s.framing = clampFraming(s.framing);
    const opticsChanged = s.focus !== this.state.settings.focus || s.framing !== this.state.settings.framing;
    this.store.set({ settings: s });
    if (opticsChanged) this.projectionDirty = true;
  }

  setFocus(focus: number) {
    this.updateSettings({ focus });
  }
  setGrade(grade: number) {
    this.updateSettings({ grade });
  }
  setTime(time: number) {
    this.updateSettings({ time });
  }
  setFraming(framing: Framing) {
    this.updateSettings({ framing });
  }
  /** Drag the projected image by a delta in image-area UV. */
  nudgeFraming(du: number, dv: number) {
    const f = this.state.settings.framing;
    this.setFraming({ ...f, offsetX: f.offsetX - du / f.zoom, offsetY: f.offsetY - dv / f.zoom });
  }
  autoFocus() {
    this.setFocus(FOCUS_SHARP);
  }

  setTool(tool: Tool) {
    this.store.set({ tool });
  }
  setToolRadius(r: number) {
    this.store.set({ toolRadius: Math.min(Math.max(r, 0.04), 0.35) });
  }
  setBurnSeconds(s: number) {
    this.store.set({ burnSeconds: Math.round(Math.min(Math.max(s, 1), 30) * 2) / 2 });
  }
  /** Pointer position over the paper's image area (UV), or null when off it. */
  setToolPointer(uv: { u: number; v: number } | null) {
    this.toolUV = uv && Number.isFinite(uv.u) && Number.isFinite(uv.v) ? { u: uv.u, v: uv.v } : null;
  }

  /** Base exposure: place paper if needed, then run the lamp for the set time. */
  expose() {
    const s = this.state;
    if (s.stage !== 'enlarger' || s.lamp.mode === 'expose' || s.lamp.mode === 'burn' || !this.current) return;
    if (this.projectionDirty) this.rebuildProjection();
    if (s.tool === 'burn' || s.tool === 'frame') this.store.set({ tool: 'none' });
    if (s.paper !== 'easel') {
      this.store.set({ paper: 'placing', stageTime: 0, lamp: { mode: 'off', elapsed: 0, duration: 0 } });
      this.pendingExposure = 'expose';
      return;
    }
    this.startLamp('expose', s.settings.time);
  }

  /** Burn-in: extra light only through the card's aperture. */
  burn() {
    const s = this.state;
    if (s.stage !== 'enlarger' || s.paper !== 'easel' || s.lamp.mode === 'expose' || s.lamp.mode === 'burn') return;
    if (!s.locked) {
      this.store.set({ notice: 'Make the main exposure first, then burn in.' });
      return;
    }
    this.store.set({ tool: 'burn' });
    this.startLamp('burn', s.burnSeconds);
  }

  stopLamp() {
    const m = this.state.lamp.mode;
    if (m === 'expose' || m === 'burn') this.store.set({ lamp: { mode: 'off', elapsed: 0, duration: 0 } });
  }

  private pendingExposure: 'expose' | null = null;

  private startLamp(mode: 'expose' | 'burn', duration: number) {
    this.store.set({ locked: true, lamp: { mode, elapsed: 0, duration } });
  }

  // ───────────────────────────── development ─────────────────────────────

  /** Move the exposed sheet to the developer. */
  develop() {
    const s = this.state;
    if (s.stage !== 'enlarger' || s.paper !== 'easel' || s.lamp.mode === 'expose' || s.lamp.mode === 'burn') return;
    if (!this.field?.isExposed) {
      this.store.set({ notice: 'The paper has not seen any light yet — expose it first.' });
      return;
    }
    this.computeLatent();
    this.goto('transfer');
  }

  /** Fully developed density for the current sheet: the latent image. */
  private computeLatent() {
    if (!this.projection || !this.field) return;
    if (this.projectionDirty) this.rebuildProjection();
    this.finalDensity = finalDensity(this.projection!, this.field, this.state.settings.grade);
    this.onset = computeOnsetMaps(this.finalDensity, this.state.dev);
    this.store.set({ latentVersion: this.state.latentVersion + 1 });
  }

  /** Agitation input for this frame (0..1), e.g. from rocking the tray. */
  agitate(amount: number) {
    this.agitationInput = Math.max(this.agitationInput, Math.min(Math.max(amount, 0), 1));
  }

  /** Pull the print into the stop bath (allowed any time; early = underdeveloped). */
  stopBath() {
    if (this.state.stage !== 'developing') return;
    this.goto('stop');
  }

  // ───────────────────────────── tick ─────────────────────────────

  /** Advance the simulation by a real-time step. */
  tick(realDt: number) {
    const dt = Math.min(Math.max(realDt, 0), 0.25) * this.speed;
    if (dt <= 0) return;
    if (this.projectionDirty && this.state.lamp.mode !== 'expose') this.rebuildProjection();
    const s = this.state;
    const stageTime = s.stageTime + dt;

    switch (s.stage) {
      case 'enlarger':
        this.tickEnlarger(dt, stageTime);
        break;
      case 'transfer':
        if (stageTime >= STAGE_SECONDS.transfer) this.goto('developing');
        else this.store.set({ stageTime });
        break;
      case 'developing': {
        const dev = advanceDevelopment(s.dev, dt, this.agitationInput);
        this.store.set({ dev, devProgress: developmentProgress(dev), stageTime });
        break;
      }
      case 'stop':
        if (stageTime >= STAGE_SECONDS.stop) this.goto('fix');
        else this.store.set({ stageTime });
        break;
      case 'fix':
        // the print is light-safe once fixed: the room lights come on
        if (stageTime >= STAGE_SECONDS.fix) {
          this.store.set({ lightsOn: true });
          this.goto('wash');
        } else this.store.set({ stageTime });
        break;
      case 'wash':
        if (stageTime >= STAGE_SECONDS.wash) this.finish();
        else this.store.set({ stageTime });
        break;
      default:
        this.store.set({ stageTime });
    }
    this.agitationInput = 0;
  }

  private tickEnlarger(dt: number, stageTime: number) {
    const s = this.state;
    if (s.paper === 'placing') {
      if (stageTime >= STAGE_SECONDS.place) {
        this.store.set({ paper: 'easel', stageTime });
        if (this.pendingExposure) {
          this.pendingExposure = null;
          this.startLamp('expose', s.settings.time);
        }
      } else this.store.set({ stageTime });
      return;
    }
    const lamp = s.lamp;
    if ((lamp.mode === 'expose' || lamp.mode === 'burn') && this.field) {
      const step = Math.min(dt, lamp.duration - lamp.elapsed);
      const shape = this.toolUV ? { ...this.toolUV, radius: s.toolRadius, feather: TOOL_FEATHER } : null;
      if (step > 0) {
        if (lamp.mode === 'expose') {
          this.field.addBase(step);
          if (s.tool === 'dodge' && shape) this.field.dodge(shape, step);
        } else if (shape) {
          this.field.burn(shape, step);
        }
      }
      const elapsed = lamp.elapsed + step;
      const done = elapsed >= lamp.duration - 1e-6;
      this.store.set({
        stageTime,
        exposedSeconds: s.exposedSeconds + (lamp.mode === 'expose' ? step : 0),
        burnedSeconds: s.burnedSeconds + (lamp.mode === 'burn' ? step : 0),
        lamp: done ? { mode: 'off', elapsed: 0, duration: 0 } : { ...lamp, elapsed },
      });
      return;
    }
    this.store.set({ stageTime });
  }

  private finish() {
    const rec = this.makeRecord();
    this.store.set({
      prints: rec ? [rec, ...this.state.prints].slice(0, 24) : this.state.prints,
      currentPrintId: rec?.id ?? null,
    });
    this.goto('finished');
  }

  private makeRecord(): PrintRecord | null {
    if (!this.current || !this.layout || !this.field) return null;
    this.printCounter++;
    return {
      id: `print-${this.printCounter}`,
      negative: this.current,
      layout: this.layout,
      settings: this.state.settings,
      field: this.field.clone(),
      dev: this.state.dev,
      thumb: '',
      createdAt: Date.now(),
    };
  }

  setPrintThumb(id: string, thumb: string) {
    this.store.set({ prints: this.state.prints.map((p) => (p.id === id ? { ...p, thumb } : p)) });
  }

  /** Is development complete enough that stopping now gives a full-strength print? */
  get developedEnough(): boolean {
    return this.state.dev.clock >= DEVELOPER.recommendedMin;
  }
}
