const { chromium } = require('playwright');
const fs = require('fs');
const OUT = require('./_env').OUT;

const body = fs.readFileSync(require('./_env').SRC, 'utf8');
fs.writeFileSync(OUT + '/page.html',
  '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' +
  body + '</body></html>');

(async () => {
  const browser = await chromium.launch({ executablePath: require('./_env').CHROME });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 950 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  const check = async (label, fn) => {
    try { const r = await fn(); console.log('  ' + (r === false ? '✗' : '✓') + ' ' + label + (r !== undefined ? ' → ' + r : '')); }
    catch (e) { console.log('  ✗ ' + label + ' → ' + e.message); }
  };

  await page.goto('file://' + OUT + '/page.html');
  await page.waitForTimeout(300);

  // seed a spread of due dates so the load strip has something to plot
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('jeno.board.v1'));
    const iso = d => { const x = new Date(); x.setHours(12,0,0,0); x.setDate(x.getDate()+d);
      return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0'); };
    const add = (title, due, pri, col) => {
      const id = 'k_seed' + Math.random().toString(36).slice(2,8);
      raw.boards[0].cards[id] = { id, title, note:'', due, pri, tags:[], log:[], repeat:'',
        calEventId:'', created: Date.now(), movedAt: Date.now(), doneAt: 0 };
      raw.boards[0].columns[col].cards.push(id);
    };
    add('ส่งรายงานประจำเดือน', iso(-3), 'high', 0);
    add('ตอบเมลลูกค้า', iso(-1), 'mid', 0);
    add('เตรียมสไลด์ประชุม', iso(3), 'high', 1);
    add('รีวิว PR ของทีม', iso(3), 'mid', 0);
    add('อัปเดตเอกสาร API', iso(3), 'low', 0);
    add('สั่งอะไหล่เซนเซอร์', iso(6), 'mid', 0);
    add('ตรวจ backup รายเดือน', iso(11), 'low', 0);
    localStorage.setItem('jeno.board.v1', JSON.stringify(raw));
  });
  await page.reload();
  await page.waitForTimeout(300);

  console.log('— nav —');
  await check('four tabs', async () => (await page.$$('#nav button')).length);
  await check('board is default', async () => await page.isVisible('#board'));
  await check('overdue badge on สรุปวันนี้', async () => await page.textContent('#nav .badge'));

  console.log('— page: สรุปวันนี้ —');
  await page.click('[data-page="today"]');
  await page.waitForTimeout(200);
  await check('board hidden', async () => !(await page.isVisible('#board')));
  await check('panels', async () => (await page.$$('#page .panel')).length);
  await check('panel titles', async () =>
    (await page.$$eval('#page .panel-head h2', els => els.map(e => e.textContent))).join(' | '));
  await check('overdue rows', async () => (await page.$$('.panel.sev-over .row')).length);
  await page.screenshot({ path: OUT + '/p-today.png' });

  console.log('— tick a task off from the summary —');
  const beforeOver = (await page.$$('.panel.sev-over .row')).length;
  await page.click('.panel.sev-over .row:first-child .tick');
  await page.waitForTimeout(250);
  await check('overdue shrank', async () => (await page.$$('.panel.sev-over .row')).length === beforeOver - 1);
  await check('shows in ปิดไปแล้ววันนี้', async () => (await page.$$('.panel.sev-done .row')).length);
  await check('undo toast', async () => await page.isVisible('#toastAction'));
  await page.click('#toastAction');
  await page.waitForTimeout(250);
  await check('undo restored', async () => (await page.$$('.panel.sev-over .row')).length === beforeOver);

  console.log('— page: งานที่เหลือ —');
  await page.click('[data-page="remain"]');
  await page.waitForTimeout(200);
  await check('groups by column', async () =>
    (await page.$$eval('.group-head', els => els.map(e => e.firstChild.textContent.trim()))).join(' | '));
  await check('rows', async () => (await page.$$('#page .row')).length);
  await page.click('[data-group="pri"]');
  await page.waitForTimeout(200);
  await check('regroup by priority', async () =>
    (await page.$$eval('.group-head', els => els.map(e => e.firstChild.textContent.trim()))).join(' | '));
  await page.click('[data-group="tag"]');
  await page.waitForTimeout(200);
  await check('regroup by tag', async () =>
    (await page.$$eval('.group-head', els => els.map(e => e.firstChild.textContent.trim()))).join(' | '));
  await page.click('[data-group="col"]');
  await page.click('[data-sort="pri"]');
  await page.waitForTimeout(200);
  await check('sort control active', async () =>
    await page.getAttribute('[data-sort="pri"]', 'aria-pressed'));
  await page.screenshot({ path: OUT + '/p-remain.png' });

  console.log('— page: กำหนดส่ง —');
  await page.click('[data-page="due"]');
  await page.waitForTimeout(250);
  await check('load strip bars', async () => (await page.$$('.day')).length);
  await check('axis ticks', async () => (await page.$$('.axis .tick-lbl')).length);
  await check('chart subtitle', async () => await page.textContent('.chart-caption span'));
  await check('bars fit inside plot', async () => await page.evaluate(() => {
    const plot = document.querySelector('.plot').getBoundingClientRect();
    return [...document.querySelectorAll('.day')].every(d => {
      const r = d.getBoundingClientRect();
      return r.top >= plot.top - 0.5 && r.bottom <= plot.bottom + 0.5;
    });
  }));
  await check('cap labels (today + peak only)', async () => (await page.$$('.day .cap')).length);
  await check('due buckets', async () =>
    (await page.$$eval('.group-head', els => els.map(e => e.firstChild.textContent.trim()))).join(' | '));
  console.log('— tooltip —');
  const peakBar = await page.$('.day:not(.empty)');
  await peakBar.hover();
  await page.waitForTimeout(200);
  await check('tooltip visible', async () => await page.isVisible('#tip'));
  await check('tooltip text', async () => (await page.textContent('#tip')).slice(0, 50));
  await check('tooltip inside viewport', async () => await page.evaluate(() => {
    const r = document.querySelector('#tip').getBoundingClientRect();
    return r.left >= 0 && r.right <= window.innerWidth;
  }));
  await page.screenshot({ path: OUT + '/p-due.png' });
  await page.mouse.move(5, 5);

  console.log('— filters carry across pages —');
  await page.click('.tile.t-over');
  await page.waitForTimeout(200);
  await check('due page filtered to overdue', async () => (await page.$$('#page .row')).length);
  await page.click('#clearFilter');
  await page.waitForTimeout(150);
  await page.fill('#search', 'รายงาน');
  await page.waitForTimeout(200);
  await check('search narrows due page', async () => (await page.$$('#page .row')).length);
  await page.click('#clearSearch');
  await page.waitForTimeout(150);

  console.log('— tab persists across reload —');
  await page.reload();
  await page.waitForTimeout(300);
  await check('still on กำหนดส่ง', async () =>
    await page.getAttribute('[data-page="due"]', 'aria-current'));

  console.log('— row opens the same editor —');
  await page.click('#page .row .row-main');
  await page.waitForTimeout(200);
  await check('editor open', async () => await page.isVisible('#fTitle'));
  await check('editor title', async () => await page.inputValue('#fTitle'));
  await page.click('#fCancel');

  console.log('— back to board still works —');
  await page.click('[data-page="board"]');
  await page.waitForTimeout(200);
  await check('board visible', async () => await page.isVisible('#board'));
  await check('cards render', async () => (await page.$$('.card')).length);
  await check('no body h-scroll', async () =>
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  // dark theme on the due page
  await page.click('[data-page="due"]');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(250);
  await page.screenshot({ path: OUT + '/p-due-dark.png' });
  await page.emulateMedia({ colorScheme: 'light' });

  // mobile sweep
  const m = await ctx.newPage();
  await m.setViewportSize({ width: 390, height: 844 });
  await m.goto('file://' + OUT + '/page.html');
  await m.waitForTimeout(300);
  console.log('— mobile —');
  for (const p of ['today', 'remain', 'due']) {
    await m.click('[data-page="' + p + '"]');
    await m.waitForTimeout(250);
    await check('no h-scroll on ' + p, async () =>
      await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  }
  await m.screenshot({ path: OUT + '/m-due.png', fullPage: false });
  await m.click('[data-page="today"]');
  await m.waitForTimeout(200);
  await m.screenshot({ path: OUT + '/m-today.png' });

  console.log('\n' + (errors.length ? 'JS ERRORS:\n' + errors.join('\n') : 'No JS errors.'));
  await browser.close();
})();
