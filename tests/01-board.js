const { chromium } = require('playwright');
const fs = require('fs');

const SRC = require('./_env').SRC;
const OUT = require('./_env').OUT;

// mimic the artifact wrapper: doctype + head + body around the file
const body = fs.readFileSync(SRC, 'utf8');
fs.writeFileSync(OUT + '/page.html',
  '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' +
  body + '</body></html>');

(async () => {
  const browser = await chromium.launch({ executablePath: require('./_env').CHROME });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto('file://' + OUT + '/page.html');
  await page.waitForTimeout(300);

  const check = async (label, fn) => {
    try { const r = await fn(); console.log('  ✓ ' + label + (r !== undefined ? ' → ' + r : '')); }
    catch (e) { console.log('  ✗ ' + label + ' → ' + e.message); }
  };

  console.log('— initial render —');
  await check('columns', async () => (await page.$$('.col')).length);
  await check('cards', async () => (await page.$$('.card')).length);
  await check('pulse tiles', async () => (await page.$$('.tile')).length);
  await check('pulse note', async () => (await page.textContent('#pulseNote')).trim().slice(0, 60));
  await check('today stamp', async () => await page.textContent('#todayStamp'));
  await check('no h-scroll on body', async () =>
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  console.log('— add a card via composer —');
  await page.click('.col:first-child [data-add]');
  await page.fill('#composerInput', 'ทดสอบ: ส่งใบเสร็จให้บัญชี');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  await check('card added', async () =>
    await page.evaluate(() => document.querySelectorAll('.col')[0].querySelectorAll('.card').length));
  await check('persisted to localStorage', async () =>
    await page.evaluate(() => JSON.parse(localStorage.getItem('jeno.board.v1')).boards[0].columns[0].cards.length));
  await page.keyboard.press('Escape');

  console.log('— open editor, set due today + high priority —');
  await page.click('.col:first-child .card:last-of-type');
  await page.waitForTimeout(120);
  await check('editor open', async () => await page.isVisible('#sheet'));
  await page.click('[data-quick="0"]');
  await page.click('#fPri [data-v="high"]');
  await page.fill('#fTags', 'งาน, ด่วน');
  await page.click('#fSave');
  await page.waitForTimeout(150);
  await check('due-today chip present', async () => (await page.$$('.chip.due-today')).length);
  await check('high-priority stripe', async () => (await page.$$('.card.p-high')).length);
  await check('overdue tile still 0', async () => await page.textContent('.tile.t-over .n'));
  await check('today tile', async () => await page.textContent('.tile.t-today .n'));

  console.log('— filter by "ครบวันนี้" —');
  await page.click('.tile.t-today');
  await page.waitForTimeout(120);
  await check('filter pill shown', async () => await page.isVisible('.filter-tag'));
  await check('visible cards', async () => (await page.$$('.card')).length);
  await page.click('#clearFilter');
  await page.waitForTimeout(120);

  console.log('— search —');
  await page.fill('#search', 'ใบเสร็จ');
  await page.waitForTimeout(150);
  await check('search narrows to 1', async () => (await page.$$('.card')).length);
  await page.click('#clearSearch');
  await page.waitForTimeout(120);

  console.log('— nudge card right across columns —');
  const firstBefore = await page.evaluate(() => document.querySelectorAll('.col')[1].querySelectorAll('.card').length);
  await page.click('.col:first-child .card:first-of-type [data-nudge="1"]');
  await page.waitForTimeout(150);
  await check('col2 grew', async () =>
    (await page.evaluate(() => document.querySelectorAll('.col')[1].querySelectorAll('.card').length)) === firstBefore + 1);

  console.log('— drag card to the done column —');
  await page.evaluate(() => {
    // reorder-by-drag is HTML5 DnD; drive the same code path the drop handler uses
    const card = document.querySelectorAll('.col')[0].querySelector('.card');
    const src = card.getBoundingClientRect();
    const target = document.querySelectorAll('.col-body')[3];
    const dt = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('dragover', {
      bubbles: true, cancelable: true, dataTransfer: dt,
      clientY: target.getBoundingClientRect().bottom - 4
    }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    card.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    window.__srcTop = src.top;
  });
  await page.waitForTimeout(200);
  await check('done column has cards', async () =>
    await page.evaluate(() => document.querySelectorAll('.col')[3].querySelectorAll('.card').length));
  await check('done card is struck through', async () => (await page.$$('.card.is-done')).length > 0);

  console.log('— column menu: rename via in-page sheet —');
  await page.click('.col:first-child [data-menu]');
  await page.waitForTimeout(100);
  await check('menu open', async () => await page.isVisible('.menu'));
  await page.click('[data-act="rename"]');
  await page.waitForTimeout(150);
  await check('rename sheet open', async () => await page.isVisible('#askInput'));
  await page.fill('#askInput', 'ค้างอยู่');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  await check('renamed', async () => await page.textContent('.col:first-child h2'));

  console.log('— add column via in-page sheet —');
  await page.click('#addCol');
  await page.waitForTimeout(150);
  await page.fill('#askInput', 'ไว้ค่อยทำ');
  await page.click('#askOk');
  await page.waitForTimeout(150);
  await check('column count', async () => (await page.$$('.col')).length);

  console.log('— delete card + undo —');
  await page.click('.col:first-child .card:first-of-type');
  await page.waitForTimeout(120);
  const titleGone = await page.inputValue('#fTitle');
  await page.click('#fDelete');
  await page.waitForTimeout(150);
  await check('toast with undo', async () => await page.isVisible('#toastAction'));
  await page.click('#toastAction');
  await page.waitForTimeout(150);
  await check('card restored', async () =>
    await page.evaluate(t => !!Object.values(JSON.parse(localStorage.getItem('jeno.board.v1')).boards[0].cards)
      .find(c => c.title === t), titleGone));

  console.log('— reload keeps state —');
  const before = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('jeno.board.v1')).boards[0].cards).length);
  await page.reload();
  await page.waitForTimeout(300);
  await check('cards survive reload', async () =>
    (await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('jeno.board.v1')).boards[0].cards).length)) === before);
  await check('rendered after reload', async () => (await page.$$('.card')).length);

  console.log('— reset board sheet —');
  await page.click('#btnReset');
  await page.waitForTimeout(150);
  await check('confirm sheet open', async () => await page.isVisible('#cfOk'));
  await page.click('#cfCancel');
  await page.waitForTimeout(100);
  await check('cancelled, board intact', async () =>
    (await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('jeno.board.v1')).boards[0].cards).length)) === before);

  // screenshots
  await page.screenshot({ path: OUT + '/light.png', fullPage: false });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(200);
  await page.screenshot({ path: OUT + '/dark.png', fullPage: false });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await page.waitForTimeout(200);
  await page.screenshot({ path: OUT + '/toggle-light-over-dark-os.png' });

  // mobile
  const m = await ctx.newPage();
  await m.setViewportSize({ width: 390, height: 844 });
  await m.goto('file://' + OUT + '/page.html');
  await m.waitForTimeout(300);
  console.log('— mobile —');
  await check('no body h-scroll @390', async () =>
    await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await m.screenshot({ path: OUT + '/mobile.png' });

  console.log('\n' + (errors.length ? 'JS ERRORS:\n' + errors.join('\n') : 'No JS errors.'));
  await browser.close();
})();
