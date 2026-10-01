const { chromium, APP_URL, USER, PASS, OUT } = require('./env.js');
const { route } = require('./mock.js');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.log('FAIL:', msg); } else { console.log('OK:', msg); } }

async function runScenario(browser, name, seedFn, expectLcm, expectGpm) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await ctx.route('https://**/*', async r => {
    const req = r.request();
    const data = route(req.url(), req.method(), req.postData());
    if (data == null) return r.fulfill({ status: 404, body: 'nf' });
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(data) });
  });
  await page.goto(APP_URL);
  await page.waitForTimeout(300);
  if (seedFn) await page.evaluate(seedFn);
  await page.fill('#loginUser', USER);
  await page.fill('#loginPass', PASS);
  await page.click('#loginForm button[type=submit]');
  await page.waitForTimeout(2000);
  await page.click('#nv-settings'); await page.waitForTimeout(400);
  const lcmVal = await page.locator('input[data-set="lossCooldownMin"]').inputValue();
  const gpmVal = await page.locator('input[data-set="globalPauseMin"]').inputValue();
  assert(lcmVal === expectLcm, `${name}: lossCooldownMin erwartet ${expectLcm}, war ${lcmVal}`);
  assert(gpmVal === expectGpm, `${name}: globalPauseMin erwartet ${expectGpm}, war ${gpmVal}`);
  await ctx.close();
}

function seedOldDefaults() {
  const now = Date.now();
  localStorage.setItem('smartlab.v3.settings', JSON.stringify({ v: 3, settings: { lossCooldownMin: 10, globalPauseMin: 5 }, strategies: {}, watchlist: {}, ui: {} }));
  localStorage.setItem('smartlab.v3.runtime', JSON.stringify({ v: 3, tradeSeq: 0, savedAt: now, app: '2.1.0', mode: 'SIMULATION', bot: { desired: 'RUNNING', autoTrading: false, safeMode: false, emergency: false, emergencyReason: '' }, risk: { buyCount: {}, coinCooldown: {}, stratCooldown: {}, lossCooldownUntil: 0, globalPauseUntil: 0, lossStreak: 0, dayKey: '', dailyPnl: 0, dailyStartEquity: null, dailyTrades: 0, dailyLimitHit: false, reviewRequired: false, buyTimes: [] }, session: {}, seen: {}, alertMarks: {}, reconciliation: { required: false, issues: [], at: now } }));
}
function seedCustomValues() {
  const now = Date.now();
  localStorage.setItem('smartlab.v3.settings', JSON.stringify({ v: 3, settings: { lossCooldownMin: 20, globalPauseMin: 8 }, strategies: {}, watchlist: {}, ui: {} }));
  localStorage.setItem('smartlab.v3.runtime', JSON.stringify({ v: 3, tradeSeq: 0, savedAt: now, app: '2.1.0', mode: 'SIMULATION', bot: { desired: 'RUNNING', autoTrading: false, safeMode: false, emergency: false, emergencyReason: '' }, risk: { buyCount: {}, coinCooldown: {}, stratCooldown: {}, lossCooldownUntil: 0, globalPauseUntil: 0, lossStreak: 0, dayKey: '', dailyPnl: 0, dailyStartEquity: null, dailyTrades: 0, dailyLimitHit: false, reviewRequired: false, buyTimes: [] }, session: {}, seen: {}, alertMarks: {}, reconciliation: { required: false, issues: [], at: now } }));
}
function seedZeroValues() {
  const now = Date.now();
  localStorage.setItem('smartlab.v3.settings', JSON.stringify({ v: 3, settings: { lossCooldownMin: 0, globalPauseMin: 0 }, strategies: {}, watchlist: {}, ui: {} }));
  localStorage.setItem('smartlab.v3.runtime', JSON.stringify({ v: 3, tradeSeq: 0, savedAt: now, app: '2.2.0', mode: 'SIMULATION', bot: { desired: 'RUNNING', autoTrading: false, safeMode: false, emergency: false, emergencyReason: '' }, risk: { buyCount: {}, coinCooldown: {}, stratCooldown: {}, lossCooldownUntil: 0, globalPauseUntil: 0, lossStreak: 0, dayKey: '', dailyPnl: 0, dailyStartEquity: null, dailyTrades: 0, dailyLimitHit: false, reviewRequired: false, buyTimes: [] }, session: {}, seen: {}, alertMarks: {}, reconciliation: { required: false, issues: [], at: now } }));
}
function seedAlreadyMigrated() {
  const now = Date.now();
  localStorage.setItem('smartlab.v3.settings', JSON.stringify({ v: 3, settings: { lossCooldownMin: 10, globalPauseMin: 5 }, strategies: {}, watchlist: {}, ui: {} }));
  localStorage.setItem('smartlab.v3.runtime', JSON.stringify({ v: 3, tradeSeq: 0, savedAt: now, app: '2.1.1', mode: 'SIMULATION', bot: { desired: 'RUNNING', autoTrading: false, safeMode: false, emergency: false, emergencyReason: '' }, risk: { buyCount: {}, coinCooldown: {}, stratCooldown: {}, lossCooldownUntil: 0, globalPauseUntil: 0, lossStreak: 0, dayKey: '', dailyPnl: 0, dailyStartEquity: null, dailyTrades: 0, dailyLimitHit: false, reviewRequired: false, buyTimes: [] }, session: {}, seen: {}, alertMarks: {}, reconciliation: { required: false, issues: [], at: now } }));
}
const seedWith = (app, lcm, gpm, lcu, gpu) => `(() => { const now = Date.now();
  localStorage.setItem('smartlab.v3.settings', JSON.stringify({ v: 3, settings: { lossCooldownMin: ${lcm}, globalPauseMin: ${gpm} }, strategies: {}, watchlist: {}, ui: {} }));
  localStorage.setItem('smartlab.v3.runtime', JSON.stringify({ v: 3, tradeSeq: 0, savedAt: now, app: '${app}', mode: 'SIMULATION', bot: { desired: 'RUNNING', autoTrading: false, safeMode: false, emergency: false, emergencyReason: '' }, risk: { buyCount: {}, coinCooldown: {}, stratCooldown: {}, lossCooldownUntil: ${lcu}, globalPauseUntil: ${gpu}, lossStreak: 0, dayKey: '', dailyPnl: 0, dailyStartEquity: null, dailyTrades: 0, dailyLimitHit: false, reviewRequired: false, buyTimes: [] }, session: {}, seen: {}, alertMarks: {}, reconciliation: { required: false, issues: [], at: now } })); })()`;
