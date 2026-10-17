# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

Changes made in this fork, relative to LuxAlgo's Trade Journal snapshot of 2026-09-30 (`trade-journal-main`). A file-level map, schema notes and merge hotspots are in [`docs/own-changes.md`](docs/own-changes.md).

### Added

**Trade entry and editing**

- Psychology fields on every trade: trade quality (1-10), confidence (1-10) and emotional state (multi-select of 15 states, from Calm to FOMO). Stored in three new `trades` columns (`trade_quality`, `confidence`, `emotional_state`), added by additive `ALTER TABLE` guards at startup
- Market per trade (Stocks, Futures, Crypto, Forex, Options, CFDs, Other), stored in the existing `asset_class` column. When none is saved it is guessed from the ticker (`BTCUSDT` is crypto, `ES`/`NQ` are futures, anything else is stocks). Settable on the trade page, in manual entry, and in bulk from the trades table
- Edit the executions of a trade after the fact (change, add or delete fills; `PUT /api/trades/[key]/executions`). Notes, attachments and rule checks follow the trade if its key changes. Broker-synced and position-based statement imports are refused
- Close an open trade, fully or partly, from the dashboard's open positions or the trade page with one opposite-side fill (`POST /api/trades/[key]/close`)
- Duplicate trade in the Add trade dialog; recent symbols with the last quantity used (`/api/symbols`); a date-time picker with 12-hour lists
- Primary account: mark one manual or import account as primary and the Add trade form preselects it
- Account balances (starting balance plus all-time net P&L) in the account selector and as a balance bar on the dashboard
- Daily risk limits in Settings (max daily loss, max trades per day, max consecutive losses) with a warning banner on the dashboard and in Add trade as a limit gets close
- Tag and mistake library: pick from previously used values, add new ones, rename or delete a value everywhere (`/api/tag-library`)

**Broker sync**

- Sync button on the dashboard (follows the account selector)
- Background auto-sync with a per-account "Auto-sync" toggle on the Accounts page. Interval from `AUTO_SYNC_INTERVAL_MINUTES` (default 15; `0` or `off` disables). Failed attempts count toward the retry spacing so an expired token is not retried every minute. Started from `instrumentation.ts`
- One sync per account at a time: a manual click and the scheduler join the sync already running instead of calling the broker twice
- Sync status label ("synced 12m ago", turns yellow when stale) and widgets reload after a sync

**Trades table**

- Free-text search over symbol, tags, mistakes, emotions and notes; summary cards describe exactly the trades listed
- Sort order and visible columns are remembered between visits
- New bulk actions: add or remove a mistake, set market, set or clear playbook
- New Psychology filter group (emotion, trade quality range, confidence range) that travels in the URL and applies to the dashboard, calendar, reports, AI scope and CSV export

**Reports and calendar**

- Reports overview rebuilt: KPI strip, equity and distribution charts, a full statistics panel with hover definitions, auto-generated takeaways, best and worst trades, month by month, time-of-day, By market, and psychology breakdowns, with a "Jump to section" menu
- Yearly calendar view (`?view=year`): twelve month tiles, monthly P&L columns and a running total (`/api/calendar/year`)
- Reports comparison tab laid out as a "Head to head" table with a Difference column; the Reports tab pages gained one-line descriptions

**Notebook, journal and attachments**

- Notebook rewritten: resizable folder and note panes, full-width editor mode, search (`/` shortcut), pin to top, sorting (recently updated, newest, A to Z), "Previous 7 / 30 days" grouping, move, duplicate and delete notes and folders, copy as Markdown, new note from a template
- Trade notes and daily-journal notes appear inside the notebook ("Trade notes", "Daily journal" folders) and are edited in place rather than copied
- Note template manager (create, rename, edit, delete; `PATCH /api/workspace/templates`)
- Daily journal: search, previous and next journal day, add a section
- Attachments: paste or drop files, queue files on items that are not saved yet, full-page image viewer with arrows, keyboard and swipe

**Playbooks, missed trades and routines**

