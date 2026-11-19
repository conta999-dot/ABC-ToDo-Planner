import sharp from 'sharp';
import fs from 'node:fs';
const R = '/workspace/abc_planner/src/android/app/src/main/res';
const PUB = '/workspace/abc_planner/src/public';
fs.mkdirSync(PUB, { recursive: true });
const svg = (f) => fs.readFileSync(f);
const png = (f, size, out) => sharp(svg(f), { density: 72 * size / (f.includes('foreground') ? 108 : 512) * 1 }).resize(size, size).png().toFile(out);
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, m] of Object.entries(dens)) {
  await png('/workspace/abc_planner/icon/icon.svg', 48 * m, `${R}/mipmap-${d}/ic_launcher.png`);
  await png('/workspace/abc_planner/icon/icon-round.svg', 48 * m, `${R}/mipmap-${d}/ic_launcher_round.png`);
  await png('/workspace/abc_planner/icon/icon-foreground.svg', 108 * m, `${R}/mipmap-${d}/ic_launcher_foreground.png`);
}
await png('/workspace/abc_planner/icon/icon-full.svg', 512, `${PUB}/icon-512.png`);
await png('/workspace/abc_planner/icon/icon-full.svg', 192, `${PUB}/icon-192-maskable.png`);
await png('/workspace/abc_planner/icon/icon.svg', 192, `${PUB}/icon-192.png`);
await png('/workspace/abc_planner/icon/icon-full.svg', 180, `${PUB}/apple-touch-icon.png`);
await png('/workspace/abc_planner/icon/icon.svg', 32, `${PUB}/favicon-32.png`);
fs.copyFileSync('/workspace/abc_planner/icon/icon.svg', `${PUB}/favicon.svg`);
// splash: icon centered on white
const splashSizes = { 'drawable': [480, 320], 'drawable-land-hdpi': [800, 480], 'drawable-land-mdpi': [480, 320], 'drawable-land-xhdpi': [1280, 720], 'drawable-land-xxhdpi': [1600, 960], 'drawable-land-xxxhdpi': [1920, 1280], 'drawable-port-hdpi': [480, 800], 'drawable-port-mdpi': [320, 480], 'drawable-port-xhdpi': [720, 1280], 'drawable-port-xxhdpi': [960, 1600], 'drawable-port-xxxhdpi': [1280, 1920] };
for (const [dir, [w, h]] of Object.entries(splashSizes)) {
  const s = Math.round(Math.min(w, h) * 0.32);
  const icon = await sharp(svg('/workspace/abc_planner/icon/icon.svg'), { density: 72 * s / 512 }).resize(s, s).png().toBuffer();
  await sharp({ create: { width: w, height: h, channels: 4, background: '#fafafa' } })
    .composite([{ input: icon, left: Math.round((w - s) / 2), top: Math.round((h - s) / 2) }]).png().toFile(`${R}/${dir}/splash.png`);
}
// preview: adaptive (bg + fg masked circle & squircle), legacy at 512/96/48, round
const W = 1200, H = 420;
const comps = [];
const big = await sharp(svg('/workspace/abc_planner/icon/icon.svg'), { density: 72 * 320 / 512 }).resize(320, 320).png().toBuffer();
comps.push({ input: big, left: 40, top: 50 });
const fg = await sharp(svg('/workspace/abc_planner/icon/icon-foreground.svg'), { density: 72 * 320 / 108 }).resize(320, 320).png().toBuffer();
const circleMask = Buffer.from('<svg width="320" height="320"><circle cx="160" cy="160" r="160" fill="#fff"/></svg>');
const adaptive = await sharp({ create: { width: 320, height: 320, channels: 4, background: '#18181b' } })
  .composite([{ input: fg }, { input: circleMask, blend: 'dest-in' }]).png().toBuffer();
comps.push({ input: adaptive, left: 400, top: 50 });
let x = 760;
for (const s of [144, 96, 48, 32]) {
  const b = await sharp(svg('/workspace/abc_planner/icon/icon.svg'), { density: 72 * s / 512 }).resize(s, s).png().toBuffer();
  comps.push({ input: b, left: x, top: 210 - s / 2 });
  x += s + 24;
}
const label = Buffer.from(`<svg width="${W}" height="60"><text x="40" y="40" font-family="DejaVu Sans" font-size="22" fill="#3f3f46">ABC ToDo Planner icon: legacy 320px / Android adaptive (circle mask) / 144・96・48・32px</text></svg>`);
comps.push({ input: label, left: 0, top: 360 });
await sharp({ create: { width: W, height: H, channels: 4, background: '#f4f4f5' } }).composite(comps).png().toFile('/workspace/abc_planner/screens/icon-preview.png');
console.log('done');
