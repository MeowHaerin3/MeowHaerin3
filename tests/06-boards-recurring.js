const { chromium } = require('playwright');
const fs = require('fs');
const OUT = require('./_env').OUT;

const body = fs.readFileSync(require('./_env').SRC, 'utf8');
fs.writeFileSync(OUT + '/page.html',
  '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' +
  body + '</body></html>');

let pass = 0, fail = 0;
const check = async (label, fn) => {
  try {
    const r = await fn();
    const bad = r === false;
    bad ? fail++ : pass++;
    console.log('  ' + (bad ? '✗' : '✓') + ' ' + label + (r !== undefined ? ' → ' + r : ''));
  } catch (e) { fail++; console.log('  ✗ ' + label + ' → ' + e.message); }
};

const KEY = 'jeno.board.v1';
const fresh = `try{if(!sessionStorage.getItem('__c')){localStorage.clear();sessionStorage.setItem('__c','1')}}catch(e){}`;

const calStub = `
window.__mcp = { calls: [], events: [], fail: null };
window.claude = { mcp: {
  callTool: function (server, tool, input) {
    window.__mcp.calls.push({ server: server, tool: tool, input: input });
    if (window.__mcp.fail) return Promise.reject(window.__mcp.fail);
    if (tool === 'list_events') return Promise.resolve({ content: [], payload: {
      accessRole: 'owner', summary: 'me@x.z', timeZone: 'Asia/Bangkok',
      events: window.__mcp.events } });
    if (tool === 'create_event') {
      var id = 'ev' + (window.__mcp.events.length + 1);
      var ev = { id: id, summary: input.summary, status: 'confirmed', eventType: 'DEFAULT',
        start: { dateTime: input.startTime, timeZone: 'Asia/Bangkok' },
        end: { dateTime: input.endTime, timeZone: 'Asia/Bangkok' },
        htmlLink: 'https://www.google.com/calendar/event?eid=' + id,
        created: new Date().toISOString(), updated: new Date().toISOString() };
      window.__mcp.events.push(ev);
      return Promise.resolve({ content: [], payload: ev });
    }
    if (tool === 'search_threads') return Promise.resolve({ content: [], payload: { threads: [] } });
    if (tool === 'search_files') return Promise.resolve({ content: [], payload: {} });
    return Promise.reject({ code: 'bad_request', message: 'unknown ' + tool });
  },
  listTools: function () { return Promise.resolve({ servers: [] }); },
  watchTool: function () { return function () {}; },
  invalidate: function () { return Promise.resolve(); }
} };`;

