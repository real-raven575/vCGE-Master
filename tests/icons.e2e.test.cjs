// vCGE icon-detection accuracy (`npm run test:icons`): cards are drawn with contact icons from sets the detector does
// NOT use as templates (Material, Tabler; Font Awesome held out entirely during tuning), put through the app's real
// pre-processing and OCR, then the detector. Icon-free lines (with and without label letters) check for false alarms.
// Fails if, for any set, fewer than 90% of reported icons are right, fewer than 75% of icons are found, or any icon is
// reported on an icon-free line. The icon sets are devDependencies used only here (not bundled with the app).
const path = require('path'), fs = require('fs'), { spawn } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const NM = path.join(ROOT, 'node_modules');
const PORT = String(20000 + Math.floor(Math.random() * 2000));
const read = (f) => fs.readFileSync(path.join(NM, f), 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/currentColor/g, '#111');
const M = (n) => ['@material-design-icons/svg/filled/' + n, '@material-design-icons/svg/outlined/' + n];
const TB = (n) => ['@tabler/icons/icons/outline/' + n].concat(fs.existsSync(path.join(NM, '@tabler/icons/icons/filled/' + n)) ? ['@tabler/icons/icons/filled/' + n] : []);
const FA = (...f) => f.map(x => '@fortawesome/fontawesome-free/svgs/' + x);
const SETS = {
  material: { phone: M('phone.svg'), mobile: M('smartphone.svg'), email: [...M('email.svg'), ...M('mail.svg')], web: [...M('language.svg'), ...M('public.svg')],
    address: [...M('location_on.svg'), ...M('place.svg'), ...M('business.svg'), ...M('apartment.svg')], home: M('home.svg'), fax: [...M('print.svg'), ...M('fax.svg')] },
  tabler: { phone: TB('phone.svg'), mobile: TB('device-mobile.svg'), email: TB('mail.svg'), web: TB('world.svg'), address: [...TB('map-pin.svg'), ...TB('building.svg')],
    home: TB('home.svg'), fax: TB('printer.svg'), linkedin: TB('brand-linkedin.svg'), x: TB('brand-x.svg'), facebook: TB('brand-facebook.svg'),
    instagram: TB('brand-instagram.svg'), github: TB('brand-github.svg'), youtube: TB('brand-youtube.svg'), tiktok: TB('brand-tiktok.svg') },
  fontawesome: { phone: FA('solid/phone.svg'), mobile: FA('solid/mobile-screen.svg', 'solid/mobile.svg'), email: FA('solid/envelope.svg', 'regular/envelope.svg'),
    web: FA('solid/globe.svg'), address: FA('solid/location-dot.svg', 'solid/building.svg', 'regular/building.svg'), home: FA('solid/house.svg'), fax: FA('solid/print.svg', 'solid/fax.svg'),
    linkedin: FA('brands/linkedin.svg', 'brands/linkedin-in.svg'), x: FA('brands/x-twitter.svg'), facebook: FA('brands/facebook.svg', 'brands/facebook-f.svg'),
    instagram: FA('brands/instagram.svg'), github: FA('brands/github.svg'), youtube: FA('brands/youtube.svg'), tiktok: FA('brands/tiktok.svg') }
};
const TEXT = { phone: '616.555.0141', mobile: '616.555.0142', email: 'jane.doe@example.com', web: 'www.example.com', address: '100 Main Street, Springfield, IL 62701',
  home: '616.555.0199', fax: '616.555.0102', linkedin: 'in/janedoe', x: '@janedoe', facebook: 'facebook.com/janedoe', instagram: '@janedoe.studio',
  github: 'github.com/janedoe', youtube: 'youtube.com/@janedoe', tiktok: '@janedoe' };
const ICON_FREE = [['E', 'jane.doe@example.com'], ['T', '616.555.0141'], ['', 'Director of Engineering'], ['', 'Northwind Systems'], ['M', '616.555.0142'], ['', '233 South Wacker Drive']];
const MIN_PRECISION = 0.9, MIN_RECALL = 0.75;

