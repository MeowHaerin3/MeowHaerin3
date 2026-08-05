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

// A fake Drive whose payloads match exactly what the real connector returned.
const mcpStub = (opts) => `
// the fake Drive lives in sessionStorage so it survives page reloads,
// the way a real Drive would
window.__drive = {
  calls: [], fail: ${JSON.stringify(opts.fail || null)},
  get files() { try { return JSON.parse(sessionStorage.getItem('__drive') || '[]'); } catch (e) { return []; } },
  set files(v) { sessionStorage.setItem('__drive', JSON.stringify(v)); }
};
window.claude = {
  mcp: {
    callTool: function (server, tool, input) {
      window.__drive.calls.push({ server: server, tool: tool, input: input });
      if (window.__drive.fail) return Promise.reject(window.__drive.fail);
      if (tool === 'search_files') {
        var hits = window.__drive.files.filter(function (f) {
          return f.title.indexOf('todo-board-sync-') === 0;
        });
        // the real connector returns a bare {} when nothing matches
        if (!hits.length) return Promise.resolve({ content: [], payload: {} });
        return Promise.resolve({ content: [], payload: { files: hits.map(function (f) {
          return { id: f.id, title: f.title, mimeType: 'application/json',
                   createdTime: f.createdTime, modifiedTime: f.createdTime,
                   fileSize: String(f.body.length), owner: 'x@y.z' };
        }) } });
      }
      if (tool === 'download_file_content') {
        var f = window.__drive.files.filter(function (x) { return x.id === input.fileId; })[0];
        if (!f) return Promise.reject({ code: 'tool_error', message: 'not found' });
        var bytes = new TextEncoder().encode(f.body), bin = '';
        bytes.forEach(function (b) { bin += String.fromCharCode(b); });
        return Promise.resolve({ content: [], payload: {
          content: btoa(bin), id: f.id, mimeType: 'application/json', title: f.title } });
      }
      if (tool === 'create_file') {
        var all = window.__drive.files;
        var id = 'f' + (all.length + 1);
        all.push({ id: id, title: input.title, body: input.textContent,
          createdTime: new Date().toISOString() });
        window.__drive.files = all;
        return Promise.resolve({ content: [], payload: {
          id: id, title: input.title, mimeType: 'application/json',
          createdTime: new Date().toISOString(), fileSize: String(input.textContent.length),
          viewUrl: 'https://drive.google.com/file/d/' + id + '/view' } });
      }
      return Promise.reject({ code: 'bad_request', message: 'unknown tool' });
    },
    listTools: function () { return Promise.resolve({ servers: [] }); },
    watchTool: function () { return function () {}; },
    invalidate: function () { return Promise.resolve(); }
  }
};`;