- Playbooks: starter playbooks, edit, duplicate, delete, search across playbooks and rules, "Best performer" and "Needs attention" callouts
- Missed trades: reason chips (for example "Missed the alert", "Overthought it"), planned R:R, strategy filter, sorting, "Log a similar setup"
- Routines (Progress page): Before, During and After trading stages, starter routines, edit weekdays (`PATCH /api/workspace/progress`), archive or delete, streak and average completion, progress ring and stat tiles

**Prop firms**

- Account templates (for example "25K Eval") that prefill firm, program, size and price
- Create several identical accounts at once (1 to 50) and record the purchase cost in the same step
- Mark an evaluation as passed or failed; "breached" is now labeled "Failed"
- Funded & live grouping, renewal-overdue state, pipeline and scorecard roll-ups, "Costs recovered" in cash overview, archive and restore, permanent delete
- Payout form logs the payout and the money received in one step; account size and price are optional

**Export**

- Trade CSV export is now one row per trade with the full journal context (plan, process scores, mistakes, emotions, playbook-rule compliance, prior-trade context), intended for spreadsheets or an AI assistant. The file name carries the date (`trades-YYYY-MM-DD.csv`)

**Taken from pablosaura's fork** ([saurasanchezpablo/trade-journal](https://github.com/saurasanchezpablo/trade-journal), MIT)

- Importer fixes: MetaTrader 4 and 5 profit and swap, decimal commas, TradeZella fees and sides, DAS Trader short sells, ThinkorSwim options, fill order within the same second, UTC timestamps and dash dates; re-importing an older file refuses to double-add fills
- Security: cross-site requests refused, signed expiring sessions, sign-in paused after repeated wrong passwords, clean 400 on malformed requests, database errors no longer reach the client; the login page shows the real error and cannot be submitted twice
- Habits tab in Reports: revenge trades, trading on after losses, size creep and late-day fades, each measured against the rest of your trades
- Clearing, deleting or transferring an account, and deleting trades, also removes or moves rule checks, attachments, excursions and notebook links
- Import page: drag and drop a statement, keyboard access to the file picker
- Sidebar links load when you hover over them
- A refresh after a save no longer reuses a read that started before it


### Changed

- Manual entries are isolated: every manual entry is its own trade and is never merged into, or has its notes appended to, another position on the same symbol. Re-submitting the identical fills is still deduplicated
- Asset class is now called Market in the filters and AI scope description
- Prop firm corrections no longer require a reason; an edit without one is audited as "Edited"
- Visual refresh: new blue and violet palette in light and dark themes, softer profit and loss greens and reds (also in charts and the trade chart), rounder controls with transitions, blurred dialog backdrop, a blue "open" badge, new favicon
- Sidebar reordered to Dashboard, Trades, Reports, Calendar, Daily journal, Notebook, Missed trades, Playbooks, Progress, Prop firms; the footer with the GitHub link and "Not investment advice" was removed
- Dashboard toolbar reworked: balance bar on the left, card counter and customizer repositioned
- Deleting a notebook folder returns how many notes were moved to My notes
- Three existing tests were rewritten for the new behavior (`execution-storage`, `prop-firms`, `ai-ui`)

### Fixed

- Alpaca short sales: fills with side `sell_short` and `buy_to_cover` were silently dropped by the broker SDK, so a short looked like a fresh long. They are now read as plain sell and buy
- A popover opened inside a dialog (date pickers, tag pickers) could not be scrolled with the mouse wheel

### Housekeeping

- 11 files differ from LuxAlgo only by removed blank lines or an escaped character (`ai.ts`, `ai-settings.ts`, `ai-import.ts`, `ibkr-flex-xml-import.ts`, `core/src/returns.ts` and six test files); there is no functional change

## Inherited from LuxAlgo (unreleased at the fork point)

### Added

