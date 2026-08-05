const { chromium } = require('playwright');
const fs = require('fs');
const E = require('./_env');
const OUT = E.OUT;

fs.writeFileSync(OUT + '/page.html',
  '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' +
  fs.readFileSync(E.SRC, 'utf8') + '</body></html>');

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

// Stubs mirroring the live payload shapes observed for every tool used here.
const stub = `
window.__mcp = { calls: [], events: {}, files: [], fail: null,
  get drive() { try { return JSON.parse(sessionStorage.getItem('__d') || '[]'); } catch (e) { return []; } },
  set drive(v) { sessionStorage.setItem('__d', JSON.stringify(v)); } };
window.claude = { mcp: {
  callTool: function (server, tool, input) {
    window.__mcp.calls.push({ server: server, tool: tool, input: input });
    if (window.__mcp.fail) return Promise.reject(window.__mcp.fail);

    if (tool === 'create_event') {
      var id = 'ev' + (Object.keys(window.__mcp.events).length + 1);
      window.__mcp.events[id] = { id: id, summary: input.summary, start: { dateTime: input.startTime } };
      return Promise.resolve({ content: [], payload: window.__mcp.events[id] });
    }
    if (tool === 'update_event') {
      var e = window.__mcp.events[input.eventId];
      if (!e) return Promise.reject({ code: 'tool_error', message: 'gone' });
      e.summary = input.summary; e.start = { dateTime: input.startTime };
      return Promise.resolve({ content: [], payload: e });
    }
    if (tool === 'delete_event') {
      delete window.__mcp.events[input.eventId];
      return Promise.resolve({ content: [], payload: { id: input.eventId, status: 'cancelled' } });
    }
    if (tool === 'list_events') return Promise.resolve({ content: [], payload: {
      accessRole: 'owner', timeZone: 'Asia/Bangkok' } });

    if (tool === 'create_file') {
      var all = window.__mcp.drive;
      var fid = 'f' + (all.length + 1);
      all.push({ id: fid, title: input.title,
        body: input.textContent || '', b64: input.base64Content || '',
        createdTime: new Date().toISOString() });
      window.__mcp.drive = all;
      return Promise.resolve({ content: [], payload: {
        id: fid, title: input.title, mimeType: input.contentMimeType,
        fileSize: String((input.base64Content || input.textContent || '').length),
        createdTime: new Date().toISOString(),
        viewUrl: 'https://drive.google.com/file/d/' + fid + '/view' } });
    }
    if (tool === 'search_files') {
      var hits = window.__mcp.drive.filter(function (f) {
        return f.title.indexOf('todo-board-sync-') === 0;
      });
      if (!hits.length) return Promise.resolve({ content: [], payload: {} });
      return Promise.resolve({ content: [], payload: { files: hits.map(function (f) {
        return { id: f.id, title: f.title, mimeType: 'application/json', createdTime: f.createdTime };
      }) } });
    }
    if (tool === 'download_file_content') {
      var f = window.__mcp.drive.filter(function (x) { return x.id === input.fileId; })[0];
      if (!f) return Promise.reject({ code: 'tool_error', message: 'not found' });
      var bytes = new TextEncoder().encode(f.body), bin = '';
      bytes.forEach(function (b) { bin += String.fromCharCode(b); });
      return Promise.resolve({ content: [], payload: { content: btoa(bin), id: f.id } });
    }
    if (tool === 'search_threads') return Promise.resolve({ content: [], payload: { threads: [] } });
    return Promise.reject({ code: 'bad_request', message: 'unknown ' + tool });
  },
  listTools: function () { return Promise.resolve({ servers: [] }); },
  watchTool: function () { return function () {}; },
  invalidate: function () { return Promise.resolve(); }
} };`;

