// Probe (Ghost, MOD02): what a reload does to the Back guard's history entries, per engine.
// Run from the repo root: VCGE_BROWSER=firefox node <path>/mod02-guard-reload-probe.cjs   (chromium, firefox or webkit)
// Prints one JSON line per step. It changes nothing in the app or the suite.
const path = require('path'), { spawn } = require('child_process');
const playwright = require(path.resolve('node_modules/playwright'));
const ENGINE = process.env.VCGE_BROWSER || 'chromium';
const PORT = String(20000 + Math.floor(Math.random() * 2000));
const ORIGIN = `http://localhost:${PORT}/`;

(async () => {
  const server = spawn(process.execPath, [path.resolve('scripts/serve.mjs')], { env: { ...process.env, PORT }, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await playwright[ENGINE].launch();
  const look = (page, step) => page.evaluate((step) => ({
    step, len: history.length, state: history.state, url: location.href,
    nav: (performance.getEntriesByType('navigation')[0] || {}).type,
    leaveModal: !document.getElementById('leaveModal').classList.contains('hidden'),
  }), step).then(r => console.log(JSON.stringify({ engine: ENGINE, ...r })));
  for (const how of ['page.reload', 'location.reload']) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto('about:blank');
    await p.goto(ORIGIN); await p.waitForTimeout(300);
    await look(p, `${how}: loaded`);
    await p.click('#firstName'); await p.keyboard.type('One');
    await look(p, `${how}: after first tap`);
    if (how === 'page.reload') await p.reload();
    else await Promise.all([p.waitForEvent('load'), p.evaluate(() => location.reload())]);
    await p.waitForTimeout(300);
    await look(p, `${how}: after reload, before a tap`);
    await p.click('#firstName'); await p.keyboard.type('Reloaded');
    await look(p, `${how}: after a tap on the reloaded page`);
    await p.goBack(); await p.waitForTimeout(400);
    await look(p, `${how}: after Back 1`);
    if (await p.isVisible('#leaveStayBtn')) await p.click('#leaveStayBtn');
    await p.goBack(); await p.waitForTimeout(400);
    await look(p, `${how}: after Back 2`).catch(e => console.log(JSON.stringify({ engine: ENGINE, step: `${how}: after Back 2`, url: p.url(), error: e.message.split('\n')[0] })));
    await ctx.close();
  }
  await browser.close();
  server.kill();
})().catch(e => { console.error(e); process.exit(1); });
