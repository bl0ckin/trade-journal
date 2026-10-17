# Changes from LuxAlgo's Trade Journal

This project started as a copy of [LuxAlgo/trade-journal](https://github.com/LuxAlgo/trade-journal) (`trade-journal-main`) and has been edited since. This page is the file-level companion to the [CHANGELOG](../CHANGELOG.md): where things live, what they touch in the database, and what to watch for when pulling in upstream updates.

## How this was compared

There is no git history, so the fork was compared against a fresh LuxAlgo download:

- Files in this project that still carry the original 2026-09-30 17:34 timestamp are untouched; later timestamps mark edits (4 to 15 October 2026).
- LuxAlgo's current copy is **newer than the snapshot this fork started from**. Some differences are upstream improvements this fork never received, not edits (see [Upstream changes not in this fork](#upstream-changes-not-in-this-fork)).
- Where an upstream change and an edit touch the same file, the split below is a best reading of the diff, not a certainty.

Totals: 55 new files (6 of them tests), 81 files with real edits, 11 files with blank-line-only differences, 8 files that only lag behind upstream, and 11 upstream files this fork does not have.

## Where each feature lives

| Area | New files | Edited files |
| --- | --- | --- |
| Psychology fields and filters | `lib/emotions.ts`, `lib/extra-filters.ts`, `components/score-slider.tsx`, `components/chip-select.tsx` | `db/schema.ts`, `db/bootstrap.ts`, `db/index.ts`, `server/trades-query.ts`, `api/trades/[key]/route.ts`, `components/filter-fields.tsx`, `components/filter-bar.tsx`, `components/shell.tsx`, `lib/filter-description.ts`, `lib/calendar-insights.ts`, `server/ai-scope.ts`, every route that reads filters |
| Market per trade | `lib/markets.ts`, `tests/markets.test.ts` | `server/executions.ts` (`setTradesMarket`), `api/trades/bulk/route.ts`, `api/executions/route.ts`, `components/manual-trade-entry.tsx`, `api/stats/route.ts` |
| Edit and close trades | `components/close-trade-dialog.tsx`, `api/trades/[key]/executions/route.ts`, `api/trades/[key]/close/route.ts` | `server/executions.ts` (`replaceTradeExecutions`, `closeTradePosition`, manual-group isolation), `app/trades/[key]/page.tsx`, `app/page.tsx` |
| Trade entry helpers | `components/ui/date-time-picker.tsx`, `lib/datetime-input.ts`, `lib/use-dialog-modal.ts`, `api/symbols/route.ts` | `components/add-trade-dialog.tsx`, `components/ui/date-picker.tsx` |
| Primary account and balances | `components/account-balances.tsx` | `api/accounts/route.ts`, `api/accounts/[id]/route.ts`, `server/settings.ts`, `components/account-picker.tsx`, `components/account-selector.tsx`, `app/accounts/page.tsx`, `lib/utils.ts` (`fmtBalance`) |
| Daily risk limits | `lib/risk-limits.ts`, `api/risk-limits/route.ts`, `components/risk-limit-settings.tsx`, `components/daily-limit-warning.tsx` | `server/settings.ts`, `app/settings/page.tsx`, `app/page.tsx` |
| Broker sync | `server/auto-sync.ts`, `lib/auto-sync-schedule.ts`, `instrumentation.ts`, `api/sync/route.ts`, `components/sync-button.tsx`, `lib/sync-events.ts`, `lib/sync-scope.ts`, `lib/time-ago.ts`, `server/alpaca-fills.ts`, `tests/auto-sync.test.ts`, `tests/sync-lock.test.ts`, `tests/sync-scope.test.ts`, `tests/alpaca-fills.test.ts` | `server/sync.ts` (`syncAccountExclusive`, Alpaca fetch wrapper), `api/accounts/[id]/actions/route.ts` |
| Trades table | `lib/trade-search.ts`, `lib/trades-view.ts`, `components/tag-picker.tsx`, `api/tag-library/route.ts`, `tests/trade-search.test.ts` | `app/trades/page.tsx`, `api/trades/route.ts`, `api/trades/bulk/route.ts` |
| Reports and calendar | `components/report-charts.tsx`, `report-kpis.tsx`, `report-statistics.tsx`, `report-insights.tsx`, `calendar-year.tsx`, `lib/extended-stats.ts`, `lib/calendar-year.ts`, `api/calendar/year/route.ts` | `components/report-overview.tsx`, `app/reports/page.tsx`, `app/calendar/page.tsx`, `components/calendar-pnl.tsx`, `api/stats/route.ts` |
| Notebook, journal, attachments | `app/notebook/notebook.css`, `components/template-manager.tsx`, `components/attachment-queue.tsx`, `components/image-viewer.tsx`, `lib/note-tools.ts`, `lib/note-templates.ts` | `app/notebook/page.tsx`, `app/journal/page.tsx`, `app/journal/[date]/page.tsx`, `components/attachments.tsx`, `components/rich-editor.tsx`, `api/notes/route.ts`, `api/notes/[id]/route.ts`, `api/folders/[id]/route.ts`, `api/workspace/[resource]/route.ts` |
| Playbooks, missed, routines | `components/progress-widgets.tsx` | `app/playbooks/page.tsx`, `app/missed/page.tsx`, `app/progress/page.tsx`, `lib/progress.ts` |
| Prop firms | `lib/prop-insights.ts`, `components/prop-insights.tsx` | `server/prop-firms.ts`, `lib/prop-firms.ts`, `lib/prop-demo.ts`, `components/prop-firm-forms.tsx`, `components/prop-firm-tracker.tsx`, `components/prop-cash-overview.tsx`, `tests/prop-firms.test.ts` |
| CSV export | `server/trade-csv.ts` | `api/export/route.ts` |
| Look and feel | `app/icon.svg` | `app/globals.css`, `components/charts/tokens.ts`, `components/trade-chart.tsx`, `components/ui/{button,dialog,input,textarea,badge}.tsx`, `components/dashboard-layout.tsx`, `components/shell.tsx`, `app/layout.tsx`, `middleware.ts` (lets `icon.svg` through the password gate) |

All paths are under `apps/web/src/` (or `apps/web/tests/`) unless they start with `api/`, which means `apps/web/src/app/api/`.

## Data model and configuration

**New columns** on `trades` (nullable, added at startup by guards in `db/index.ts` and also present in `BOOTSTRAP_SQL`): `trade_quality INTEGER`, `confidence INTEGER`, `emotional_state TEXT`. `emotional_state` holds a JSON list; older single-word values are still read.

**No new tables.** New state lives in the existing `settings` table:

| Settings key | Holds |
| --- | --- |
| `primaryAccountId` | Account the Add trade form preselects |
| `riskLimits` | Daily loss, trades per day, consecutive losses |
| `propTemplates` | Prop firm account templates |
| `tagLibrary`, `mistakeLibrary` | Saved tag and mistake names |

**Environment variable:** `AUTO_SYNC_INTERVAL_MINUTES` (default 15; `0` or `off` disables background sync). Documented in `.env.example` and the README.

**Changed meaning of existing data:** `trades.asset_class` is now surfaced as "Market" and falls back to a ticker-based guess when empty. Manual fills gain `importMetadata` (`group`, `order`) so they never merge with other fills.

**New or changed endpoints:** `GET/POST /api/sync`, `GET /api/risk-limits`, `GET /api/symbols`, `/api/tag-library`, `GET /api/calendar/year`, `PUT /api/trades/[key]/executions`, `POST /api/trades/[key]/close`, `PATCH /api/workspace/{templates,progress}`; `PATCH /api/accounts/[id]` accepts `primary`; `/api/trades/bulk` accepts `mistake`, `unmistake`, `market`; `/api/trades` accepts `q`; `/api/stats` returns `extended`, `psychology`, `markets`; `/api/accounts` returns `balance`, `netPnl` and `primaryAccountId`; `/api/notes` also returns trade and daily-journal notes.

## Behavior that differs from LuxAlgo

- **Manual trades never merge.** Upstream appends new manual fills and notes to an existing position on the same symbol. Here each manual entry is its own trade. The README paragraph and the `execution-storage` test were updated to match.
- **CSV export schema changed.** The old 15 columns are replaced by a much wider per-trade schema (`server/trade-csv.ts`). Anything that reads the old `trades.csv` needs updating.
- **Prop firm reasons are optional.** Upstream rejects a correction without a reason.
- **Folder deletion** hard-deletes the folder and moves its notes to My notes. Upstream has since changed this (see below).
- **Sidebar footer removed**, and the sidebar order and palette are different.

## Upstream changes not in this fork

LuxAlgo's current copy has the following; this fork does not. None is something you removed.

| Upstream change | Files |
| --- | --- |
| XTB xStation `.xlsx` importer (a 16th format) | `packages/importers/src/formats/xtb.ts`, `packages/importers/src/xlsx.ts`, `apps/web/src/server/xtb-import.ts`, `apps/web/src/lib/xlsx-import.ts`, XTB tests; hooks in `detect.ts`, `index.ts`, `import/page.tsx`, `api/import/route.ts`, `importers/tsconfig.json` |
| Folder soft-delete with a `deleted_at` tombstone, so built-in folders are not recreated at startup | `db/schema.ts`, `db/bootstrap.ts`, `api/folders/[id]/route.ts`, `tests/folder-delete.test.ts`, `tests/notebook-folder-delete.test.ts` |
| Concurrent first-run database setup (retry on `SQLITE_BUSY` while `next build` runs workers in parallel) | `db/bootstrap.ts` (`openJournalDatabase`), `db/index.ts`, `tests/db-concurrent-init.test.ts` |
| Docs for `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL`, the OpenAI-compatible provider and the IBKR XML upload fix | `README.md`, `.env.example`, `CHANGELOG.md`, `docs/importers.md` |
| `tradeToExecutions` returns a typed tuple | `packages/importers/src/types.ts` |

The OpenAI-compatible provider code itself is already in this fork (`server/settings.ts`, `server/ai.ts`, `lib/ai-settings.ts`); only its documentation is missing.

### Merge hotspots

If you ever pull upstream in, these files will conflict because both sides changed them:

1. `apps/web/src/db/index.ts` and `db/bootstrap.ts` (your new `trades` columns against upstream's `migrate()` rewrite and `deleted_at`). Port the three columns into upstream's `migrate()` rather than keeping the inline guards.
2. `apps/web/src/app/api/folders/[id]/route.ts`
3. `apps/web/src/app/import/page.tsx` and `api/import/route.ts`
4. `apps/web/src/server/executions.ts`, `api/trades/[key]/route.ts` (large edits here)
5. `README.md` and `CHANGELOG.md`

## Housekeeping

- **Stray files in the project folder:** `src.zip` (1 MB copy of `apps/web`), `packages/importers/node_modules` (a 160 KB workspace link), `apps/web/tsconfig.tsbuildinfo` (596 KB, git-ignored) and `apps/web/next-env.d.ts` (git-ignored, CRLF). None belongs in version control. Delete `src.zip` and the `.tsbuildinfo`; the other two are regenerated by `pnpm install` and Next.
- **Blank-line-only differences:** 11 files (`ai.ts`, `ai-settings.ts`, `ai-import.ts`, `ibkr-flex-xml-import.ts`, `core/src/returns.ts` and six tests). They look like an editor or formatter pass. Re-running Prettier (`.prettierrc.json` is in the repo) would bring them back in line.
- **Tests:** the new sync, Alpaca, markets and search modules have tests. These do not: risk limits, `replaceTradeExecutions`, `closeTradePosition`, `setTradesMarket`, the trade CSV, extended stats, the yearly calendar and prop insights.
- **Licence and name:** the MIT `LICENSE` is intact. LuxAlgo's [trademark policy](../TRADEMARKS.md) says a fork that is distributed to others must not use the "Trade Journal" name or the LuxAlgo name and logo. That is fine for private use, but check `app/icon.svg` and the banner before sharing the project.

## Keeping this current

Easiest way to stop doing this by hand: run `git init`, commit the untouched LuxAlgo download on a `luxalgo` branch, and keep your edits on `main`. Then `git diff luxalgo main --stat` always shows exactly what you changed, and updating from upstream becomes a normal merge. When you change something, add one line under `## [Unreleased]` in the CHANGELOG.