(async () => {
  const browser = await chromium.launch({ executablePath: E.CHROME });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
  const url = 'file://' + OUT + '/page.html';
  const open = async (init) => {
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    p.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
    await p.addInitScript(init);
    await p.goto(url);
    await p.waitForTimeout(600);
    return p;
  };

  console.log('— checklist —');
  const p = await open(fresh);
  await p.click('.card'); await p.waitForTimeout(350);
  await check('section present', async () => await p.isVisible('#checkSection'));
  for (const item of ['ขอไฟล์ดิบจากลูกค้า', 'ทำกราฟ downtime', 'ส่งให้หัวหน้ารีวิว']) {
    await p.fill('#checkInput', item);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(200);
  }
  await check('3 items', async () => (await p.$$('.check-row')).length);
  await check('progress reads 0/3', async () => await p.textContent('#checkSection .n'));
  await p.click('.check-row:first-child .tick'); await p.waitForTimeout(250);
  await check('ticking updates the count', async () => await p.textContent('#checkSection .n'));
  await check('row struck through', async () => (await p.$$('.check-row.is-done')).length);
  await check('progress bar has width', async () => await p.evaluate(() =>
    document.querySelector('.check-bar span').style.width));
  await check('persisted', async () => await p.evaluate(k => {
    const cards = Object.values(JSON.parse(localStorage.getItem(k)).boards[0].cards);
    const c = cards.find(x => (x.checks || []).length);
    return c.checks.length + ' items, ' + c.checks.filter(y => y.done).length + ' done';
  }, KEY));
  await p.click('.check-row:first-child .check-del'); await p.waitForTimeout(250);
  await check('deleted one', async () => (await p.$$('.check-row')).length);
  await p.click('#fCancel'); await p.waitForTimeout(200);
  await check('count chip on the card', async () => await p.textContent('.card .chip.checks'));
  await p.close();

  console.log('— attachments —');
  const p2 = await open(fresh + '\n' + stub);
  await p2.click('.card'); await p2.waitForTimeout(350);
  await check('upload offered when Drive is reachable', async () => await p2.isVisible('#fileAdd'));
  await p2.setInputFiles('#fileUp', {
    name: 'spec-ลูกค้า.pdf', mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 fake spec for the test')
  });
  await p2.waitForTimeout(600);
  await check('uploaded via create_file', async () => await p2.evaluate(() => {
    const c = window.__mcp.calls.filter(x => x.tool === 'create_file')
      .find(x => x.input.base64Content);
    return c ? c.input.contentMimeType + ' / convert-off:' + c.input.disableConversionToGoogleType : false;
  }));
  await check('base64 was sent, not raw text', async () => await p2.evaluate(() => {
    const c = window.__mcp.calls.filter(x => x.tool === 'create_file').find(x => x.input.base64Content);
    return !!c.input.base64Content && !c.input.textContent;
  }));
  await check('row shows on the card', async () => await p2.textContent('.file-row .file-name'));
  await check('link points at Drive', async () => await p2.getAttribute('.file-name', 'href'));
  await check('persisted', async () => await p2.evaluate(k =>
    Object.values(JSON.parse(localStorage.getItem(k)).boards[0].cards)
      .some(c => (c.files || []).length), KEY));
  await p2.click('[data-file-del]'); await p2.waitForTimeout(300);
  await check('removed from the card', async () => (await p2.$$('.file-row')).length === 0);
  await check('says the Drive file stays', async () => await p2.textContent('#toastText'));
  await p2.close();

  console.log('— auto push to calendar —');
  const p3 = await open(fresh + '\n' + stub);
  await p3.click('#btnSettings'); await p3.waitForTimeout(300);
  await p3.click('[data-autocal="1"]'); await p3.waitForTimeout(1200);
  await check('events created for dated tasks', async () =>
    await p3.evaluate(() => Object.keys(window.__mcp.events).length));
  await check('no event for undated tasks', async () => await p3.evaluate(k => {
    const cards = Object.values(JSON.parse(localStorage.getItem(k)).boards[0].cards);
    return cards.filter(c => !c.due).every(c => !c.calEventId);
  }, KEY));
  await p3.click('#setClose'); await p3.waitForTimeout(200);

  // move a due date → the event should move, not duplicate
  const evBefore = await p3.evaluate(() => Object.keys(window.__mcp.events).length);
  await p3.click('.col:nth-child(2) .card'); await p3.waitForTimeout(350);
  await p3.click('[data-quick="7"]');
  await p3.click('#fSave'); await p3.waitForTimeout(900);
  await check('updated in place, not duplicated', async () =>
    (await p3.evaluate(() => Object.keys(window.__mcp.events).length)) === evBefore);
  await check('update_event was used', async () => await p3.evaluate(() =>
    window.__mcp.calls.some(x => x.tool === 'update_event')));
  await check('stored date matches the event', async () => await p3.evaluate(k => {
    const c = Object.values(JSON.parse(localStorage.getItem(k)).boards[0].cards)
      .find(x => x.calEventId && x.due);
    const ev = window.__mcp.events[c.calEventId];
    return ev && ev.start.dateTime.indexOf(c.due) === 0 ? c.due : false;
  }, KEY));

  // closing a task should take its event away — move a dated card into Done
  await p3.click('[data-page="board"]'); await p3.waitForTimeout(300);
  await p3.click('.col:nth-child(2) .card'); await p3.waitForTimeout(350);
  const doneColId = await p3.evaluate(() => {
    const opts = [...document.querySelectorAll('#fCol option')];
    return opts[opts.length - 1].value;
  });
  await p3.selectOption('#fCol', doneColId);
  await p3.click('#fSave'); await p3.waitForTimeout(1000);
  await check('closing removed an event', async () => await p3.evaluate(() =>
    window.__mcp.calls.some(x => x.tool === 'delete_event')));
  await check('card no longer claims an event', async () => await p3.evaluate(k =>
    Object.values(JSON.parse(localStorage.getItem(k)).boards[0].cards)
      .filter(c => c.doneAt && c.calEventId).length === 0, KEY));
  await p3.close();

  console.log('— email reminder rides on the calendar entry —');
  const p3b = await open(fresh + '\n' + stub);
  await p3b.click('#btnSettings'); await p3b.waitForTimeout(300);
  await p3b.click('[data-autocal="1"]'); await p3b.waitForTimeout(1200);
  await check('no reminder while set to off', async () => await p3b.evaluate(() =>
    window.__mcp.calls.filter(x => x.tool === 'create_event')
      .every(x => !x.input.overrideReminders)));
  await p3b.click('[data-mailremind="day"]'); await p3b.waitForTimeout(1500);
  await check('reminder attached after switching on', async () => await p3b.evaluate(() => {
    const c = window.__mcp.calls.filter(x => x.tool === 'update_event' || x.tool === 'create_event')
      .filter(x => x.input.overrideReminders).pop();
    return c ? c.input.overrideReminders[0].method + ' @ ' + c.input.overrideReminders[0].minutes + 'min' : false;
  }));
  await check('existing entries were rewritten, not duplicated', async () => await p3b.evaluate(() =>
    window.__mcp.calls.filter(x => x.tool === 'update_event' && x.input.overrideReminders).length > 0));
  await p3b.click('[data-mailremind="same"]'); await p3b.waitForTimeout(1500);
  await check('lead time follows the choice', async () => await p3b.evaluate(() => {
    const c = window.__mcp.calls.filter(x => x.input && x.input.overrideReminders).pop();
    return c.input.overrideReminders[0].minutes === 0 ? '0min' : false;
  }));
  await p3b.click('[data-mailremind="off"]'); await p3b.waitForTimeout(1500);
  await check('switching off drops the reminder', async () => await p3b.evaluate(() => {
    const c = window.__mcp.calls.filter(x => x.tool === 'update_event').pop();
    return !c.input.overrideReminders;
  }));
  await check('setting persists', async () => {
    await p3b.reload(); await p3b.waitForTimeout(700);
    return await p3b.evaluate(k => JSON.parse(localStorage.getItem(k + '.ui')).mailRemind, KEY);
  });
  await p3b.close();

  console.log('— auto sync: debounce and page-hide push —');
  const p4 = await open(fresh + '\n' + stub);
  await p4.click('#btnSettings'); await p4.waitForTimeout(300);
  await p4.click('[data-autosync="1"]'); await p4.waitForTimeout(300);
  await p4.click('#setClose'); await p4.waitForTimeout(200);
  await p4.click('.col:first-child [data-add]');
  await p4.fill('#composerInput', 'งานใหม่ก่อนปิดหน้า');
  await p4.keyboard.press('Enter'); await p4.waitForTimeout(300);
  await p4.keyboard.press('Escape');
  await check('no push yet (still debouncing)', async () => await p4.evaluate(() =>
    window.__mcp.drive.filter(f => f.title.indexOf('todo-board-sync-') === 0).length === 0));
  await p4.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await p4.waitForTimeout(700);
  await check('pushed when the page hid', async () => await p4.evaluate(() =>
    window.__mcp.drive.filter(f => f.title.indexOf('todo-board-sync-') === 0).length));
  await p4.close();

  console.log('— merge keeps both sides —');
  const p5 = await open(fresh + '\n' + stub);
  // push a baseline, then let each side add a different card
  await p5.click('#btnSettings'); await p5.waitForTimeout(300);
  await p5.click('[data-autosync="1"]'); await p5.waitForTimeout(200);
  await p5.click('#setClose'); await p5.waitForTimeout(200);
  await p5.click('#btnPush'); await p5.waitForTimeout(700);

  await p5.evaluate(() => {
    // a remote edit: same board, one extra card, saved later
    const all = window.__mcp.drive;
    const base = JSON.parse(all[all.length - 1].body);
    const bd = base.boards[0];
    const id = 'k_remote_only';
    bd.cards[id] = { id: id, title: 'งานที่มาจากอีกเครื่อง', note: '', due: '', pri: 'mid',
      tags: [], log: [], repeat: '', calEventId: '', calDue: '', checks: [], files: [],
      created: Date.now(), movedAt: Date.now(), editedAt: Date.now() + 1000, doneAt: 0 };
    bd.columns[0].cards.push(id);
    base.savedAt = Date.now() + 5000;
    all.push({ id: 'fRemote', title: 'todo-board-sync-2099-01-01-1200.json',
      body: JSON.stringify(base), createdTime: new Date(Date.now() + 5000).toISOString() });
    window.__mcp.drive = all;
  });

  await p5.click('.col:first-child [data-add]');
  await p5.fill('#composerInput', 'งานที่เพิ่มบนเครื่องนี้');
  await p5.keyboard.press('Enter'); await p5.waitForTimeout(300);
  await p5.keyboard.press('Escape');

  await p5.reload(); await p5.waitForTimeout(1200);
  await check('merged without asking', async () => await p5.isHidden('#syncUseDrive'));
  const titles = p => p.evaluate(k =>
    Object.values(JSON.parse(localStorage.getItem(k)).boards[0].cards).map(c => c.title), KEY);
  await check('remote card is here', async () =>
    (await titles(p5)).includes('งานที่มาจากอีกเครื่อง'));
  await check('local card survived', async () =>
    (await titles(p5)).includes('งานที่เพิ่มบนเครื่องนี้'));
  await check('no duplicates', async () => await p5.evaluate(k => {
    const cards = Object.values(JSON.parse(localStorage.getItem(k)).boards[0].cards);
    const titles = cards.map(c => c.title);
    return titles.length === new Set(titles).size ? titles.length + ' unique' : false;
  }, KEY));
  await p5.close();

  console.log('— a delete is not undone by a merge —');
  const p6 = await open(fresh + '\n' + stub);
  await p6.click('#btnSettings'); await p6.waitForTimeout(300);
  await p6.click('[data-autosync="1"]'); await p6.waitForTimeout(200);
  await p6.click('#setClose'); await p6.waitForTimeout(200);
  await p6.click('#btnPush'); await p6.waitForTimeout(700);
  // delete a card locally, then let Drive present an older copy that still has it
  const gone = await p6.evaluate(() => document.querySelector('.card .card-title').textContent);
  await p6.click('.card'); await p6.waitForTimeout(300);
  await p6.click('#fDelete'); await p6.waitForTimeout(400);
  await p6.evaluate(() => {
    const all = window.__mcp.drive;
    const base = JSON.parse(all[all.length - 1].body);
    base.savedAt = Date.now() + 5000;
    all.push({ id: 'fOld', title: 'todo-board-sync-2099-02-02-1200.json',
      body: JSON.stringify(base), createdTime: new Date(Date.now() + 6000).toISOString() });
    window.__mcp.drive = all;
  });
  await p6.reload(); await p6.waitForTimeout(1200);
  await check('deleted card stayed deleted', async () => await p6.evaluate(t => {
    const stored = Object.values(JSON.parse(localStorage.getItem('jeno.board.v1')).boards[0].cards);
    const rendered = [...document.querySelectorAll('.card-title')].map(e => e.textContent);
    return !stored.some(c => c.title === t) && !rendered.includes(t);
  }, gone));
  await check('tombstone kept', async () => await p6.evaluate(k =>
    Object.keys(JSON.parse(localStorage.getItem(k)).deleted).length, KEY));
  await p6.close();

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(errors.length ? 'JS ERRORS:\n' + errors.slice(0, 8).join('\n') : 'No JS errors.');
  await browser.close();
})();