(async () => {
  const browser = await chromium.launch({ executablePath: require('./_env').CHROME });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 950 } });
  const url = 'file://' + OUT + '/page.html';

  const open = async (initScript) => {
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    p.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
    await p.addInitScript(initScript);
    await p.goto(url);
    await p.waitForTimeout(450);
    return p;
  };

  console.log('— no MCP available: feature hides itself —');
  const p0 = await open(`try{if(!sessionStorage.getItem('__c')){localStorage.clear();sessionStorage.setItem('__c','1')}}catch(e){}`);
  await check('push button hidden', async () => await p0.isHidden('#btnPush'));
  await p0.click('#btnSettings'); await p0.waitForTimeout(250);
  await p0.click('[data-settab="link"]'); await p0.waitForTimeout(250);
  await check('settings shows unavailable', async () => (await p0.$$('.sync-state.is-off')).length === 1);
  await check('board still fully usable', async () => (await p0.$$('.card')).length);
  await p0.close();

  console.log('— MCP present, empty Drive —');
  const p1 = await open(`try{if(!sessionStorage.getItem('__c')){localStorage.clear();sessionStorage.setItem('__c','1')}}catch(e){}\n` + mcpStub({}));
  await check('push button visible', async () => await p1.isVisible('#btnPush'));
  await check('searched Drive on open', async () =>
    await p1.evaluate(() => window.__drive.calls.filter(c => c.tool === 'search_files').length));
  await check('search query shape', async () =>
    await p1.evaluate(() => window.__drive.calls[0].input.query));
  await check('server name', async () => await p1.evaluate(() => window.__drive.calls[0].server));
  await p1.click('#btnSettings'); await p1.waitForTimeout(250);
  await p1.click('[data-settab="link"]'); await p1.waitForTimeout(250);
  await check('status = never pushed', async () => await p1.textContent('.sync-state span:last-child'));

  console.log('— push —');
  await p1.click('#syncPush');
  await p1.waitForTimeout(400);
  await check('one file created', async () => await p1.evaluate(() => window.__drive.files.length));
  await check('filename shape', async () => await p1.evaluate(() => window.__drive.files[0].title));
  await check('mime + no conversion', async () => await p1.evaluate(() => {
    const c = window.__drive.calls.filter(x => x.tool === 'create_file')[0].input;
    return c.contentMimeType + ' / convert-off:' + c.disableConversionToGoogleType;
  }));
  await check('payload parses and carries savedAt', async () => await p1.evaluate(() => {
    const o = JSON.parse(window.__drive.files[0].body);
    return typeof o.savedAt === 'number' && Array.isArray(o.boards) && !!o.boards[0].cards;
  }));
  await check('toast confirmed', async () => await p1.textContent('#toastText'));
  await p1.click('#btnSettings').catch(() => {});
  await p1.waitForTimeout(200);
  await p1.click('[data-settab="link"]').catch(() => {});
  await p1.waitForTimeout(200);
  await check('status now shows a push time', async () =>
    (await p1.textContent('.sync-state span:last-child')).length > 8);

  // capture what Drive now holds, to hand to a "second device"
  const driveDump = await p1.evaluate(() => JSON.stringify(window.__drive.files));
  await p1.close();

  console.log('— second device, clean: auto-pulls silently —');
  const p2 = await open(`try{if(!sessionStorage.getItem('__c')){localStorage.clear();sessionStorage.setItem('__c','1')}}catch(e){}\n` + mcpStub({}) +
    `\nwindow.__seed = ${JSON.stringify(driveDump)};`);
  await p2.evaluate(() => { window.__drive.files = JSON.parse(window.__seed); });
  await p2.reload();
  await p2.waitForTimeout(600);
  await check('pulled automatically', async () => await p2.textContent('#toastText'));
  await check('cards match the pushed board', async () => (await p2.$$('.card')).length);
  await check('syncedAt recorded', async () => await p2.evaluate(() =>
    JSON.parse(localStorage.getItem('jeno.board.v1')).syncedAt > 0));

  console.log('— same device again: nothing new, stays quiet —');
  await p2.reload();
  await p2.waitForTimeout(600);
  await check('no pull toast', async () => await p2.isHidden('#toast'));
  await p2.click('#btnSettings'); await p2.waitForTimeout(250);
  await p2.click('[data-settab="link"]'); await p2.waitForTimeout(250);
  await p2.click('#syncPull'); await p2.waitForTimeout(400);
  await check('manual pull says up to date', async () => await p2.textContent('#toastText'));
  await p2.close();

  console.log('— conflict: local edited AND Drive newer —');
  const p3 = await open(`try{if(!sessionStorage.getItem('__c')){localStorage.clear();sessionStorage.setItem('__c','1')}}catch(e){}\n` + mcpStub({}) +
    `\nwindow.__seed = ${JSON.stringify(driveDump)};`);
  // pull the shared board, then edit locally, then let Drive move ahead
  await p3.evaluate(() => { window.__drive.files = JSON.parse(window.__seed); });
  await p3.reload();
  await p3.waitForTimeout(600);
  await p3.click('.col:first-child [data-add]');
  await p3.fill('#composerInput', 'งานที่เพิ่มบนเครื่องนี้');
  await p3.keyboard.press('Enter');
  await p3.waitForTimeout(300);
  await p3.keyboard.press('Escape');
  // a newer Drive copy lands from elsewhere
  await p3.evaluate(() => {
    const all = window.__drive.files;
    const o = JSON.parse(all[0].body);
    o.savedAt = Date.now() + 5000;
    all.push({ id: 'f9', title: 'todo-board-sync-2099-01-01-1200.json',
      body: JSON.stringify(o), createdTime: new Date(Date.now() + 5000).toISOString() });
    window.__drive.files = all;
  });
  await p3.reload();
  await p3.waitForTimeout(700);
  await check('conflict sheet shown', async () => await p3.isVisible('#syncUseDrive'));
  await check('conflict names both counts', async () => await p3.textContent('.sheet p:last-of-type'));
  const localCount = await p3.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('jeno.board.v1')).boards[0].cards).length);
  await p3.click('#syncKeepLocal');
  await p3.waitForTimeout(300);
  await check('keeping local preserves the edit', async () =>
    (await p3.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('jeno.board.v1')).boards[0].cards).length)) === localCount);
  await p3.reload();
  await p3.waitForTimeout(700);
  await check('does not re-ask for the same Drive copy', async () => await p3.isHidden('#syncUseDrive'));
  await p3.close();

  console.log('— error branches get their own message —');
  for (const [code, expect] of [
    ['needs_reauth', 'reconnect'],
    ['server_not_connected', 'add it'],
    ['server_unavailable', 'responding'],
    ['blocked_by_policy', 'organisation'],
    ['tool_error', 'reported an error']
  ]) {
    const pe = await open(`try{if(!sessionStorage.getItem('__c')){localStorage.clear();localStorage.setItem('jeno.board.v1.ui',JSON.stringify({lang:'en'}));sessionStorage.setItem('__c','1')}}catch(e){}\n` +
      mcpStub({ fail: { code, message: 'boom' } }));
    await check(code, async () => (await pe.textContent('#toastText')) || '(silent on boot)');
    await pe.click('#btnSettings'); await pe.waitForTimeout(250);
    await pe.click('[data-settab="link"]'); await pe.waitForTimeout(250);
    await check('  ↳ distinct message in settings', async () => {
      const txt = await pe.textContent('.sync-err').catch(() => '');
      return txt.toLowerCase().includes(expect) ? txt.slice(0, 60) : false;
    });
    await pe.close();
  }

  console.log('— write failure is flagged as ambiguous —');
  const pw = await open(`try{if(!sessionStorage.getItem('__c')){localStorage.clear();localStorage.setItem('jeno.board.v1.ui',JSON.stringify({lang:'en'}));sessionStorage.setItem('__c','1')}}catch(e){}\n` + mcpStub({}));
  await pw.evaluate(() => { window.__drive.fail = { code: 'server_unavailable', message: 'x' }; });
  await pw.click('#btnPush');
  await pw.waitForTimeout(400);
  await check('warns the push may have landed', async () => {
    const txt = await pw.textContent('#toastText');
    return txt.toLowerCase().includes('check drive') ? txt : false;
  });
  await pw.close();

  console.log('— lifecycle codes hide the feature entirely —');
  const pd = await open(`try{if(!sessionStorage.getItem('__c')){localStorage.clear();sessionStorage.setItem('__c','1')}}catch(e){}\n` + mcpStub({ fail: { code: 'not_granted', message: 'x' } }));
  await check('push button hidden after not_granted', async () => await pd.isHidden('#btnPush'));
  await pd.click('#btnSettings'); await pd.waitForTimeout(250);
  await pd.click('[data-settab="link"]'); await pd.waitForTimeout(250);
  await check('settings shows unavailable', async () => (await pd.$$('.sync-state.is-off')).length === 1);
  await pd.close();

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(errors.length ? 'JS ERRORS:\n' + errors.join('\n') : 'No JS errors.');
  await browser.close();
})();
