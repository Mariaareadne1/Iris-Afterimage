#!/usr/bin/env node
/**
 * Build public/negatives/manifest.json from the images in public/negatives/.
 * Use it to replace the bundled samples with your own film scans:
 *
 *   1. delete the sample .jpg files (keep or edit CREDITS.md)
 *   2. copy your scans in (JPEG/PNG/WebP, ~2000px on the long side is plenty)
 *   3. node scripts/make-manifest.mjs --author "Your Name"
 *
 * Existing entries keep their titles/credits; new files get a title from the
 * file name ("rue-de-rivoli_1998.jpg" → "Rue de rivoli, 1998"). The first
 * entry is the default negative — reorder the JSON to choose.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, parse } from 'node:path';

const dir = join(process.cwd(), 'public', 'negatives');
const args = process.argv.slice(2);
const flag = (name, fallback = '') => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const author = flag('author');
const license = flag('license', 'All rights reserved');

const manifestPath = join(dir, 'manifest.json');
const existing = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')).negatives ?? [] : [];
const byFile = new Map(existing.map((n) => [n.file, n]));
const files = readdirSync(dir).filter((f) => /\.(jpe?g|png|webp|avif)$/i.test(f)).sort();

let frame = 1;
const negatives = files.map((file) => {
  const prev = byFile.get(file);
  if (prev) return prev;
  const { name } = parse(file);
  const [base, year = ''] = name.split('_');
  const title = base.replace(/[-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  return {
    id: name.toLowerCase().replace(/[^\w-]+/g, '-').slice(0, 64),
    file,
    title: year ? `${title}` : title,
    author,
    year: /^\d{4}$/.test(year) ? year : '',
    license,
    source: '',
    frame: String(frame++ * 3).padStart(2, '0'),
  };
});
// keep the original order for existing entries, then new ones
negatives.sort((a, b) => {
  const ia = existing.findIndex((n) => n.file === a.file);
  const ib = existing.findIndex((n) => n.file === b.file);
  return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
});
writeFileSync(manifestPath, JSON.stringify({ negatives }, null, 2) + '\n');
console.log(`wrote ${negatives.length} negatives to ${manifestPath}`);
