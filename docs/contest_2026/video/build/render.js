// 프레임 렌더러: node render.js <page.html> frames <from> <to> <out.mp4>   (프레임 번호, 60fps)
//               node render.js <page.html> stills <t1,t2,...> <outdir>
//               node render.js <page.html> cues <out.json>
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const FPS = 60;
(async () => {
  const [page_, mode, a, b, c] = process.argv.slice(2);
  const browser = await chromium.launch({ channel: 'chromium', args: ['--force-device-scale-factor=1', '--disable-gpu-vsync', '--allow-file-access-from-files'] });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error('PAGEERR', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('CONSOLE', m.text()); });
  await page.goto('file://' + path.resolve(page_));
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(i => i.decode().catch(() => null))); if (window.READY) await window.READY; });
  if (mode === 'cues') {
    const cues = await page.evaluate(() => ({ cues: window.CUES, dur: window.DUR }));
    fs.writeFileSync(a, JSON.stringify(cues)); await browser.close(); return;
  }
  const el = await page.$('#stage');
  if (mode === 'stills') {
    fs.mkdirSync(b, { recursive: true });
    for (const t of a.split(',').map(Number)) {
      await page.evaluate(t => window.seek(t), t);
      await el.screenshot({ path: path.join(b, `still_${t.toFixed(2)}.png`) });
      console.log('still', t);
    }
    await browser.close(); return;
  }
  const from = +a, to = +b, out = c;
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '6', '-pix_fmt', 'yuv420p', '-r', String(FPS), out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let f = from; f < to; f++) {
    await page.evaluate(t => window.seek(t), f / FPS);
    const buf = await page.screenshot({ type: 'jpeg', quality: 97, clip: { x: 0, y: 0, width: 1920, height: 1080 } });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if ((f - from) % 120 === 0) console.log(`${out} frame ${f} (${((f - from + 1) / ((Date.now() - t0) / 1000)).toFixed(1)} fps)`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  await browser.close();
  console.log('done', out, ((Date.now() - t0) / 1000).toFixed(0) + 's');
})();
