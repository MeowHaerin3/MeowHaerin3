const { chromium } = require('playwright');
const fs = require('fs');
const OUT = require('./_env').OUT;

const body = fs.readFileSync(require('./_env').SRC, 'utf8');
fs.writeFileSync(OUT + '/page.html',
  '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' +
  body + '</body></html>');

let pass = 0, fail = 0;

(async () => {
  const browser = await chromium.launch({ executablePath: require('./_env').CHROME });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 950 }, locale: 'th-TH' });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  const check = async (label, fn) => {
    try {
      const r = await fn();
      const bad = r === false;
      bad ? fail++ : pass++;
      console.log('  ' + (bad ? '✗' : '✓') + ' ' + label + (r !== undefined ? ' → ' + r : ''));
    } catch (e) { fail++; console.log('  ✗ ' + label + ' → ' + e.message); }
  };

  await page.goto('file://' + OUT + '/page.html');
  await page.waitForTimeout(350);

  console.log('— boot (Thai default) —');
  await check('settings button label', async () => await page.textContent('#btnSettings'));
  await check('nav tabs', async () => (await page.$$eval('#nav button', e => e.map(x => x.textContent.replace(/\d+$/, '')))).join(' | '));
  await check('tile labels', async () => (await page.$$eval('.tile .lbl', e => e.map(x => x.textContent))).join(' | '));
  await check('html lang', async () => await page.getAttribute('html', 'lang'));
  await check('data-font', async () => await page.getAttribute('html', 'data-font'));

  console.log('— activity log on a task —');
  // the seeded OEE card ships with a 3-entry history
  await page.click('.col:nth-child(2) .card');
  await page.waitForTimeout(250);
  await check('log section present', async () => await page.isVisible('#logSection'));
  await check('seeded entries', async () => (await page.$$('.log-entry')).length);
  await check('date headings group them', async () => (await page.$$('.log-day')).length);
  await check('log heading', async () => await page.textContent('.log-head h3'));

  await page.fill('#logInput', 'ลูกค้าขอเพิ่มฟิลเตอร์ตามกะการผลิต');
  await page.click('#logAdd');
  await page.waitForTimeout(250);
  await check('entry appended', async () => (await page.$$('.log-entry')).length);
  await check('input cleared', async () => (await page.inputValue('#logInput')) === '');
  await check('newest entry text', async () => await page.textContent('.log-entry:last-child .log-text'));
  await check('grouped under today', async () =>
    await page.$$eval('.log-day', e => e[e.length - 1].textContent));
  await check('persisted', async () => await page.evaluate(() => {
    const cards = JSON.parse(localStorage.getItem('jeno.board.v1')).boards[0].cards;
    return Object.values(cards).some(c => (c.log || []).some(g => g.text.includes('กะการผลิต')));
  }));

  console.log('— Ctrl+Enter adds, not saves —');
  await page.fill('#logInput', 'ขอเพิ่มสิทธิ์ผู้ใช้ระดับหัวหน้ากะ');
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(250);
  await check('editor still open', async () => await page.isVisible('#fTitle'));
  await check('entry count', async () => (await page.$$('.log-entry')).length);

  console.log('— delete an entry + undo —');
  const before = (await page.$$('.log-entry')).length;
  await page.hover('.log-entry:last-child');
  await page.click('.log-entry:last-child .log-del');
  await page.waitForTimeout(250);
  await check('entry removed', async () => (await page.$$('.log-entry')).length === before - 1);
  await check('undo offered', async () => await page.isVisible('#toastAction'));
  await page.click('#toastAction');
  await page.waitForTimeout(250);
  await check('entry restored', async () => (await page.$$('.log-entry')).length === before);

  console.log('— pending text is kept on save —');
  await page.fill('#logInput', 'ยังไม่กดเพิ่ม แต่กดบันทึกเลย');
  await page.click('#fSave');
  await page.waitForTimeout(250);
  await check('pending update captured', async () => await page.evaluate(() => {
    const cards = JSON.parse(localStorage.getItem('jeno.board.v1')).boards[0].cards;
    return Object.values(cards).some(c => (c.log || []).some(g => g.text.includes('ยังไม่กดเพิ่ม')));
  }));

  console.log('— log count marker —');
  await check('chip on the card', async () => (await page.$$('.card .chip.log-count')).length);
  await check('chip goes hot at 3+', async () => (await page.$$('.card .chip.log-count.hot')).length);
  await page.click('[data-page="remain"]');
  await page.waitForTimeout(250);
  await check('chip on summary rows', async () => (await page.$$('.row .chip.log-count')).length);

  console.log('— search reaches into the log —');
  await page.fill('#search', 'กะการผลิต');
  await page.waitForTimeout(250);
  await check('found via log text', async () => (await page.$$('#page .row')).length);
  await page.click('#clearSearch');
  await page.waitForTimeout(200);

  console.log('— settings: font —');
  await page.click('#btnSettings');
  await page.waitForTimeout(250);
  await check('settings sheet', async () => await page.isVisible('#langPick'));
  await check('font options', async () => (await page.$$('.font-opt')).length);
  await page.click('[data-font-opt="serif"]');
  await page.waitForTimeout(250);
  await check('data-font changed', async () => await page.getAttribute('html', 'data-font'));
  await check('font actually applied', async () => await page.evaluate(() =>
    getComputedStyle(document.body).fontFamily.toLowerCase().includes('serif')));
  await check('sheet stays open', async () => await page.isVisible('.font-opts'));
  await check('selection marked', async () => await page.getAttribute('[data-font-opt="serif"]', 'aria-pressed'));
  await page.click('[data-font-opt="sans"]');
  await page.waitForTimeout(200);

  console.log('— settings: language —');
  await page.click('[data-lang="en"]');
  await page.waitForTimeout(300);
  await check('html lang', async () => await page.getAttribute('html', 'lang'));
  await check('settings sheet retranslated', async () => await page.textContent('#sheetTitle'));
  await page.click('#setClose');
  await page.waitForTimeout(250);
  await check('buttons in EN', async () => await page.textContent('#btnSettings'));
  await check('nav in EN', async () => (await page.$$eval('#nav button', e => e.map(x => x.textContent.replace(/\d+$/, '')))).join(' | '));
  await check('tiles in EN', async () => (await page.$$eval('.tile .lbl', e => e.map(x => x.textContent))).join(' | '));
  await check('search placeholder in EN', async () => await page.getAttribute('#search', 'placeholder'));
  await check('group headings in EN', async () => (await page.$$eval('.group-head', e => e.map(x => x.firstChild.textContent.trim()))).join(' | '));
  await check('controls in EN', async () => (await page.$$eval('.control-group > span', e => e.map(x => x.textContent))).join(' | '));
  await check('user task text NOT translated', async () =>
    (await page.textContent('#page .row-title')).length > 0 && !/^Task/.test(await page.textContent('#page .row-title')));

  console.log('— EN across the other pages —');
  await page.click('[data-page="today"]');
  await page.waitForTimeout(250);
  await check('today panels in EN', async () => (await page.$$eval('.panel-head h2', e => e.map(x => x.textContent))).join(' | '));
  await page.click('[data-page="due"]');
  await page.waitForTimeout(250);
  await check('buckets in EN', async () => (await page.$$eval('.group-head', e => e.map(x => x.firstChild.textContent.trim()))).join(' | '));
  await check('chart caption in EN', async () => await page.textContent('.chart-caption strong'));
  await check('axis weekdays in EN', async () => (await page.$$eval('.axis small', e => e.slice(0, 4).map(x => x.textContent))).join(' '));
  const day = await page.$('.day:not(.empty)');
  await day.hover();
  await page.waitForTimeout(250);
  await check('tooltip in EN', async () => (await page.textContent('#tip')).slice(0, 40));
  await page.mouse.move(5, 5);

  console.log('— EN editor + dialogs —');
  await page.click('[data-page="board"]');
  await page.waitForTimeout(200);
  await page.click('.card');
  await page.waitForTimeout(250);
  await check('editor labels in EN', async () => (await page.$$eval('.field > label', e => e.slice(0, 4).map(x => x.textContent))).join(' | '));
  await check('log section in EN', async () => await page.textContent('.log-head h3'));
  await page.click('#fCancel');
  await page.click('#addCol');
  await page.waitForTimeout(250);
  await check('add-column sheet in EN', async () => await page.textContent('#sheetTitle'));
  await page.click('#askCancel');

  console.log('— language choice persists —');
  await page.reload();
  await page.waitForTimeout(350);
  await check('still EN after reload', async () => await page.textContent('#btnSettings'));
  await check('font persisted', async () => await page.getAttribute('html', 'data-font'));
  await check('log survived reload', async () => await page.evaluate(() => {
    const cards = JSON.parse(localStorage.getItem('jeno.board.v1')).boards[0].cards;
    return Object.values(cards).reduce((n, c) => n + (c.log || []).length, 0);
  }));

  console.log('— a fresh EN visitor gets an EN starter board —');
  const p2 = await ctx.newPage();
  await p2.addInitScript(() => {
    try { localStorage.clear(); localStorage.setItem('jeno.board.v1.ui', JSON.stringify({ lang: 'en' })); } catch (e) {}
  });
  await p2.goto('file://' + OUT + '/page.html');
  await p2.waitForTimeout(350);
  await check('EN column names', async () => (await p2.$$eval('.col-head h2', e => e.map(x => x.textContent))).join(' | '));
  await check('EN seeded log', async () => await p2.evaluate(() => {
    const cards = JSON.parse(localStorage.getItem('jeno.board.v1')).boards[0].cards;
    const c = Object.values(cards).find(x => (x.log || []).length);
    return c ? c.log[0].text : 'none';
  }));
  await p2.close();

  console.log('— board regression still green —');
  await page.click('[data-page="board"]');
  await page.waitForTimeout(200);
  await check('cards render', async () => (await page.$$('.card')).length);
  await check('drag still works', async () => {
    const n0 = await page.evaluate(() => document.querySelectorAll('.col')[3].querySelectorAll('.card').length);
    await page.evaluate(() => {
      const card = document.querySelectorAll('.col')[0].querySelector('.card');
      const target = document.querySelectorAll('.col-body')[3];
      const dt = new DataTransfer();
      card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: target.getBoundingClientRect().bottom - 4 }));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      card.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    });
    await page.waitForTimeout(250);
    const n1 = await page.evaluate(() => document.querySelectorAll('.col')[3].querySelectorAll('.card').length);
    return n1 === n0 + 1;
  });
  await check('no body h-scroll', async () =>
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  // screenshots
  await page.click('.col:nth-child(2) .card');
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + '/s-editor-en.png' });
  await page.click('#fCancel');
  await page.click('#btnSettings');
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + '/s-settings.png' });
  await page.click('#setClose');
  await page.click('[data-lang="th"]').catch(() => {});
  await page.evaluate(() => {
    const ui = JSON.parse(localStorage.getItem('jeno.board.v1.ui'));
    ui.lang = 'th'; localStorage.setItem('jeno.board.v1.ui', JSON.stringify(ui));
  });
  await page.reload();
  await page.waitForTimeout(350);
  await page.click('.col:nth-child(2) .card');
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + '/s-editor-th.png' });

  // mobile
  const m = await ctx.newPage();
  await m.setViewportSize({ width: 390, height: 844 });
  await m.goto('file://' + OUT + '/page.html');
  await m.waitForTimeout(350);
  console.log('— mobile —');
  await check('no h-scroll', async () =>
    await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await m.click('.col:nth-child(2) .card');
  await m.waitForTimeout(300);
  await check('editor fits', async () =>
    await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await m.screenshot({ path: OUT + '/s-editor-mobile.png' });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(errors.length ? 'JS ERRORS:\n' + errors.join('\n') : 'No JS errors.');
  await browser.close();
})();
