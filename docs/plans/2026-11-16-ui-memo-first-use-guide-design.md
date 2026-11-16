# First-use guide for the memo board

## Context

Issue [#128](https://github.com/zhangj1164/dsh-mega-plugins/issues/128) reports that the memo board opens with no explanation of what it can do. A browser that has never used `@zhangj1164/dsh-client-ui-memo` sees four dimension tabs, a composer, and a row of header buttons, and has to discover by trial that a memo is week-keyed, that a quarter can be archived read-only, and that the header carries AI analysis, session summaries, and issue filing. The issue asks for a guide component on the first visit, covering the plugin's basic features, and for later guide pages to accompany important updates.

## Decision

The board shows a short multi-page guide as an overlay on its first visit. The guide is versioned data, not a one-off modal, so an important future update can add a page instead of replacing the component.

- `packages/client/ui-memo/src/client/logic.ts` owns the guide data and its storage read/write: `GUIDE_STORAGE_KEY` (`dsh-memo:guide`), `GUIDE_VERSION`, `GUIDE_STEPS`, `readGuideSeen`, `writeGuideSeen`, `pendingGuideSteps`. The module stays pure and browser-free, matching the rest of `logic.ts`.
- Each `MemoGuideStep` carries `id`, `title` and `body` locale keys, and `introducedIn`. `pendingGuideSteps(steps, seen)` returns the steps whose `introducedIn` is newer than the stored version, so a browser that read version 1 gets only the page added at version 2. `GUIDE_VERSION` is the newest step version (`readGuideSeen` defaults to 0, so a first visit gets every page).
- `MemoController.guideSeenVersion()` and `markGuideSeen(version)` wrap that storage, because the controller already owns the board's `StorageLike` and the component never touches `localStorage` directly.
- `packages/client/ui-memo/src/client/MemoGuide.tsx` renders the overlay: the same `dsh-memo-overlay` / `dsh-memo-dialog` pattern as the board's other dialogs, a `N / M` counter, the step heading and body, Back/Next, Skip on the first page and Get started on the last, Escape to close, and focus on the primary button. Dismissing records `GUIDE_VERSION` whether the user reached the last page or skipped, so a skipped first run does not reappear.
- `MemoBoard.tsx` decides once whether a guide is open (`pendingGuideSteps(GUIDE_STEPS, controller.guideSeenVersion())`) and keeps it in component state, so the overlay does not reappear after dismissal or on every view update. A header button, labelled with the guide's own locale key, reopens every page at any time.
- All copy lives in `locales.ts` as `MemoKey` entries with both `zh` and `en` values; all styling lives in `styles.ts` using the board's `--dsw-alias-*` tokens, so the guide follows the active theme.

## What changes for an update

Bump `GUIDE_VERSION` and add the new pages with `introducedIn` set to the new version. Do not edit an existing page in place to announce a change: a browser that recorded the older version would never see the edited page. Existing tests assert `GUIDE_VERSION === max(introducedIn)` so the two cannot drift.

## Tests

- `tests/logic.spec.ts` covers the storage contract: missing, malformed, and negative values read as never seen; a round-trip; a throwing `StorageLike` degrades instead of breaking the board; the step list is non-empty with unique ids; and `pendingGuideSteps` selects first-visit pages, nothing for the current version, and only the new page after a version bump.
- `tests/MemoBoard.spec.tsx` renders a first visit and checks the auto-opened first page and counter, Next/Back navigation, reaching the last page and dismissing via Get started (persisting the version), dismissing via Skip and remounting without reopening, and reopening all pages from the header button without touching storage. The shared `renderBoard` helper seeds the current version by default so the other board tests keep rendering a returning browser.

## Out of scope

- Cross-browser or cross-device sync. The seen version is per browser, stored like the board's period and model choices.
- Teaching UI beyond the board's own surfaces: the guide does not point at the sidebar entry, host settings, or other plugins.
- A settings-page reset. Clearing `localStorage` (or the site's storage) restores the guide, the same way the other memo preferences reset.
