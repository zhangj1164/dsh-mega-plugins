# dsh-client-ui-memo

English | [中文](README.zh.md)

Browser-side UI plugin for the memo board: a four-dimension (week / month / quarter / year) card board over the memo Host Remote, with AI analysis, report export, log analysis, and issue creation.

## Plugin

A pure UI surface plugin: the host `apply` is empty so the plugin appears in the host `cordis.yml` / Loader; the browser half ships via `exports["./client"]`, discovered through the `dsh.client` declaration in `package.json`.

The board is a first-class main panel. A `sidebar.panellist` entry gives it the sidebar button — the sidebar itself owns that button, its accessible name, and its active state, so this plugin contributes only a `currentColor` glyph — and a keyed `main` entry renders the board while that panel id is selected. Closing the board selects the reserved `conversation` panel through `ctx.layout`, because panel selection belongs to the layout service rather than to component state. The plugin declares `layout` in `inject` and adds no npm dependency for it: the service is provided by the shell and reached through the context, the same way this package already treats `dsh-client-ui-slots`. This plugin contributes no global DOM, no sidebar observer, and no panel positioning.

## Dimensions and history

The board offers four dimensions. Each keeps its own history, and switching dimension switches the history list with it:

| Dimension | Period label | Fetch window | Tags shown |
|---|---|---|---|
| Week | `2026-W37` | the last 400 ISO weeks | ≤ 10 per year |
| Month | `2026-09` | the last 400 months | ≤ 10 per year |
| Quarter | `2026-Q3` | the last 400 quarters | ≤ 10 per year |
| Year | `2026` | the last 400 years | ≤ 10 |

The whole timeline is fetched once per dimension — 400 is the host's own clamp, so this is everything the host will give — and both the tag rule and the year switcher are computed from it in the browser. A dimension therefore costs the same one call whether the user stays in one year or moves across all of them.

**Which periods become tags.** A period is tagged when it holds at least one memo, plus the current period, which is always tagged so an empty new week is still reachable. Newest first, capped at 10 per dimension and year; anything older is reached by switching year. Emptiness is decided from the cards, not from the host's `weekCount`, because the host creates a zero-entry row for the current week — a positive `weekCount` means the week has a row, not that it has a memo.

**Year switcher.** Sitting at the right of the dimension switch, it offers only years that hold a tag, newest first, with the current year always present even before anything is stored. Every option therefore leads somewhere. Switching year is a local operation: it re-selects a tag within that year and makes no host call.

The history list comes from the host (`memo/listPeriods`), never from a browser-side calendar, so the period boundaries the host uses for analysis and the ones the board displays can never drift apart.

**Period ownership rule.** A week belongs to the period that contains its **Thursday** (the ISO 8601 rule). Months and quarters each therefore tile a year's weeks exactly once, with no gap and no overlap, and a week that straddles a month boundary is attributed to one period rather than both. A week may hold any number of cards, and a card is placed in the period that owns its week, so one card can appear under several dimensions while remaining a single stored entry.

## Controller methods

| Method | Service | Behavior |
|---|---|---|
| `refresh(period?)` | memo | Loads weeks and the period timeline, then derives the cards of the selected period. |
| `selectPeriod(period)` | memo | Switches dimension and reloads that dimension's history. |
| `selectLabel(label)` | — | Selects one history period and narrows the board to it. |
| `selectYear(year)` | — | Shows another year's tags and re-selects a tag inside that year. |
| `addCard(content)` | memo | Adds a text entry to the selected period's target week. |
| `updateCard(card, content)` | memo | Updates a card; `force` is set for periods that are not current. |
| `duplicateCard(card, suffix)` | memo | Copies a card into the same week, appending a suffix to the copy. |
| `deleteCard(card)` | memo | Deletes a card. |
| `analyze(type)` | memo | Runs AI analysis (梳理 / 总结 / 分析) over the selected period. |
| `exportReport()` | memo | Exports a Markdown report for the selected period. |
| `analyzeLogs()` | memo | Reads telemetry failures and generates a GitHub issue report with a prefill URL. The host decides which plugins it covers, so the report spans the deployment's suite rather than this panel's own plugin. |
| `optimizeIssue(description)` | githubIssue | Optimizes a natural-language description into a structured report. Sends the user's chosen model only when there is one: the service resolves the route itself, so the panel never has to publish one. |
| `archiveCurrentQuarter()` | memo | Archives the quarter the board is showing. A no-op in any other dimension. |
| `unarchiveQuarter(label)` | memo | Takes a quarter out of the archive, restoring its cards to editable. |
| `selectModel(choice?)` | — | Pins a provider and model the host reported for the next AI calls, or clears the pin when called with no argument. |

