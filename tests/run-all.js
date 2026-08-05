// Runs every suite in order and exits non-zero if any check fails.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const files = fs.readdirSync(__dirname)
  .filter(f => /^\d\d-.*\.js$/.test(f))
  .sort();

let failed = 0;
for (const f of files) {
  process.stdout.write('\n=== ' + f + ' ===\n');
  let out = '';
  try {
    out = execFileSync(process.execPath, [path.join(__dirname, f)], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5 * 60 * 1000
    });
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
    failed++;
  }
  process.stdout.write(out);
  if (/✗/.test(out) || /JS ERRORS/.test(out)) failed++;
}

process.stdout.write('\n' + (failed ? failed + ' suite(s) reported problems\n' : 'All suites clean\n'));
process.exit(failed ? 1 : 0);
