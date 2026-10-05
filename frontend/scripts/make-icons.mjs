// Rasterises public/icons/icon.svg into the PWA / favicon / Android launcher sizes.
import sharp from 'sharp';
import { readFileSync } from 'node:fs';

const svg = readFileSync(new URL('../public/icons/icon.svg', import.meta.url));
const out = (name) => new URL(`../public/icons/${name}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const sizes = [16, 32, 48, 72, 96, 128, 144, 152, 180, 192, 256, 384, 512];
for (const s of sizes) await sharp(svg).resize(s, s).png().toFile(out(`icon-${s}.png`));

// Maskable: full-bleed background so Android's adaptive mask never clips the compass.
const inner = await sharp(svg).resize(400, 400).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#0b1020' } })
  .composite([{ input: inner, gravity: 'center' }])
  .png()
  .toFile(out('maskable-512.png'));
await sharp(svg).resize(96, 96).png().toFile(out('badge-96.png'));
console.log('icons generated');
