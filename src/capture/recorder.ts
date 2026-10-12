/**
 * Records the darkroom canvas with MediaRecorder. Only the WebGL canvas is
 * captured, so interface chrome never appears in the video. The container is
 * whatever the browser actually supports — MP4 is offered only when
 * MediaRecorder reports it; otherwise WebM (convert with scripts/webm-to-mp4.sh).
 */
const CANDIDATES = [
  'video/mp4;codecs=avc1.640028',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

export function supportedVideoType(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') return null;
  return CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

export function extensionFor(mime: string): 'mp4' | 'webm' {
  return mime.startsWith('video/mp4') ? 'mp4' : 'webm';
}

export class CanvasRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  readonly mime: string;

  constructor(private canvas: HTMLCanvasElement, private fps = 60) {
    const mime = supportedVideoType();
    if (!mime) throw new Error('Video recording is not supported in this browser.');
    this.mime = mime;
  }

  get recording(): boolean {
    return this.recorder?.state === 'recording';
  }

  start() {
    const stream = this.canvas.captureStream(this.fps);
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, { mimeType: this.mime, videoBitsPerSecond: 14_000_000 });
    this.recorder.ondataavailable = (e) => e.data.size > 0 && this.chunks.push(e.data);
    this.recorder.start(250);
  }

  stop(): Promise<Blob> {
    const r = this.recorder;
    if (!r) return Promise.reject(new Error('Not recording'));
    return new Promise((resolve) => {
      r.onstop = () => {
        r.stream.getTracks().forEach((t) => t.stop());
        resolve(new Blob(this.chunks, { type: this.mime.split(';')[0] }));
        this.chunks = [];
      };
      r.stop();
    });
  }
}