## Model route resolution

The browser never invents a route. `analyze` and `exportReport` send **no** `provider` and **no** `model` unless the user pinned one, and a pin can only name what the host reported: the menu is built from `memo/listModels`, which the host answers from its own `llm` registry. That is the rule this panel has always followed — a request carrying a provider the deployment never registered can only fail with `NO_ADAPTER` — and it is also why the switcher may span providers: the browser picks *from* the deployment's registry instead of guessing.

The switcher rides on the analysis action as a split button: the left half runs the analysis, the right half says which model it would use and offers the others, grouped by provider. The choice is remembered in browser storage together with its provider, and dropped once that provider is no longer registered. When the registry itself cannot be read the choice is kept rather than silently swapped, because an unreadable list is *unknown*, not empty; the caret disables and says why, and the board keeps working. "Follow default" clears the pin and restores the documented precedence.

## UI features

- **Four dimension tabs** (周 / 月 / 季度 / 年) with a **year switcher** on the same row: a dimension tags only the periods that hold a memo plus the current period, at most 10 per year, so an empty historical week never becomes a tag
- **Card grid** in the official Agent preset style: fixed-width columns, equal-height rows, fixed-size cards
- **Card actions**: 查看 (read-only detail dialog), 编辑 (edit dialog), 复制 (duplicate into the same period), 删除 (confirmation dialog)
- **Composer** with a dashed full-width creator button, disabled while the draft is empty
- **AI analysis** with a type switch (梳理 / 总结 / 分析) and an inline result card
- **Model switcher** on the analysis button: one button split by a hairline, whose caret opens every provider the host registered, grouped, with the current choice checked. The caret's tooltip names the route in effect — following the deployment's default is the ordinary case, so it takes no permanent label — and the analysis card names the model that actually answered. Choosing one affects these AI calls only; 跟随默认 clears the pin and restores the deployment's route
- **Report export** for the selected period
- **Log analysis** into a pre-filled GitHub issue, triggered from the header because its output is an issue rather than a report about memos
- **Issue editor**: natural-language input, LLM optimization, and a GitHub open action built from the configured repository
- **Copy full body**: each card whose pre-filled URL may have shortened a body offers the untruncated text next to that URL, so the shortening note's promise is kept on the card that carries the note — the log-analysis card copies its own report body, the issue editor its own report
- **Result cards** for analysis, report, and log analysis: each carries a collapse toggle and a close icon in its own top-right corner. Collapsing is presentation state in the component; closing clears that result, since results are view state rather than stored data.
- **Add Issue, Log Analysis, Close** as icon-and-label buttons in the board header, Close rightmost
- **Quarter archive**: 归档本季度 in the tools row (only on the quarter dimension, the one place a quarter label is unambiguous). An archived quarter's cards go read-only in **every** dimension — 编辑, 复制 and 删除 are withheld, since all three would change a quarter the user declared closed — while 查看 keeps working. The edit slot becomes 取消归档, which releases the whole quarter because that is the unit that was archived. Archived cards are muted with dashed borders and carry an 已归档 tag.
- **Read-only is closed everywhere it could leak**: the detail dialog follows the same rule as the card, so an archived card's 查看 shows 取消归档 where 编辑 would be, rather than putting editing one click away from the button that was withheld. When the week a new card would land in is archived, the composer is disabled, says why, and offers the unarchive action inline. The controller refuses the write as well, so an archive that lands while a dialog is open cannot slip through — and the host refuses it independently with `quarter-archived`.

## Configuration

| Field | Default | Purpose |
|---|---|---|
| `repoUrl` | `https://github.com/zhangj1164/dsh-mega-plugins` | Repository that receives issues created from the board. |

## Bundle layer

This package is included in the `dsh-memo` bundle's `cordis.patch.yml` as the `ui-memo` row. No separate bundle is needed.

## Tests

`tests/logic.spec.ts` covers the pure period, tag, and year logic; `tests/controller.spec.ts` drives the controller against a fake Remote; `tests/MemoBoard.spec.tsx` renders the board in jsdom and exercises every interactive feature, including the header button order, the tag rule and the year switcher, each card action, the collapse and close affordances of every result card, the analysis and export actions, and the regression that no request may carry a model route; `tests/entry.spec.tsx` applies the real browser half against a stand-in client context, so both slot registrations, the sidebar glyph, the panel-switch on close, the locale dictionaries, the style disposal, and the panel component itself are covered where the shell actually reaches them.

## Known Limitations

- **Text-only entry** — the current UI supports text entries; image and file attachment types exist in the backend but are not yet wired in the UI.
