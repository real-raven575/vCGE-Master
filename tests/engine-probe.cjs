// TEMPORARY diagnostic (browser matrix, PR #2): small, separate probes for the two engine questions CI alone can
// answer (Playwright's WebKit and Firefox cannot be downloaded in the cloud container). Prints what it sees; never
// fails the job. Removed, with its CI rows, once the causes are known.
const path = require('path'), { spawn } = require('child_process');
const playwright = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PORT = String(18000 + Math.floor(Math.random() * 2000));
const ORIGIN = `http://localhost:${PORT}/`;
const ENGINE = process.env.VCGE_BROWSER || 'chromium';
const log = (...a) => console.log('probe:', ...a);
const pressStartNow = () => new MutationObserver((_, o) => {
  const b = document.getElementById('welcomeStartBtn');
  if (b) { o.disconnect(); b.click(); }
}).observe(document, { childList: true, subtree: true });

// Runs `steps` in a fresh browser; each step gets 12 s. Reports the first step that crashes or times out.
async function scenario(name, opts, steps) {
  const browser = await playwright[ENGINE].launch();
  const ctx = await browser.newContext(opts.context || {});
  await ctx.addInitScript(pressStartNow);
  for (const s of opts.init || []) await ctx.addInitScript(s);
  let page = await ctx.newPage(), crashed = false, done = [];
  page.on('crash', () => { crashed = true; });
  page.on('dialog', d => d.accept());
  try {
    await page.goto(ORIGIN); await page.waitForTimeout(500);
    for (const [label, fn] of steps) {
      await Promise.race([fn(page, ctx), new Promise((_, rej) => setTimeout(() => rej(new Error('step timed out')), 12000))]);
      if (crashed) throw new Error('page crashed');
      done.push(label);
    }
    log(name, 'OK:', done.join(' > '), '| history', await page.evaluate(() => history.length));
  } catch (e) {
    log(name, 'FAILED after:', done.join(' > ') || '(start)', '|', String(e.message).split('\n')[0], crashed ? '(crash)' : '');
  }
  await browser.close().catch(() => {});
}

const tap = (p) => p.click('#firstName');
const reload = (p) => p.reload();
const appReload = (p) => Promise.all([p.waitForEvent('load'), p.evaluate(() => location.reload())]);

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.mjs')], { env: { ...process.env, PORT } });
  await new Promise((resolve) => server.stdout.once('data', resolve));
  log('engine', ENGINE);

  if (ENGINE === 'webkit' || process.env.PROBE_ALL) {
    const noPush = () => { history.pushState = () => {}; };
    await scenario('W1 tap, reload, tap, reload', {}, [['tap', tap], ['reload', reload], ['tap', tap], ['reload', reload], ['tap', tap], ['reload', reload]]);
    await scenario('W2 same, pushState disabled', { init: [noPush] }, [['tap', tap], ['reload', reload], ['tap', tap], ['reload', reload], ['tap', tap], ['reload', reload]]);
    await scenario('W3 three reloads, no taps', {}, [['reload', reload], ['reload', reload], ['reload', reload]]);
    await scenario('W4 tap, reload, reload', {}, [['tap', tap], ['reload', reload], ['reload', reload]]);
    await scenario('W5 tap, app reload, tap, app reload', {}, [['tap', tap], ['app reload', appReload], ['tap', tap], ['app reload', appReload]]);
    await scenario('W6 second tab opened and closed first', {}, [['tap', tap], ['tab', async (p, c) => { const q = await c.newPage(); await q.goto(ORIGIN); await q.waitForTimeout(500); await q.close(); await p.bringToFront(); }],
      ['tap', tap], ['reload', reload], ['tap', tap], ['reload', reload]]);
    await scenario('W7 settings entry cleared before the reloads', {}, [['tap', tap], ['clear', p => p.evaluate(() => localStorage.clear())], ['reload', reload], ['tap', tap], ['reload', reload]]);
  }

  if (ENGINE === 'firefox' || process.env.PROBE_ALL) {
    // Which events does a Playwright mouse press produce, with and without touch emulation?
    const record = () => { window.__pev = []; ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'click'].forEach(t => document.addEventListener(t, e => window.__pev.push(`${t}:${e.pointerType || ''}:${e.isTrusted ? 'T' : 'u'}:${e.mozInputSource === undefined ? '-' : e.mozInputSource}`), true)); };
    for (const hasTouch of [false, true]) {
      await scenario(`F1 mouse and tap, hasTouch ${hasTouch}`, { context: { hasTouch }, init: [record] }, [
        ['mouse', async p => { await p.mouse.move(200, 200); await p.mouse.down(); await p.mouse.up(); log('  mouse:', await p.evaluate(() => window.__pev.splice(0).join(' '))); }],
        ...(hasTouch ? [['tap', async p => { await p.touchscreen.tap(200, 200); log('  tap:', await p.evaluate(() => window.__pev.splice(0).join(' '))); }]] : []),
        ['capture', async p => { log('  setPointerCapture:', await p.evaluate(() => [0, 1].map(id => { try { document.body.setPointerCapture(id); return id + ' ok'; } catch (e) { return id + ' ' + e.name; } }).join(', '))); }],
      ]);
    }
    // The camera "feed taken" case: does a dispatched 'ended' reach the app's listener on the track?
    const fakeCam = () => {
      navigator.mediaDevices.getUserMedia = async () => {
        const c = document.createElement('canvas'); c.width = 640; c.height = 360; c.getContext('2d').fillRect(0, 0, 640, 360);
        const stream = c.captureStream(5), track = stream.getVideoTracks()[0];
        window.__camTrack = track; window.__camStream = stream; window.__heard = [];
        const add = track.addEventListener.bind(track);
        track.addEventListener = (t, f, o) => { window.__heard.push('app listens: ' + t); return add(t, (e) => { window.__heard.push('app heard: ' + t); return f(e); }, o); };
        return stream;
      };
    };
    await scenario('F2 camera ended', { init: [fakeCam] }, [
      ['start', async p => { await p.click('#startCameraBtn'); await p.waitForTimeout(500); }],
      ['ended', async p => {
        const s = await p.evaluate(() => { const v = document.getElementById('cameraStream').srcObject;
          window.__camTrack.addEventListener('ended', () => window.__heard.push('test heard: ended'));
          const before = { same: !!v && v === window.__camStream, sameTrack: !!v && v.getVideoTracks()[0] === window.__camTrack, n: v ? v.getVideoTracks().length : -1, state: window.__camTrack.readyState };
          window.__camTrack.dispatchEvent(new Event('ended'));
          return before; });
        await p.waitForTimeout(500);
        log('  before:', JSON.stringify(s), '| heard:', await p.evaluate(() => window.__heard.join(', ')), '| pop-up:', await p.isVisible('#cameraInUseModal'),
          '| log:', await p.evaluate(() => document.getElementById('eventLog').textContent.trim().slice(-300)));
      }],
    ]);
  }
  server.kill();
  process.exit(0);
})();