const seedV27 = seedWith('2.7.0', 10, 5, 'now + 600000', 'now + 300000');
const seedV28Custom = seedWith('2.8.0', 10, 5, 0, 0);

(async () => {
  const browser = await chromium.launch();
  await runScenario(browser, 'Szenario 1 (alte Defaults 10/5, app 2.1.0) → 0/0', seedOldDefaults, '0', '0');
  await runScenario(browser, 'Szenario 2 (20/8 aus app 2.1.0) → 0/0 (Umstellung 2.8.0)', seedCustomValues, '0', '0');
  await runScenario(browser, 'Szenario 3 (frische Installation) → Defaults 0/0', null, '0', '0');
  await runScenario(browser, 'Szenario 4 (app 2.1.1 mit 10/5) → 0/0', seedAlreadyMigrated, '0', '0');
  await runScenario(browser, 'Szenario 5 (0/0 aus 2.2.0) bleibt 0/0', seedZeroValues, '0', '0');
  await runScenario(browser, 'Szenario 6 (app 2.7.0 mit erzwungenen 10/5 + laufender Pause) → 0/0', seedV27, '0', '0');
  await runScenario(browser, 'Szenario 7 (ab 2.8.0 bewusst 10/5 gesetzt) bleibt 10/5', seedV28Custom, '10', '5');
  console.log('\n' + (failures === 0 ? 'ALLE MIGRATIONSTESTS BESTANDEN' : failures + ' TEST(S) FEHLGESCHLAGEN'));
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
})();