- Customizable dashboard: drag cards to rearrange, hide and restore them, save named layouts; responsive layout with a mobile navigation drawer
- Privacy mode that masks monetary values across the app while keeping counts, ratios and chart shapes
- Markdown notes with formatting toolbar, reusable templates, exact trade links, and image/PDF attachments on trades, days and notebook notes
- Advanced report filters, comparison groups, a two-way cross-analysis matrix, and additional breakdowns (asset class, month, entry/exit hour, position size, planned/realized R)
- Playbook rule checklists per trade with adherence rates and followed-vs-broken performance
- Routines with weekday schedules and completion history; a missed-opportunity log kept out of trading metrics
- PDF and PNG review exports; JSON export now includes folders, templates, rule assessments, routines and defaults
- Configurable breakeven tolerance, default fees, and default stop/target distances per account and symbol
- Importers: MetaTrader 5 deal reports and TradingView strategy exports
- Importers: XTB xStation `.xlsx` account workbooks, with closed positions, open holdings and later closes of those holdings (contributed by @zahei, [#42](https://github.com/LuxAlgo/trade-journal/issues/42))
- Realized R accounts for contract multipliers and scaled entries
- Optional historical market data connections (London Strategic Edge, Alpaca, OANDA, Binance, Coinbase, or your own candle CSV) with estimated MAE/MFE and candle replay on closed trades
- Prop firm tracker: evaluation and reset costs, refunds, payout requests, receipts, cash ROI, renewals, attachments, CSV import and export
- Calendar insights, rolling performance trends, and a trade explorer scatter in Reports
- Light mode, a collapsible sidebar, and friendlier AI setup and error notices
- OpenAI-compatible AI provider for local or third-party models (Ollama, LM Studio, OpenRouter and others), and documented `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` gateway support (proposed by @fiandev in [#19](https://github.com/LuxAlgo/trade-journal/pull/19))

### Changed

- Data loads render as React transitions, so a tab change paints progressively instead of freezing while every card and chart mounts at once
- The development server runs on Turbopack, roughly halving first-visit compile times when switching tabs in `pnpm dev`
- Removed the gradient accent bar and gradient Edge Score number; the active nav item and the score now use the solid brand blue
- Trade pages chart recorded fills only and never contact a data provider on open; market candles load only from a data source you choose
- Gross profit and gross loss now include every closed trade, so trades labeled breakeven by a tolerance still count; the Edge Score version is bumped to 2
- Reports and dashboard aggregation reuse daily totals and equity for large histories; charts load only the components they use
- Executions are validated and written together with their recomputed trades in one transaction
- Node 22 or newer is required (already required by the AI dependencies)

### Fixed

- Password protection now verifies the session signature on every API route. Previously, when `JOURNAL_PASSWORD` was set, any request carrying a cookie of the right name was accepted, so a forged cookie could read the journal.
- IBKR Flex Query XML statements can be uploaded on Import → File upload, and their times are read in the statement timezone, as broker sync does. Previously an XML upload was not recognized and could not be imported, so the Default import timezone never applied ([#16](https://github.com/LuxAlgo/trade-journal/issues/16)).

## [0.1.0] - 2026-09-03

Initial public release.

### Added

- Round-trip engine: flat-to-flat position cycles from raw fills, FIFO/LIFO/weighted-average matching, partial fills, position flips, futures multipliers, rebuild-stable annotation keys (`@luxalgo/journal-core`)
- Analytics: P&L, win and day-win rates, profit factor, expectancy, R multiples, streaks, drawdown and recovery, profit concentration, calendar and bucket aggregations, the open Edge Score
- Statement importers with auto-detection for 12 formats, one-click TradeZella/Tradervue migration with exact P&L reconciliation, and a column mapper for anything else (`@luxalgo/journal-importers`)
- Web app: dashboard, P&L calendar, daily journal with voice dictation, trades table, trade pages with charting, notebook, playbooks, reports
- Broker sync via `@luxalgo/broker-sdk` with credentials encrypted at rest
- Optional AI reflection (bring your own Anthropic API key): session recaps, trade critiques, ask-your-journal
- Docker deployment, optional password auth, full JSON/CSV export
