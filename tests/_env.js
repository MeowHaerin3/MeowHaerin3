// Shared paths for the suite. Everything else is repo-relative so the
// tests run from a checkout rather than one machine's scratch directory.
const fs = require('fs');
const os = require('os');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'todo-board.html');

// scratch space for the wrapped page each suite renders
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-board-tests-'));

// Prefer a Chromium the environment already provides; fall back to
// whatever Playwright resolves on its own.
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const roots = ['/opt/pw-browsers'];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const dir of fs.readdirSync(root)) {
      const p = path.join(root, dir, 'chrome-linux', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  }
  return undefined; // let Playwright pick its bundled browser
}

module.exports = { SRC, OUT, CHROME: findChrome() };
