#!/usr/bin/env node
/**
 * Make a canvas recording (WebM or MP4 from the capture panel) ready for
 * X / social video: H.264 High, yuv420p (TV range), constant frame rate,
 * even dimensions, faststart, no audio. Browser recordings are fragmented,
 * variable-frame-rate and full-range, which many players and platforms mangle.
 *
 *   node scripts/prepare-video.mjs recording.webm [out.mp4] [--fps 30] [--crf 20]
 *
 * Uses the system ffmpeg if it works, otherwise the bundled ffmpeg-static.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const fps = Number(opt('fps', '30'));
const crf = Number(opt('crf', '20'));
const [input, outArg] = args;
if (!input || !existsSync(input)) {
  console.error('usage: node scripts/prepare-video.mjs <recording.webm|mp4> [out.mp4] [--fps 30] [--crf 20]');
  process.exit(1);
}
const output = outArg ?? input.replace(/\.(webm|mp4)$/i, '') + '-social.mp4';

function findFfmpeg() {
  const sys = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  if (sys.status === 0) return 'ffmpeg';
  try {
    return createRequire(import.meta.url)('ffmpeg-static');
  } catch {
    console.error('No working ffmpeg found. Install ffmpeg or run `npm install` (ffmpeg-static).');
    process.exit(1);
  }
}

const ffmpeg = findFfmpeg();
const res = spawnSync(
  ffmpeg,
  [
    '-y', '-hide_banner', '-loglevel', 'error', '-i', input,
    '-vf', `fps=${fps},scale=trunc(iw/2)*2:trunc(ih/2)*2:in_range=full:out_range=tv,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-profile:v', 'high', '-level', '4.2',
    '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-movflags', '+faststart', '-an', output,
  ],
  { stdio: 'inherit' },
);
if (res.status !== 0) process.exit(res.status ?? 1);
console.log(`wrote ${output} (${(statSync(output).size / 1e6).toFixed(1)} MB)`);
