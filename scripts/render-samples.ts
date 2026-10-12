/**
 * Dev utility: render every bundled negative through the real photographic
 * pipeline (suggested time, grade 2½, fully developed) to PNGs, for eyeballing
 * the model outside the browser. Usage: npx tsx scripts/render-samples.ts <outDir>
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import {
  computeLayout, createNegative, densityToSrgb, DEFAULT_FRAMING, ExposureField, FOCUS_SHARP,
  luminanceFromRGBA, projectNegative, renderPrint, suggestExposureTime, imagePixelSize,
} from '../src/photography/index.ts';

const out = process.argv[2] ?? 'captures/samples';
mkdirSync(out, { recursive: true });
const manifest = JSON.parse(readFileSync('public/negatives/manifest.json', 'utf8'));
for (const n of manifest.negatives) {
  const tmp = join(out, `${n.id}.src.png`);
  execFileSync('sips', ['-s', 'format', 'png', '-Z', '800', `public/negatives/${n.file}`, '--out', tmp], { stdio: 'ignore' });
  const png = PNG.sync.read(readFileSync(tmp));
  const neg = createNegative(luminanceFromRGBA(png.data, png.width, png.height), { seed: 7 });
  const layout = computeLayout(neg.width, neg.height);
  const size = imagePixelSize(layout, 600);
  const proj = projectNegative(neg, DEFAULT_FRAMING, FOCUS_SHARP, size.width, size.height);
  const t = suggestExposureTime(proj.data);
  const field = new ExposureField(layout.aspect, 64);
  field.addBase(t);
  const print = renderPrint(neg, layout, { framing: DEFAULT_FRAMING, focus: FOCUS_SHARP, grade: 2.5 }, field, 600);
  const img = new PNG({ width: size.width, height: size.height });
  print.density.data.forEach((d, i) => {
    const v = Math.round(densityToSrgb(d) * 255);
    img.data.set([v, v, v, 255], i * 4);
  });
  writeFileSync(join(out, `${n.id}.print.png`), PNG.sync.write(img));
  console.log(n.id, `${t}s`, `${size.width}x${size.height}`);
}