let failed = 0;
(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.mjs')], { env: { ...process.env, PORT } });
  await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('exit', c => reject(new Error(`server exited ${c}`))); });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://localhost:${PORT}/`); await page.waitForTimeout(400);
  try {
    for (const [set, classes] of Object.entries(SETS)) {
      const rows = Object.entries(classes).flatMap(([cls, files]) => files.map(f => ({ cls, svg: read(f), text: TEXT[cls] })))
        .concat(ICON_FREE.map(([label, text]) => ({ cls: 'none', label, text })));
      const results = await page.evaluate(async (rows) => {
        const { preProcessImageBuffer } = await import('/src/modules/mod04-ocr/ocrWorker.js');
        const det = await import('/src/modules/mod04-ocr/iconDetector.js');
        const templates = await det.loadIconTemplates();
        const base = new URL('src/vendor/tesseract/', document.baseURI).href;
        const w = await Tesseract.createWorker('eng', 1, { workerPath: base + 'worker.min.js', corePath: base + 'core/', langPath: base + 'lang/', gzip: true, cacheMethod: 'none', workerBlobURL: false });
        await w.setParameters({ tessedit_pageseg_mode: '11' });
        const out = [];
        for (const size of [{ font: 30, icon: 34 }, { font: 22, icon: 24 }]) {
          for (let start = 0; start < rows.length; start += 7) {
            const batch = rows.slice(start, start + 7);
            const c = document.createElement('canvas'); c.width = 1100; c.height = 120 + batch.length * size.font * 2.4;
            const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#111';
            x.font = 'bold 44px Arial'; x.fillText('Jane Doe', 60, 70);
            const ys = []; let y = 140;
            for (const r of batch) {
              if (r.svg) { const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(r.svg); await img.decode(); x.drawImage(img, 60, y - size.icon * 0.85, size.icon, size.icon); }
              x.font = `${size.font}px Arial`;
              if (r.label) x.fillText(r.label, 60, y);
              x.fillText(r.text, 60 + size.icon * 1.6, y); ys.push(y - size.font * 0.35); y += size.font * 2.4;
            }
            const pre = await preProcessImageBuffer(c.toDataURL('image/png'));
            const g = await det.grayFromDataUrl(pre);
            const scale = g.width / c.width;
            const res = await w.recognize(pre);
            const lines = res.data.lines || [];
            const found = det.detectLineIcons(g.gray, g.width, g.height, lines, templates);
            batch.forEach((r, i) => {
              let k = -1, best = Infinity;
              lines.forEach((l, j) => { if (!found[j].text) return; const d = Math.abs((l.bbox.y0 + l.bbox.y1) / 2 - ys[i] * scale); if (d < best) { best = d; k = j; } });
              out.push({ truth: r.cls, icon: k >= 0 && best < size.font * scale ? found[k].icon : null });
            });
          }
        }
        await w.terminate();
        return out;
      }, rows);
      const icons = results.filter(r => r.truth !== 'none'), reported = results.filter(r => r.icon);
      const right = reported.filter(r => r.icon === r.truth).length;
      const falseOnFree = results.filter(r => r.truth === 'none' && r.icon).length;
      const precision = right / Math.max(1, reported.length), recall = right / icons.length;
      const okSet = precision >= MIN_PRECISION && recall >= MIN_RECALL && falseOnFree === 0;
      if (!okSet) failed++;
      console.log(`${okSet ? 'PASS' : 'FAIL'} ${set.padEnd(11)} reported right ${(100 * precision).toFixed(1)}%  found ${(100 * recall).toFixed(1)}% (${right}/${icons.length})  icons on icon-free lines: ${falseOnFree}`);
      for (const cls of Object.keys(classes)) {
        const t = results.filter(r => r.truth === cls), rep = results.filter(r => r.icon === cls);
        const wrong = rep.filter(r => r.truth !== cls).map(r => r.truth);
        console.log(`       ${cls.padEnd(9)} found ${t.filter(r => r.icon === cls).length}/${t.length}${wrong.length ? `   wrongly reported for: ${wrong.join(', ')}` : ''}`);
      }
    }
  } finally {
    await browser.close(); server.kill();
  }
  console.log(failed ? `\n${failed} icon set(s) below the bar` : '\nall icon sets meet the bar');
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
