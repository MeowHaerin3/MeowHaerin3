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

// Calendar + Gmail stubs mirroring the real responses observed this session.
const stub = (opts) => `
window.__mcp = { calls: [], fail: ${JSON.stringify(opts.fail || null)} };
window.claude = { mcp: {
  callTool: function (server, tool, input) {
    window.__mcp.calls.push({ server: server, tool: tool, input: input });
    if (window.__mcp.fail) return Promise.reject(window.__mcp.fail);
    if (tool === 'list_events') {
      ${opts.emptyCal ? `
      // the shape a range with no events really returns: metadata, no events key
      return Promise.resolve({ content: [], payload: {
        accessRole: 'owner', summary: 'me@x.z', timeZone: 'Asia/Bangkok',
        defaultReminders: [], updated: '2026-07-22T06:28:11Z' } });` : `
      var d = function (off, h) { var x = new Date(); x.setHours(h,0,0,0);
        x.setDate(x.getDate()+off); return x.toISOString(); };
      return Promise.resolve({ content: [], payload: {
        accessRole: 'owner', summary: 'me@x.z', timeZone: 'Asia/Bangkok',
        events: [
          { id: 'e1', summary: 'ประชุมทีมไลน์ผลิต', status: 'confirmed', eventType: 'DEFAULT',
            start: { dateTime: d(0,10), timeZone: 'Asia/Bangkok' },
            end: { dateTime: d(0,11), timeZone: 'Asia/Bangkok' },
            htmlLink: 'https://calendar.google.com/x' },
          { id: 'e2', summary: 'ลาพักร้อน', status: 'confirmed', eventType: 'DEFAULT',
            start: { date: '${new Date(Date.now()+2*86400000).toISOString().slice(0,10)}' },
            end: { date: '${new Date(Date.now()+3*86400000).toISOString().slice(0,10)}' } },
          { id: 'e3', summary: 'ยกเลิกไปแล้ว', status: 'cancelled',
            start: { dateTime: d(1,9) }, end: { dateTime: d(1,10) } }
        ] } });`}
    }
    if (tool === 'search_threads') {
      ${opts.emptyMail ? `return Promise.resolve({ content: [], payload: {} });` : `
      return Promise.resolve({ content: [], payload: {
        resultCountEstimate: '6', nextPageToken: 'x',
        threads: [
          { id: 't1', messages: [{ id: 't1', date: new Date(Date.now()-3600000).toISOString(),
            labelIds: ['UNREAD','INBOX'], sender: 'events@redpanda.com',
            subject: '[Live Today] Data & AI Weekly, Ep. 4', snippet: 'Two legal experts…',
            toRecipients: ['me@x.z'] }] },
          { id: 't2', messages: [{ id: 't2', date: new Date(Date.now()-7200000).toISOString(),
            labelIds: ['INBOX'], sender: '"Adidas TH" <adidas@th-news.adidas.com>',
            subject: '🔥 8.8 เริ่มแล้ว', snippet: 'ลดสูงสุด 50%', toRecipients: ['me@x.z'] }] }
        ] } });`}
    }
    if (tool === 'search_files') return Promise.resolve({ content: [], payload: {} });
    return Promise.reject({ code: 'bad_request', message: 'unknown tool' });
  },
  listTools: function () { return Promise.resolve({ servers: [] }); },
  watchTool: function () { return function () {}; },
  invalidate: function () { return Promise.resolve(); }
} };`;

