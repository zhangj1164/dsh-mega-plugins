# dsh-client-ui-memo

English | [中文](README.zh.md)

Browser-side UI plugin for the memo board: a four-dimension (week / month / quarter / year) card board over the memo Host Remote, with AI analysis, report export, log analysis, and issue creation.

## Plugin

A pure UI surface plugin: the host `apply` is empty so the plugin appears in the host `cordis.yml` / Loader; the browser half ships via `exports["./client"]`, discovered through the `dsh.client` declaration in `package.json`.

The board registers itself as a `settings.section` entry — the extension point DSH provides for one settings page per list entry, and the same seat the official Agent preset page uses. The shell owns the navigation row, the modal, and the close affordance, so this plugin contributes no global DOM, no sidebar observer, and no panel positioning.

## Dimensions and history

The board offers four dimensions. Each keeps its own history, and switching dimension switches the history list with it:

| Dimension | Period label | History entries |
|---|---|---|
| Week | `2026-W37` | the last 24 ISO weeks |
| Month | `2026-09` | the last 24 months |
| Quarter | `2026-Q3` | the last 24 quarters |
| Year | `2026` | the last 24 years |

The history list comes from the host (`memo/listPeriods`), never from a browser-side calendar, so the period boundaries the host uses for analysis and the ones the board displays can never drift apart.

**Period ownership rule.** A week belongs to the period that contains its **Thursday** (the ISO 8601 rule). Months and quarters each therefore tile a year's weeks exactly once, with no gap and no overlap, and a week that straddles a month boundary is attributed to one period rather than both. A week may hold any number of cards, and a card is placed in the period that owns its week, so one card can appear under several dimensions while remaining a single stored entry.

## Controller methods

| Method | Service | Behavior |
|---|---|---|
| `refresh(period?)` | memo | Loads weeks and the period timeline, then derives the cards of the selected period. |
| `selectPeriod(period)` | memo | Switches dimension and reloads that dimension's history. |
| `selectLabel(label)` | — | Selects one history period and narrows the board to it. |
| `addCard(content)` | memo | Adds a text entry to the selected period's target week. |
| `updateCard(card, content)` | memo | Updates a card; `force` is set for periods that are not current. |
| `duplicateCard(card, suffix)` | memo | Copies a card into the same week, appending a suffix to the copy. |
| `deleteCard(card)` | memo | Deletes a card. |
| `analyze(type)` | memo | Runs AI analysis (梳理 / 总结 / 分析) over the selected period. |
| `exportReport()` | memo | Exports a Markdown report for the selected period. |
| `analyzeLogs()` | memo | Reads telemetry failures and generates a GitHub issue report with a prefill URL. |
| `optimizeIssue(description)` | githubIssue | Optimizes a natural-language description into a structured report. |

## Model route resolution

The browser never selects a model. The controller sends **no** `provider` and **no** `model` field, so the host resolves the route from the deployment's configuration and then from the session default, returning a precise failure when none is registered. A request carrying a hardcoded provider name can only succeed on the one deployment that happens to register it.

## UI features

- **Four dimension tabs** (周 / 月 / 季度 / 年), each with its own history chips and a marker for the current period
- **Card grid** in the official Agent preset style: fixed-width columns, equal-height rows, fixed-size cards
- **Card actions**: 查看 (read-only detail dialog), 编辑 (edit dialog), 复制 (duplicate into the same period), 删除 (confirmation dialog)
- **Composer** with a dashed full-width creator button, disabled while the draft is empty
- **AI analysis** with a type switch (梳理 / 总结 / 分析) and an inline result panel
- **Report export** for the selected period
- **Log analysis** and an **open pre-filled issue** action
- **Issue editor**: natural-language input, LLM optimization, and a GitHub open action built from the configured repository
- **Add Issue and Close** as icon-only buttons in the board header, Close rightmost, each with a tooltip

## Configuration

| Field | Default | Purpose |
|---|---|---|
| `repoUrl` | `https://github.com/zhangj1164/dsh-mega-plugins` | Repository that receives issues created from the board. |

## Bundle layer

This package is included in the `dsh-memo` bundle's `cordis.patch.yml` as the `ui-memo` row. No separate bundle is needed.

## Tests

`tests/logic.spec.ts` covers the pure period and card-selection logic; `tests/controller.spec.ts` drives the controller against a fake Remote; `tests/MemoBoard.spec.tsx` renders the board in jsdom and exercises every interactive feature, including the Add Issue / Close ordering, each card action, the analysis and export actions, and the regression that no request may carry a model route; `tests/entry.spec.tsx` applies the real browser half against a stand-in client context, so the `settings.section` registration, the locale dictionaries, the style disposal, and the section component itself are covered where the shell actually reaches them.

## Known Limitations

- **Text-only entry** — the current UI supports text entries; image and file attachment types exist in the backend but are not yet wired in the UI.
