# Tests

End-to-end checks for `todo-board.html`, driven through a real Chromium
with Playwright. Each suite wraps the file the same way the artifact host
does (doctype + head + body) and drives the page as a user would.

```bash
npm install --no-save playwright
node tests/run-all.js          # everything
node tests/04-drive-sync.js    # one suite
```

Set `CHROME_PATH` to point at a specific Chromium; otherwise the runner
looks under `/opt/pw-browsers` and finally falls back to Playwright's own
download.

## What each suite covers

| Suite | Area |
|---|---|
| `01-board.js` | kanban board: add, edit, drag, columns, delete + undo, persistence |
| `02-views.js` | summary pages, due-date buckets, the 14-day load strip |
| `03-log-i18n-fonts.js` | per-task update log, Thai/English switching, typeface picker |
| `04-drive-sync.js` | Google Drive push/pull, second device, conflicts, every error code |
| `05-background-calendar-mail.js` | background styles, calendar view, mail panel |
| `06-boards-recurring.js` | multiple boards, v2→v3 migration, repeats, stale flags, calendar push |

## Connector tests

Suites that touch Google Drive, Google Calendar or Gmail install a stub
on `window.claude.mcp`. The stubs return the **payload shapes observed
from the live connectors**, including their quirks — an empty Drive
search resolves to a bare `{}`, and a Calendar range with no events comes
back as calendar metadata with no `events` key at all. Keep them that way:
if a real response shape changes, fix the stub to match reality rather
than loosening the assertion.