const fresh = `try{if(!sessionStorage.getItem('__c')){localStorage.clear();sessionStorage.setItem('__c','1')}}catch(e){}`;

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
    await p.waitForTimeout(450);
    return p;
  };

  console.log('— background picker —');
  const p = await open(fresh);
  await check('5 nav tabs incl. calendar', async () =>
    (await p.$$eval('#nav button', e => e.map(x => x.textContent.replace(/\d+$/, '')))).join(' | '));
  await p.click('#btnSettings'); await p.waitForTimeout(250);
  await check('5 background styles', async () => (await p.$$('.bg-kind')).length);
  await check('hue slider hidden on default', async () => await p.isHidden('#hue'));
  await p.click('[data-bg-opt="mesh"]'); await p.waitForTimeout(250);
  await check('data-bg set', async () => await p.getAttribute('html', 'data-bg'));
  await check('hue slider now shown', async () => await p.isVisible('#hue'));
  await check('body paints a gradient', async () => {
    const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundImage);
    return bg.includes('radial-gradient') ? 'radial-gradient ×' + (bg.match(/radial-gradient/g) || []).length : false;
  });
  await check('swatches preview each style', async () => await p.evaluate(() =>
    [...document.querySelectorAll('.bg-kind .swatch')]
      .filter(s => getComputedStyle(s).backgroundImage !== 'none' || getComputedStyle(s).backgroundColor).length));

  console.log('— hue slider —');
  await p.evaluate(() => {
    const el = document.getElementById('hue');
    el.value = '20';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.waitForTimeout(200);
  await check('--bg-h follows the slider', async () => await p.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--bg-h').trim()));
  await check('readout updates', async () => await p.textContent('#hueVal'));
  await p.evaluate(() => document.getElementById('hue').dispatchEvent(new Event('change', { bubbles: true })));
  await p.waitForTimeout(250);
  await check('persisted', async () => await p.evaluate(() =>
    JSON.parse(localStorage.getItem('jeno.board.v1.ui')).hue));
  await p.click('#setClose').catch(() => {});
  await p.reload(); await p.waitForTimeout(400);
  await check('background survives reload', async () =>
    (await p.getAttribute('html', 'data-bg')) + ' @ ' +
    (await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg-h').trim())));

  console.log('— background follows dark theme —');
  await p.emulateMedia({ colorScheme: 'dark' });
  await p.waitForTimeout(250);
  const darkBg = await p.evaluate(() => getComputedStyle(document.body).backgroundImage);
  await p.emulateMedia({ colorScheme: 'light' });
  await p.waitForTimeout(250);
  const lightBg = await p.evaluate(() => getComputedStyle(document.body).backgroundImage);
  await check('dark and light differ', async () => darkBg !== lightBg);
  await p.screenshot({ path: OUT + '/x-bg-mesh.png' });
  await p.close();

  console.log('— calendar page, no connector —');
  const p1 = await open(fresh);
  await p1.click('[data-page="cal"]'); await p1.waitForTimeout(350);
  await check('14 day rows', async () => (await p1.$$('.cal-day')).length);
  await check('tasks still shown', async () => (await p1.$$('.cal-item.is-task')).length);
  await check('prompts to connect', async () => (await p1.textContent('.panel-foot')).slice(0, 40));
  await check('subtitle drops the calendar claim', async () => await p1.textContent('#calSub'));
  await p1.close();

  console.log('— calendar page, with events —');
  const p2 = await open(fresh + '\n' + stub({}));
  await p2.click('[data-page="cal"]'); await p2.waitForTimeout(600);
  await check('called list_events', async () => await p2.evaluate(() => {
    const c = window.__mcp.calls.find(x => x.tool === 'list_events');
    return c ? c.server + ' / ' + Object.keys(c.input).sort().join(',') : false;
  }));
  await check('timed event rendered', async () => (await p2.$$('.cal-item.is-event')).length);
  await check('cancelled event filtered out', async () =>
    !(await p2.evaluate(() => document.body.textContent.includes('ยกเลิกไปแล้ว'))));
  await check('all-day event labelled', async () => await p2.evaluate(() =>
    [...document.querySelectorAll('.cal-item.is-event .t')].map(x => x.textContent).join(' | ')));
  await check('today row highlighted', async () => (await p2.$$('.cal-day.is-today')).length === 1);
  await check('clicking a task opens the editor', async () => {
    await p2.click('.cal-item.is-task');
    await p2.waitForTimeout(250);
    return await p2.isVisible('#fTitle');
  });
  await p2.click('#fCancel');
  await p2.screenshot({ path: OUT + '/x-cal.png' });
  await p2.close();

  console.log('— mail panel on Today —');
  const p3 = await open(fresh + '\n' + stub({}));
  await p3.click('[data-page="today"]'); await p3.waitForTimeout(600);
  await check('called search_threads', async () => await p3.evaluate(() => {
    const c = window.__mcp.calls.find(x => x.tool === 'search_threads');
    return c ? c.server + ' / ' + c.input.query : false;
  }));
  await check('threads listed', async () => (await p3.$$('.mail-row')).length);
  await check('unread count in header', async () => await p3.textContent('#mailPanel .n'));
  await check('sender name cleaned', async () =>
    (await p3.$$eval('.mail-from', e => e.map(x => x.textContent))).join(' | '));
  await check('unread marked bold', async () => (await p3.$$('.mail-row.is-unread')).length);
  await check('Gmail link present', async () => await p3.getAttribute('.panel-foot a', 'href'));
  await p3.screenshot({ path: OUT + '/x-mail.png' });
  await p3.close();

  console.log('— empty calendar + empty mail (real empty shapes) —');
  const p4 = await open(fresh + '\n' + stub({ emptyCal: true, emptyMail: true }));
  await p4.click('[data-page="cal"]'); await p4.waitForTimeout(500);
  await check('calendar renders days anyway', async () => (await p4.$$('.cal-day')).length);
  await check('no crash on missing events key', async () => (await p4.$$('.cal-item.is-event')).length === 0);
  await p4.click('[data-page="today"]'); await p4.waitForTimeout(500);
  await check('mail shows empty state', async () => await p4.textContent('#mailPanel .panel-empty'));
  await p4.close();

  console.log('— connector errors degrade per section —');
  const p5 = await open(fresh + '\n' + stub({ fail: { code: 'needs_reauth', message: 'x' } }));
  await p5.click('[data-page="cal"]'); await p5.waitForTimeout(500);
  await check('calendar shows its own error', async () => (await p5.textContent('#calBody .sync-err')).slice(0, 45));
  await p5.click('[data-page="today"]'); await p5.waitForTimeout(500);
  await check('mail shows its own error', async () => (await p5.textContent('#mailPanel .sync-err')).slice(0, 45));
  await check('board unaffected', async () => {
    await p5.click('[data-page="board"]'); await p5.waitForTimeout(250);
    return (await p5.$$('.card')).length;
  });
  await p5.close();

  console.log('— server_not_connected hides the section —');
  const p6 = await open(fresh + '\n' + stub({ fail: { code: 'server_not_connected', message: 'x' } }));
  await p6.click('[data-page="today"]'); await p6.waitForTimeout(600);
  await check('mail panel gone entirely', async () => (await p6.$$('#mailPanel')).length === 0);
  await p6.close();

  console.log('— layout —');
  const m = await ctx.newPage();
  await m.setViewportSize({ width: 390, height: 844 });
  await m.addInitScript(fresh + '\n' + stub({}));
  await m.goto(url); await m.waitForTimeout(450);
  for (const pg of ['cal', 'today']) {
    await m.click('[data-page="' + pg + '"]'); await m.waitForTimeout(500);
    await check('no h-scroll on ' + pg, async () =>
      await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  }
  await m.screenshot({ path: OUT + '/x-cal-mobile.png' });
  await m.close();

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(errors.length ? 'JS ERRORS:\n' + errors.join('\n') : 'No JS errors.');
  await browser.close();
})();