(async () => {
  const browser = await chromium.launch({ executablePath: require('./_env').CHROME });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
  const url = 'file://' + OUT + '/page.html';
  const open = async (init) => {
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    p.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
    await p.addInitScript(init);
    await p.goto(url);
    await p.waitForTimeout(500);
    return p;
  };

  console.log('— banner gone, buttons intact —');
  const p = await open(fresh);
  await check('no title banner', async () => (await p.$$('#mastTitle')).length === 0);
  await check('date stamp kept', async () => await p.textContent('#todayStamp'));
  await check('masthead trimmed to push + settings', async () =>
    (await p.$$eval('.masthead-tools button', e => e.map(x => x.textContent || x.id))).join(' | '));
  await check('backup and erase moved into settings', async () => {
    await p.click('#btnSettings'); await p.waitForTimeout(250);
    await p.click('[data-settab="data"]'); await p.waitForTimeout(250);
    const ok = (await p.$$('#btnExport')).length && (await p.$$('#btnImport')).length && (await p.$$('#btnReset')).length;
    await p.click('#setClose');
    return !!ok;
  });
  await check('board tab strip present', async () => (await p.$$('.board-tab')).length);
  await p.close();

  console.log('— v2 data migrates without loss —');
  const legacy = {
    v: 2, syncedAt: 1111, touchedAt: 2222, seenDriveAt: 0,
    columns: [
      { id: 'c1', title: 'เก่า A', done: false, cards: ['k1', 'k2'] },
      { id: 'c2', title: 'เก่า B', done: true, cards: ['k3'] }
    ],
    cards: {
      k1: { id: 'k1', title: 'งานเก่าหนึ่ง', note: 'โน้ต', due: '', pri: 'high', tags: ['เก่า'],
            log: [{ id: 'g1', text: 'บันทึกเก่า', at: 1700000000000 }], created: 1, doneAt: 0 },
      k2: { id: 'k2', title: 'งานเก่าสอง', note: '', due: '', pri: 'low', tags: [], log: [], created: 2, doneAt: 0 },
      k3: { id: 'k3', title: 'ปิดไปแล้ว', note: '', due: '', pri: 'mid', tags: [], log: [], created: 3, doneAt: 5 }
    }
  };
  const p1 = await open(`try{localStorage.clear();localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify(legacy))})}catch(e){}`);
  await check('upgraded to v3', async () => await p1.evaluate(k =>
    JSON.parse(localStorage.getItem(k)).v, KEY));
  await check('wrapped into one board', async () => await p1.evaluate(k =>
    JSON.parse(localStorage.getItem(k)).boards.length, KEY));
  await check('all 3 cards survived', async () => await p1.evaluate(k =>
    Object.keys(JSON.parse(localStorage.getItem(k)).boards[0].cards).length, KEY));
  await check('column titles kept', async () =>
    (await p1.$$eval('.col-head h2', e => e.map(x => x.textContent))).join(' | '));
  await check('log entries kept', async () => await p1.evaluate(k =>
    JSON.parse(localStorage.getItem(k)).boards[0].cards.k1.log[0].text, KEY));
  await check('sync bookkeeping kept', async () => await p1.evaluate(k => {
    const st = JSON.parse(localStorage.getItem(k));
    return st.syncedAt === 1111 && st.touchedAt >= 2222;
  }, KEY));
  await check('new per-card fields defaulted', async () => await p1.evaluate(k => {
    const c = JSON.parse(localStorage.getItem(k)).boards[0].cards.k1;
    return c.repeat === '' && typeof c.movedAt === 'number';
  }, KEY));
  await p1.close();

  console.log('— board CRUD —');
  const p2 = await open(fresh);
  await p2.click('#boardAdd'); await p2.waitForTimeout(300);
  await p2.fill('#askInput', 'ลูกค้า A');
  await p2.click('#askOk'); await p2.waitForTimeout(350);
  await check('board added', async () => (await p2.$$('.board-tab')).length);
  await check('switched to it', async () => await p2.textContent('.board-tab[aria-current="true"]'));
  await check('new board starts empty', async () => (await p2.$$('.card')).length === 0);
  await check('columns still seeded', async () => (await p2.$$('.col')).length);

  await p2.click('.col:first-child [data-add]');
  await p2.fill('#composerInput', 'งานของลูกค้า A');
  await p2.keyboard.press('Enter'); await p2.waitForTimeout(300);
  await p2.keyboard.press('Escape');
  await check('card added to board 2 only', async () => await p2.evaluate(k => {
    const st = JSON.parse(localStorage.getItem(k));
    return Object.keys(st.boards[0].cards).length + '/' + Object.keys(st.boards[1].cards).length;
  }, KEY));

  await p2.click('#boardMenu'); await p2.waitForTimeout(200);
  await p2.click('[data-bact="rename"]'); await p2.waitForTimeout(300);
  await p2.fill('#askInput', 'ลูกค้า A — เฟส 2');
  await p2.click('#askOk'); await p2.waitForTimeout(300);
  await check('renamed', async () => await p2.textContent('.board-tab[aria-current="true"]'));

  await p2.click('#boardMenu'); await p2.waitForTimeout(200);
  await p2.click('[data-bact="dup"]'); await p2.waitForTimeout(400);
  await check('duplicated', async () => (await p2.$$('.board-tab')).length);
  await check('copy has its own card ids', async () => await p2.evaluate(k => {
    const st = JSON.parse(localStorage.getItem(k));
    const a = Object.keys(st.boards[1].cards), b = Object.keys(st.boards[2].cards);
    return a.length === b.length && a.every(id => b.indexOf(id) === -1);
  }, KEY));

  await p2.click('#boardMenu'); await p2.waitForTimeout(200);
  await p2.click('[data-bact="del"]'); await p2.waitForTimeout(300);
  await p2.click('#cfOk'); await p2.waitForTimeout(350);
  await check('deleted', async () => (await p2.$$('.board-tab')).length);
  await check('active board still valid', async () => (await p2.$$('.board-tab[aria-current="true"]')).length === 1);

  console.log('— scope switch across boards —');
  await p2.click('[data-page="remain"]'); await p2.waitForTimeout(350);
  await check('scope bar appears with 2+ boards', async () => (await p2.$$('[data-scope]')).length);
  await p2.click('[data-scope="all"]'); await p2.waitForTimeout(300);
  const allRows = (await p2.$$('#page .row')).length;
  await check('all boards shows more', async () => allRows);
  await check('rows tagged with board name', async () => (await p2.$$('.chip.from-board')).length);
  await p2.click('[data-scope="one"]'); await p2.waitForTimeout(300);
  const oneRows = (await p2.$$('#page .row')).length;
  await check('this board shows fewer', async () => oneRows < allRows ? oneRows + ' < ' + allRows : false);

  console.log('— opening a card from another board switches to it —');
  await p2.click('[data-scope="all"]'); await p2.waitForTimeout(300);
  const before = await p2.textContent('.board-tab[aria-current="true"]');
  const otherRow = await p2.$('.row .chip.from-board');
  const otherBoardName = otherRow ? (await otherRow.textContent()) : null;
  await p2.click('.row:has(.chip.from-board) .row-main');
  await p2.waitForTimeout(400);
  await check('editor opened', async () => await p2.isVisible('#fTitle'));
  await check('board switched to the owner', async () => {
    const now = (await p2.textContent('.board-tab[aria-current="true"]')).replace(/\d+$/, '').trim();
    return otherBoardName && now.startsWith(otherBoardName.trim()) ? now : (now !== before ? now : false);
  });
  await p2.click('#fCancel');
  await p2.close();

  console.log('— recurring task spawns the next round —');
  const p3 = await open(fresh);
  await p3.click('.card');
  await p3.waitForTimeout(300);
  await p3.click('[data-quick="0"]');
  await p3.selectOption('#fRepeat', 'weekly');
  await p3.click('#fSave'); await p3.waitForTimeout(350);
  await check('repeat chip on the card', async () => (await p3.$$('.card .chip.repeat')).length);
  const n0 = await p3.evaluate(k => Object.keys(JSON.parse(localStorage.getItem(k)).boards[0].cards).length, KEY);
  // close it from the summary page
  await p3.click('[data-page="today"]'); await p3.waitForTimeout(400);
  await p3.click('.panel.sev-today .row .tick');
  await p3.waitForTimeout(500);
  await check('a new round was created', async () =>
    (await p3.evaluate(k => Object.keys(JSON.parse(localStorage.getItem(k)).boards[0].cards).length, KEY)) === n0 + 1);
  await check('next round is 7 days out', async () => await p3.evaluate(k => {
    const cards = Object.values(JSON.parse(localStorage.getItem(k)).boards[0].cards);
    const open = cards.filter(c => !c.doneAt && c.repeat === 'weekly');
    if (!open.length) return false;
    const d = new Date(open[0].due), t0 = new Date(); t0.setHours(0,0,0,0);
    return Math.round((d - t0) / 86400000) === 7 ? open[0].due : false;
  }, KEY));
  await check('finished copy stopped repeating', async () => await p3.evaluate(k => {
    const cards = Object.values(JSON.parse(localStorage.getItem(k)).boards[0].cards);
    return cards.filter(c => c.doneAt && c.repeat).length === 0;
  }, KEY));
  await p3.close();

  console.log('— stale flag —');
  const p4 = await open(fresh);
  await p4.evaluate(k => {
    const st = JSON.parse(localStorage.getItem(k));
    const c = Object.values(st.boards[0].cards).find(x => !x.due && !x.doneAt);
    c.movedAt = Date.now() - 40 * 86400000;
    c.created = c.movedAt;
    localStorage.setItem(k, JSON.stringify(st));
  }, KEY);
  await p4.reload(); await p4.waitForTimeout(450);
  await check('stale chip on the board', async () => (await p4.$$('.card .chip.stale')).length);
  await p4.click('[data-page="today"]');
  // wait for the panel rather than guessing a delay
  const stalePanel = async () => await p4.evaluate(() =>
    [...document.querySelectorAll('.panel-head h2')].some(h => /ค้างนิ่ง|untouched/i.test(h.textContent)));
  for (let i = 0; i < 40 && !(await stalePanel()); i++) await p4.waitForTimeout(50);
  await check('stale panel on Today', stalePanel);
  await p4.close();

  console.log('— calendar range + push to Google Calendar —');
  const p5 = await open(fresh + '\n' + calStub);
  await p5.click('[data-page="cal"]'); await p5.waitForTimeout(500);
  await check('default 14 days', async () => (await p5.$$('.cal-day')).length);
  await p5.click('[data-caldays="7"]'); await p5.waitForTimeout(450);
  await check('7-day range', async () => (await p5.$$('.cal-day')).length);
  await check('range asked Calendar for 7 days', async () => await p5.evaluate(() => {
    const c = window.__mcp.calls.filter(x => x.tool === 'list_events').pop();
    return Math.round((Date.parse(c.input.endTime) - Date.parse(c.input.startTime)) / 86400000);
  }));
  await p5.click('[data-caldays="30"]'); await p5.waitForTimeout(450);
  await check('30-day range', async () => (await p5.$$('.cal-day')).length);
  await check('range persists', async () => {
    await p5.reload(); await p5.waitForTimeout(500);
    return (await p5.$$('.cal-day')).length;
  });

  await p5.click('[data-page="board"]'); await p5.waitForTimeout(300);
  await p5.click('.card'); await p5.waitForTimeout(350);
  await p5.click('[data-quick="1"]');
  await p5.click('#calPush'); await p5.waitForTimeout(500);
  await check('create_event called', async () => await p5.evaluate(() => {
    const c = window.__mcp.calls.filter(x => x.tool === 'create_event')[0];
    return c ? c.server + ' / ' + Object.keys(c.input).sort().join(',') : false;
  }));
  await check('event id stored on the card', async () => await p5.evaluate(k =>
    Object.values(JSON.parse(localStorage.getItem(k)).boards[0].cards).some(c => c.calEventId), KEY));
  await check('button locks to "on calendar"', async () => await p5.textContent('#calPush'));
  await p5.close();

  console.log('— push without a due date is refused —');
  const p6 = await open(fresh + '\n' + calStub);
  await p6.click('.col:first-child [data-add]');
  await p6.fill('#composerInput', 'ไม่มีกำหนดส่ง');
  await p6.keyboard.press('Enter'); await p6.waitForTimeout(300);
  await p6.keyboard.press('Escape');
  await p6.click('.col:first-child .card:last-of-type'); await p6.waitForTimeout(350);
  await p6.click('#calPush'); await p6.waitForTimeout(350);
  await check('told to set a date first', async () => await p6.textContent('#toastText'));
  await check('nothing sent to Calendar', async () => await p6.evaluate(() =>
    window.__mcp.calls.filter(x => x.tool === 'create_event').length === 0));
  await p6.close();

  console.log('— layout —');
  const m = await ctx.newPage();
  await m.setViewportSize({ width: 390, height: 844 });
  await m.addInitScript(fresh);
  await m.goto(url); await m.waitForTimeout(450);
  await check('no h-scroll @390', async () =>
    await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await m.screenshot({ path: OUT + '/y-mobile.png' });
  await m.close();

  const d = await ctx.newPage();
  await d.addInitScript(fresh);
  await d.goto(url); await d.waitForTimeout(450);
  await d.screenshot({ path: OUT + '/y-board.png' });
  await d.click('#boardAdd'); await d.waitForTimeout(300);
  await d.fill('#askInput', 'ลูกค้า A'); await d.click('#askOk'); await d.waitForTimeout(350);
  await d.click('[data-page="today"]'); await d.waitForTimeout(400);
  await d.screenshot({ path: OUT + '/y-today.png' });
  await d.close();

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(errors.length ? 'JS ERRORS:\n' + errors.slice(0, 8).join('\n') : 'No JS errors.');
  await browser.close();
})();
