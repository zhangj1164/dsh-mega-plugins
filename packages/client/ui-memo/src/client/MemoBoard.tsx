/**
 * Memo board: the `main` panel that owns the whole memo surface.
 *
 * Layout follows the official Agent preset section: a fixed-width card grid
 * (`minmax(268px, 1fr)` with `grid-auto-rows: 1fr`, so every card in a row is
 * the same height), a dashed full-width creator affordance, and icon-only card
 * actions revealed with `data-tip` tooltips.
 *
 * The board is a main panel selected by its sidebar entry, so it owns its own
 * header and insets while panel selection stays with the layout service. All
 * color comes from `--dsw-alias-*` tokens, which follow the active theme
 * without any JavaScript.
 *
 * @module dsh-client-ui-memo/client/MemoBoard
 */

import * as React from 'react'
import type { MemoAnalysisType, MemoModelInfo, MemoModelProvider } from 'dsh-memo/client'
import type { MemoController, MemoViewState } from './controller.ts'
import { PERIODS, periodDisplay, type MemoCard, type MemoModelChoice } from './logic.ts'
import type { MemoKey } from './locales.ts'

/** Translate function for this plugin's dictionary. */
export type Translate = (key: MemoKey) => string

/** Props the board receives from its slot registration. */
export interface MemoBoardProps {
  /** The memo controller. */
  readonly controller: MemoController
  /** Translate function bound to this plugin's namespace. */
  readonly t: Translate
  /** Close the panel (owned by the shell). */
  readonly close: () => void
  /** Open a URL in a new tab. */
  readonly openUrl: (url: string) => void
  /** Copy text to the clipboard. Injected so the board stays testable. */
  readonly copyText: (text: string) => Promise<void>
}

/**
 * Sentinel key for the issue-body copy confirmation. Card ids are UUIDs, so
 * this can never collide with the per-card `copied` state.
 */
const ISSUE_BODY_COPY_KEY = 'issue-body'

/** The three analysis modes, in display order. */
const ANALYSIS_TYPES: readonly { type: MemoAnalysisType; key: MemoKey }[] = [
  { type: '梳理', key: 'organize' },
  { type: '总结', key: 'summarize' },
  { type: '分析', key: 'analyzeLabel' },
]

/** Icon paths, sized for a 16px viewBox and stroked with `currentColor`. */
const ICON = {
  addIssue: 'M8 2.5v11M2.5 8h11',
  close: 'M3.5 3.5l9 9M12.5 3.5l-9 9',
  view: 'M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z M8 6.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z',
  edit: 'M11.2 2.3l2.5 2.5-8 8-3 .5.5-3z',
  copy: 'M5.5 5.5V2.5h8v8h-3M2.5 5.5h8v8h-8z',
  trash: 'M2.5 4.5h11M6 4.5V2.5h4v2M4 4.5l.7 9h6.6l.7-9M6.5 7v4M9.5 7v4',
  analyzeLogs: 'M2.5 3.5h11v9h-11zM4.75 6.25l1.5 1.5-1.5 1.5M8.25 9.5h2.75',
  collapse: 'M4 10l4-4 4 4',
  expand: 'M4 6l4 4 4-4',
  archive: 'M2.5 3.5h11v2.5h-11zM3.5 6v6.5h9V6M6.5 8.5h3',
  unarchive: 'M2.5 3.5h11v2.5h-11zM3.5 6v6.5h9V6M8 12V7.5M6.25 9.25L8 7.5l1.75 1.75',
} as const

/** One inline icon. */
function Icon({ path, size = 16 }: { path: string; size?: number }): React.ReactElement {
  return React.createElement('svg', {
    viewBox: '0 0 16 16', width: size, height: size, fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': 'true', focusable: 'false',
  }, React.createElement('path', { d: path }))
}

/** Owner props for one collapsible result card. */
interface ResultCardProps {
  /** Card title, also the heading text. */
  readonly title: string
  /** Whether the body is hidden. */
  readonly collapsed: boolean
  /** Translator bound to this plugin's namespace. */
  readonly t: Translate
  /** Toggle the body. */
  readonly onToggle: () => void
  /** Remove the card. */
  readonly onClose: () => void
  /** Card body; omitted entirely while collapsed. */
  readonly children?: React.ReactNode
}

/**
 * One result card: title on the left, collapse and close on the right.
 *
 * The three generated results (analysis, report, log analysis) share this frame
 * so their affordances cannot drift apart, and closing one is the caller's
 * concern because each result lives in a different part of the view state.
 *
 * @param props - title, collapse state, translator, and the two callbacks.
 * @returns the result card element.
 */
function ResultCard({ title, collapsed, t, onToggle, onClose, children }: ResultCardProps): React.ReactElement {
  const toggleLabel = collapsed ? t('expand') : t('collapse')
  return React.createElement('section', { className: 'dsh-memo-result' },
    React.createElement('div', { className: 'dsh-memo-resultHead' },
      React.createElement('h3', { className: 'dsh-memo-subtitle' }, title),
      React.createElement('div', { className: 'dsh-memo-resultActions' },
        React.createElement('button', {
          type: 'button',
          className: 'dsh-memo-iconBtn',
          'data-tip': toggleLabel,
          'aria-label': toggleLabel,
          'aria-expanded': !collapsed,
          onClick: onToggle,
        }, React.createElement(Icon, { path: collapsed ? ICON.expand : ICON.collapse })),
        React.createElement('button', {
          type: 'button',
          className: 'dsh-memo-iconBtn',
          'data-tip': t('closeResult'),
          'aria-label': t('closeResult'),
          onClick: onClose,
        }, React.createElement(Icon, { path: ICON.close })),
      ),
    ),
    collapsed ? null : children,
  )
}

/**
 * The memo settings page.
 * @param props - controller, translator, and shell affordances.
 * @returns the board element.
 */
export function MemoBoard({ controller, t, close, openUrl, copyText }: MemoBoardProps): React.ReactElement {
  const view = useView(controller)
  const [draft, setDraft] = React.useState('')
  const [analysisType, setAnalysisType] = React.useState<MemoAnalysisType>('梳理')
  const [openCard, setOpenCard] = React.useState<MemoCard | null>(null)
  const [editing, setEditing] = React.useState<{ card: MemoCard; text: string } | null>(null)
  const [pendingDelete, setPendingDelete] = React.useState<MemoCard | null>(null)
  const [showIssueEditor, setShowIssueEditor] = React.useState(false)
  const [issueText, setIssueText] = React.useState('')
  const [copied, setCopied] = React.useState<string | null>(null)
  /**
   * Names of the result cards whose body is hidden. Collapsing is presentation
   * only, so it stays in the component instead of in the controller or storage.
   */
  const [collapsedResults, setCollapsedResults] = React.useState<readonly string[]>([])

  React.useEffect(() => {
    if (view.status === 'cold') void controller.refresh()
  }, [view.status, controller])

  const submitDraft = async (): Promise<void> => {
    if (await controller.addCard(draft)) setDraft('')
  }

  const submitEdit = async (): Promise<void> => {
    if (editing === null) return
    if (await controller.updateCard(editing.card, editing.text)) setEditing(null)
  }

  const copyCard = async (card: MemoCard): Promise<void> => {
    if (await controller.duplicateCard(card, t('copySuffix'))) {
      setCopied(card.id)
      // Confirmation is transient: the clipboard is a convenience, the
      // duplicate in the grid is the real feedback.
      setTimeout(() => setCopied(current => (current === card.id ? null : current)), 2000)
    }
  }

  /**
   * Open the pre-filled issue editor on GitHub.
   *
   * The URL comes from the github-issue service, which shortens the body when
   * the URL would exceed what GitHub accepts; composing it here instead would
   * bypass that limit.
   */
  const openIssue = async (): Promise<void> => {
    const url = await controller.issuePrefillUrl()
    if (url !== null) openUrl(url)
  }

  /**
   * Copy the untruncated report, so a body shortened for the URL is still
   * available to paste into the issue form.
   */
  const copyIssueBody = async (): Promise<void> => {
    const report = view.issueReport
    if (report === null) return
    try {
      await copyText(`${report.title}\n\n${report.body}`)
    } catch {
      // A blocked or absent clipboard is not worth failing the board over: the
      // report stays on screen for manual selection.
      return
    }
    setCopied(ISSUE_BODY_COPY_KEY)
    setTimeout(() => setCopied(current => (current === ISSUE_BODY_COPY_KEY ? null : current)), 2000)
  }

  /** Show or hide one result card's body. */
  const toggleResult = (name: string): void => {
    setCollapsedResults(current =>
      current.includes(name) ? current.filter(entry => entry !== name) : [...current, name])
  }

  return React.createElement('section', { className: 'dsh-memo', 'aria-label': t('panelTitle') },
    // ── Board header: title, then Add Issue / Analyze Logs / Close, each with
    //    an icon and its label, Close rightmost ──
    React.createElement('header', { className: 'dsh-memo-head' },
      React.createElement('h2', { className: 'dsh-memo-title' }, t('panelTitle')),
      React.createElement('div', { className: 'dsh-memo-headActions' },
        React.createElement('button', {
          type: 'button',
          className: 'dsh-memo-headBtn',
          disabled: view.busy,
          onClick: () => setShowIssueEditor(open => !open),
        }, React.createElement(Icon, { path: ICON.addIssue }), t('addIssue')),
        React.createElement('button', {
          type: 'button',
          className: 'dsh-memo-headBtn',
          disabled: view.busy,
          onClick: () => void controller.analyzeLogs(),
        }, React.createElement(Icon, { path: ICON.analyzeLogs }), t('analyzeLogs')),
        React.createElement('button', {
          type: 'button',
          className: 'dsh-memo-headBtn',
          disabled: view.busy,
          onClick: close,
        }, React.createElement(Icon, { path: ICON.close }), t('close')),
      ),
    ),

    view.error !== null
      ? React.createElement('div', { className: 'dsh-memo-error', role: 'alert' },
          React.createElement('span', null, view.error),
          React.createElement('button', {
            type: 'button', className: 'dsh-memo-linkBtn', onClick: () => controller.clearError(),
          }, t('dismiss')))
      : null,

    // ── Dimension switch (周/月/季/年) with the year switcher on the same row ──
    React.createElement('div', { className: 'dsh-memo-dimRow' },
      React.createElement('nav', { className: 'dsh-memo-dims', role: 'tablist', 'aria-label': t('period') },
        ...PERIODS.map(period => React.createElement('button', {
          key: period,
          type: 'button',
          role: 'tab',
          'aria-selected': view.selection.period === period,
          className: 'dsh-memo-dim',
          'data-active': view.selection.period === period ? '' : undefined,
          disabled: view.busy,
          onClick: () => void controller.selectPeriod(period),
        }, t(periodKey(period)))),
      ),
      view.years.length > 0
        ? React.createElement('select', {
            className: 'dsh-memo-year',
            value: view.year,
            'aria-label': t('yearFilter'),
            disabled: view.busy,
            onChange: (event: React.ChangeEvent<HTMLSelectElement>) => controller.selectYear(event.target.value),
          }, ...view.years.map(year => React.createElement('option', { key: year, value: year }, year)))
        : null,
    ),

    // ── History chips of the active dimension and year: only periods that hold
    //    a memo, plus the current period, newest first ──
    view.visiblePeriods.length > 0
      ? React.createElement('div', { className: 'dsh-memo-history', role: 'tablist', 'aria-label': t('history') },
          ...view.visiblePeriods.map(entry => React.createElement('button', {
            key: entry.label,
            type: 'button',
            role: 'tab',
            'aria-selected': entry.label === view.selection.label,
            className: 'dsh-memo-chip',
            'data-active': entry.label === view.selection.label ? '' : undefined,
            'data-current': entry.current ? '' : undefined,
            onClick: () => void controller.selectLabel(entry.label),
          }, periodDisplay(entry.period, entry.label))))
      : null,

    // ── Creator: the dashed full-width affordance from the preset grid ──
    // Archived targets cannot be written to, so the composer says why and offers
    // the way out instead of accepting text it would then have to refuse.
    React.createElement('div', { className: 'dsh-memo-composer' },
      React.createElement('textarea', {
        className: 'dsh-memo-input',
        value: draft,
        placeholder: controller.targetArchived ? t('archivedComposerHint') : t('addPlaceholder'),
        'aria-label': controller.targetArchived ? t('archivedComposerHint') : t('addPlaceholder'),
        disabled: view.busy || controller.targetArchived,
        rows: 2,
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => setDraft(event.target.value),
      }),
      React.createElement('button', {
        type: 'button',
        className: 'dsh-memo-creator',
        disabled: view.busy || controller.targetArchived || draft.trim().length === 0,
        onClick: () => void submitDraft(),
      }, React.createElement(Icon, { path: ICON.addIssue }), t('addEntry')),
      controller.targetArchived
        ? React.createElement('div', { className: 'dsh-memo-archiveHint' },
            React.createElement('span', null, t('archivedComposerHint')),
            controller.targetArchivedQuarter() === undefined
              ? null
              : React.createElement('button', {
                  type: 'button',
                  className: 'dsh-memo-btn',
                  onClick: () => {
                    const quarter = controller.targetArchivedQuarter()
                    if (quarter !== undefined) void controller.unarchiveQuarter(quarter.label)
                  },
                }, t('unarchiveQuarter')))
        : null,
    ),

    // ── Card grid ──
    view.status === 'loading' && view.cards.length === 0
      ? React.createElement('div', { className: 'dsh-memo-empty' }, t('loading'))
      : view.cards.length === 0
        ? React.createElement('div', { className: 'dsh-memo-empty' },
            view.totalCards === 0 ? t('noEntries') : t('noCardsInPeriod'))
        : React.createElement('div', { className: 'dsh-memo-grid' },
            ...view.cards.map(card => React.createElement(CardTile, {
              key: card.id,
              card,
              t,
              copied: copied === card.id,
              disabled: view.busy,
              archived: view.archivedWeekIds.has(card.weekId),
              onOpen: () => setOpenCard(card),
              onEdit: () => setEditing({ card, text: card.content }),
              onCopy: () => void copyCard(card),
              onDelete: () => setPendingDelete(card),
              onUnarchive: () => {
                // A card knows its week, not its quarter; the host-resolved
                // archive does the mapping, and unarchiving releases the whole
                // quarter because that is the unit that was archived.
                const quarter = controller.archivedQuarterOf(card)
                if (quarter !== undefined) void controller.unarchiveQuarter(quarter.label)
              },
            }))),

    // ── Analysis ──
    React.createElement('div', { className: 'dsh-memo-tools' },
      React.createElement('div', { className: 'dsh-memo-analysisTypes', role: 'group', 'aria-label': t('analyze') },
        ...ANALYSIS_TYPES.map(entry => React.createElement('button', {
          key: entry.type,
          type: 'button',
          className: 'dsh-memo-chip',
          'data-active': analysisType === entry.type ? '' : undefined,
          disabled: view.busy,
          onClick: () => setAnalysisType(entry.type),
        }, t(entry.key)))),
      React.createElement('div', { className: 'dsh-memo-actions' },
        // The model switcher rides on the analysis action itself: the model is
        // what that action will use, so keeping them apart made the user's
        // second decision look unrelated to their first.
        React.createElement(ModelSplitButton, {
          key: 'analyze',
          controller,
          view,
          t,
          onAnalyze: () => void controller.analyze(analysisType),
        }),
        React.createElement('button', {
          type: 'button', className: 'dsh-memo-btn', disabled: view.busy,
          onClick: () => void controller.exportReport(),
        }, t('exportReport')),
        React.createElement('button', {
          type: 'button', className: 'dsh-memo-btn', disabled: view.busy,
          onClick: () => void controller.refresh(),
        }, t('refresh')),
        // Archiving names a quarter, and only the quarter dimension names one,
        // so the action appears where the label is unambiguous instead of
        // guessing a quarter out of whichever period happens to be on screen.
        view.selection.period === 'quarter'
          ? React.createElement('button', {
              type: 'button',
              className: 'dsh-memo-btn',
              'data-active': controller.archivedQuarterLabel() === undefined ? undefined : '',
              disabled: view.busy,
              onClick: () => {
                const archivedLabel = controller.archivedQuarterLabel()
                void (archivedLabel === undefined
                  ? controller.archiveCurrentQuarter()
                  : controller.unarchiveQuarter(archivedLabel))
              },
            }, controller.archivedQuarterLabel() === undefined
              ? t('archiveQuarter')
              : t('unarchiveQuarter'))
          : null,
      ),
    ),

    view.analysis !== null
      ? React.createElement(ResultCard, {
          title: t('analysisResult'),
          collapsed: collapsedResults.includes('analysis'),
          t,
          onToggle: () => toggleResult('analysis'),
          onClose: () => controller.clearAnalysis(),
        },
          // Which model actually answered, so "who wrote this" is never a guess.
          view.analysisModel.length > 0
            ? React.createElement('div', { className: 'dsh-memo-analysisModel' },
                routeSummary(view.analysisProvider, view.analysisModel, view.analysisModel))
            : null,
          React.createElement('pre', { className: 'dsh-memo-pre' }, view.analysis))
      : null,

    view.report !== null
      ? React.createElement(ResultCard, {
          title: t('reportResult'),
          collapsed: collapsedResults.includes('report'),
          t,
          onToggle: () => toggleResult('report'),
          onClose: () => controller.clearReport(),
        }, React.createElement('pre', { className: 'dsh-memo-pre' }, view.report))
      : null,

    view.logAnalysis !== null
      ? React.createElement(ResultCard, {
          title: t('logAnalysisTitle'),
          collapsed: collapsedResults.includes('logAnalysis'),
          t,
          onToggle: () => toggleResult('logAnalysis'),
          onClose: () => controller.clearLogAnalysis(),
        },
        React.createElement('pre', { className: 'dsh-memo-pre' }, view.logAnalysis.report.body),
        React.createElement('button', {
          type: 'button', className: 'dsh-memo-btn',
          onClick: () => openUrl(view.logAnalysis!.issueUrl),
        }, t('openPrefilledIssue')))
      : null,

    // ── Issue editor ──
    showIssueEditor
      ? React.createElement('section', { className: 'dsh-memo-result' },
          React.createElement('h3', { className: 'dsh-memo-subtitle' }, t('issueEditorTitle')),
          React.createElement('textarea', {
            className: 'dsh-memo-input',
            value: issueText,
            placeholder: t('issuePlaceholder'),
            'aria-label': t('issuePlaceholder'),
            disabled: view.busy,
            rows: 3,
            onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => setIssueText(event.target.value),
          }),
          React.createElement('div', { className: 'dsh-memo-actions' },
            React.createElement('button', {
              type: 'button', className: 'dsh-memo-btn', disabled: view.busy || issueText.trim().length === 0,
              onClick: () => void controller.optimizeIssue(issueText),
            }, t('optimizeIssue')),
            React.createElement('button', {
              type: 'button', className: 'dsh-memo-btn', disabled: view.busy || view.issueReport === null,
              onClick: () => void openIssue(),
            }, t('openGithub')),
            React.createElement('button', {
              type: 'button', className: 'dsh-memo-btn', disabled: view.issueReport === null,
              onClick: () => void copyIssueBody(),
            }, copied === ISSUE_BODY_COPY_KEY ? t('copied') : t('copyIssueBody')),
            React.createElement('button', {
              type: 'button', className: 'dsh-memo-btn',
              onClick: () => { setIssueText(''); setShowIssueEditor(false) },
            }, t('clearIssue')),
          ),
          view.issueReport !== null
            ? React.createElement('pre', { className: 'dsh-memo-pre' },
                `${view.issueReport.title}\n\n${view.issueReport.body}`)
            : null)
      : null,

    // ── Detail modal ──
    openCard !== null
      ? React.createElement(DetailDialog, {
          card: openCard,
          t,
          archived: controller.isArchived(openCard),
          onClose: () => setOpenCard(null),
          onEdit: () => { setEditing({ card: openCard, text: openCard.content }); setOpenCard(null) },
          onUnarchive: () => {
            const quarter = controller.archivedQuarterOf(openCard)
            if (quarter !== undefined) void controller.unarchiveQuarter(quarter.label)
            setOpenCard(null)
          },
        })
      : null,

    // ── Edit dialog ──
    editing !== null
      ? React.createElement(EditDialog, {
          text: editing.text,
          busy: view.busy,
          t,
          onChange: text => setEditing({ card: editing.card, text }),
          onCancel: () => setEditing(null),
          onConfirm: () => void submitEdit(),
        })
      : null,

    // ── Delete confirmation ──
    pendingDelete !== null
      ? React.createElement(ConfirmDialog, {
          message: t('confirmDeleteText'),
          confirmLabel: t('deleteEntry'),
          cancelLabel: t('cancel'),
          busy: view.busy,
          onCancel: () => setPendingDelete(null),
          onConfirm: () => {
            const target = pendingDelete
            setPendingDelete(null)
            void controller.deleteCard(target)
          },
        })
      : null,
  )
}

/** Props of {@link ModelSplitButton}. */
interface ModelSplitButtonProps {
  /** The controller that records and applies the chosen route. */
  readonly controller: MemoController
  /** The current board state. */
  readonly view: MemoViewState
  /** Locale lookup. */
  readonly t: (key: MemoKey) => string
  /** Runs the analysis the primary half of the button stands for. */
  readonly onAnalyze: () => void
}

/**
 * The analysis action with the model it will use attached to it.
 *
 * One button with two hit areas, split by a hairline: the left runs the action,
 * the right offers the routes it could use. Keeping the choice in a separate
 * control made it look unrelated to the action it governs.
 *
 * The route in effect is on the caret's tooltip rather than beside the button:
 * following the deployment's default is the ordinary case, and a permanent label
 * for it would spend the toolbar's width on the expected answer. Which model
 * actually answered is still stated on the result card.
 *
 * The menu lists every provider the *host* reported. A browser can enumerate
 * neither providers nor their models, and inventing one is the defect that once
 * made every analysis call fail, so a selection here is always picked from the
 * deployment's own registry — never typed, guessed, or hardcoded.
 */
function ModelSplitButton({ controller, view, t, onAnalyze }: ModelSplitButtonProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const caret = React.useRef<HTMLButtonElement | null>(null)
  const menu = React.useRef<HTMLDivElement | null>(null)

  const choice = view.modelChoice
  const defaultLabel = routeSummary(view.routeProvider, view.routeModel, t('noModelRoute'))
  const effectiveLabel = choice === undefined
    ? defaultLabel
    : routeSummary(choice.provider, choice.model, choice.model)
  // "The registry could not be read" and "the deployment registered nothing" are
  // both unswitchable, but only the first has a reason worth showing.
  const switchable = view.providers.length > 0

  // A menu that closes only by picking an item is a trap, so a press anywhere
  // else and Escape both close it and hand focus back to the control that
  // opened it.
  React.useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (target !== null && (menu.current?.contains(target) === true || caret.current?.contains(target) === true)) {
        return
      }
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpen(false)
      caret.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // Focus lands on the current choice, so a keyboard user opens the menu on the
  // answer to "which model is this?" instead of at its top.
  React.useEffect(() => {
    if (!open) return undefined
    const checked = menu.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]')
    const target = checked ?? menu.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]')
    target?.focus()
    return undefined
  }, [open])

  const choose = (next: MemoModelChoice | undefined): void => {
    controller.selectModel(next)
    setOpen(false)
    caret.current?.focus()
  }

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
    const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])
    if (items.length === 0) return
    event.preventDefault()
    const active = items.findIndex(item => item === document.activeElement)
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : event.key === 'ArrowDown'
          ? (active + 1) % items.length
          : (active <= 0 ? items.length - 1 : active - 1)
    items[next]?.focus()
  }

  const items: React.ReactElement[] = [
    React.createElement('button', {
      key: 'follow-default',
      type: 'button',
      role: 'menuitemradio',
      className: 'dsh-memo-menuItem',
      'aria-checked': choice === undefined ? 'true' : 'false',
      onClick: () => choose(undefined),
    }, `${t('followDefault')} (${defaultLabel})`),
  ]
  for (const provider of view.providers) {
    items.push(React.createElement('div', {
      key: `provider:${provider.id}`,
      role: 'presentation',
      className: 'dsh-memo-menuGroup',
    }, provider.name.length > 0 ? provider.name : provider.id))
    // A pinned model the catalog no longer lists stays offered: declaring a
    // choice invalid would silently change which model answers.
    const models = [...provider.models, ...pinnedModel(provider, view)]
    if (models.length === 0) {
      // A provider that could not be read stays visible with its reason. Hiding
      // it would read as "this provider is gone", which is a different claim.
      items.push(React.createElement('div', {
        key: `empty:${provider.id}`,
        className: 'dsh-memo-menuNote',
      }, provider.error ?? t('providerEmpty')))
      continue
    }
    for (const model of models) {
      const selected = choice !== undefined && choice.provider === provider.id && choice.model === model.id
      items.push(React.createElement('button', {
        key: `model:${provider.id}:${model.id}`,
        type: 'button',
        role: 'menuitemradio',
        className: 'dsh-memo-menuItem',
        'aria-checked': selected ? 'true' : 'false',
        onClick: () => choose({ provider: provider.id, model: model.id }),
      }, modelLabel(model)))
    }
  }

  return React.createElement('div', { className: 'dsh-memo-split' },
    React.createElement('button', {
      type: 'button',
      className: 'dsh-memo-btn dsh-memo-splitRun',
      disabled: view.busy,
      onClick: onAnalyze,
    }, t('analyze')),
    React.createElement('button', {
      ref: caret,
      type: 'button',
      className: 'dsh-memo-btn dsh-memo-splitCaret',
      disabled: view.busy || !switchable,
      'aria-haspopup': 'menu',
      'aria-expanded': open ? 'true' : 'false',
      'aria-label': t('modelLabel'),
      // The route in effect is a tooltip rather than a caption: following the
      // deployment's default is the normal case, so it needs no permanent label.
      title: switchable ? effectiveLabel : (view.catalogError ?? t('noModelRoute')),
      onClick: () => setOpen(current => !current),
    }, '\u25be'),
    open && switchable
      ? React.createElement('div', {
          ref: menu,
          className: 'dsh-memo-menu',
          role: 'menu',
          'aria-label': t('modelLabel'),
          onKeyDown: onMenuKeyDown,
        }, ...items)
      : null,
    switchable
      ? null
      : React.createElement('span', { className: 'dsh-memo-splitHint' },
          view.catalogError === undefined ? t('noModelRoute') : t('modelCatalogEmpty')),
  )
}

/** One card in the grid. */
function CardTile({ card, t, copied, disabled, archived, onOpen, onEdit, onCopy, onDelete, onUnarchive }: {
  card: MemoCard
  t: Translate
  copied: boolean
  disabled: boolean
  archived: boolean
  onOpen: () => void
  onEdit: () => void
  onCopy: () => void
  onDelete: () => void
  onUnarchive: () => void
}): React.ReactElement {
  return React.createElement('article', {
    className: 'dsh-memo-card',
    // Archived cards stay readable and stay openable; only what would change
    // the quarter is withheld.
    'data-archived': archived ? '' : undefined,
  },
    React.createElement('div', { className: 'dsh-memo-cardMain' },
      React.createElement('button', {
        type: 'button',
        className: 'dsh-memo-cardBody',
        onClick: onOpen,
        'aria-label': t('viewCard'),
      }, React.createElement('span', { className: 'dsh-memo-cardText' }, card.content)),
      React.createElement('div', { className: 'dsh-memo-cardMeta' },
        React.createElement('span', { className: 'dsh-memo-cardWeek' }, periodDisplay('week', card.weekId)),
        archived
          ? React.createElement('span', { className: 'dsh-memo-archivedTag' }, t('archivedTag'))
          : null,
        React.createElement('time', { className: 'dsh-memo-cardTime', dateTime: new Date(card.createdAt).toISOString() },
          new Date(card.createdAt).toLocaleString())),
    ),
    React.createElement('div', { className: 'dsh-memo-cardFoot' },
      React.createElement(CardAction, { tip: t('viewCard'), path: ICON.view, onClick: onOpen, disabled }),
      archived
        // The edit slot becomes the way out of the archive: an archived card has
        // nothing to edit, and delete/duplicate would change an archive the user
        // has declared closed.
        ? React.createElement(CardAction, { tip: t('unarchiveQuarter'), path: ICON.unarchive, onClick: onUnarchive, disabled })
        : [
            React.createElement(CardAction, { key: 'edit', tip: t('editEntry'), path: ICON.edit, onClick: onEdit, disabled }),
            React.createElement(CardAction, {
              key: 'copy',
              tip: copied ? t('copied') : t('duplicateEntry'),
              path: ICON.copy,
              onClick: onCopy,
              disabled,
            }),
            React.createElement(CardAction, { key: 'delete', tip: t('deleteEntry'), path: ICON.trash, onClick: onDelete, disabled, danger: true }),
          ],
    ),
  )
}

/** One icon-only card action with a tooltip. */
function CardAction({ tip, path, onClick, disabled, danger = false }: {
  tip: string
  path: string
  onClick: () => void
  disabled: boolean
  danger?: boolean
}): React.ReactElement {
  return React.createElement('button', {
    type: 'button',
    className: danger ? 'dsh-memo-iconBtn dsh-memo-iconBtn--danger' : 'dsh-memo-iconBtn',
    'data-tip': tip,
    'aria-label': tip,
    disabled,
    onClick,
  }, React.createElement(Icon, { path }))
}

/** Read-only detail view of one card. */
function DetailDialog({ card, t, archived, onClose, onEdit, onUnarchive }: {
  card: MemoCard
  t: Translate
  archived: boolean
  onClose: () => void
  onEdit: () => void
  onUnarchive: () => void
}): React.ReactElement {
  return React.createElement('div', { className: 'dsh-memo-overlay', role: 'presentation', onClick: onClose },
    React.createElement('div', {
      className: 'dsh-memo-dialog',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': t('viewCard'),
      onClick: (event: React.MouseEvent) => event.stopPropagation(),
    },
      React.createElement('h3', { className: 'dsh-memo-subtitle' }, t('viewCard')),
      React.createElement('div', { className: 'dsh-memo-cardMeta' },
        React.createElement('span', { className: 'dsh-memo-cardWeek' }, periodDisplay('week', card.weekId)),
        archived
          ? React.createElement('span', { className: 'dsh-memo-archivedTag' }, t('archivedTag'))
          : null,
        React.createElement('time', { dateTime: new Date(card.createdAt).toISOString() },
          new Date(card.createdAt).toLocaleString())),
      React.createElement('pre', { className: 'dsh-memo-pre' }, card.content),
      React.createElement('div', { className: 'dsh-memo-actions' },
        // Same rule as the card's action row: an archived card has no edit slot,
        // it has a way out of the archive. Leaving an edit button here would put
        // editing back one click away from the button that was withheld.
        archived
          ? React.createElement('button', { type: 'button', className: 'dsh-memo-btn', onClick: onUnarchive }, t('unarchiveQuarter'))
          : React.createElement('button', { type: 'button', className: 'dsh-memo-btn', onClick: onEdit }, t('editEntry')),
        React.createElement('button', { type: 'button', className: 'dsh-memo-btn', onClick: onClose }, t('close'))),
    ))
}

/** Edit dialog for one card. */
function EditDialog({ text, busy, t, onChange, onCancel, onConfirm }: {
  text: string
  busy: boolean
  t: Translate
  onChange: (text: string) => void
  onCancel: () => void
  onConfirm: () => void
}): React.ReactElement {
  return React.createElement('div', { className: 'dsh-memo-overlay', role: 'presentation' },
    React.createElement('div', {
      className: 'dsh-memo-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('editEntry'),
    },
      React.createElement('h3', { className: 'dsh-memo-subtitle' }, t('editEntry')),
      React.createElement('textarea', {
        className: 'dsh-memo-input',
        value: text,
        'aria-label': t('editEntry'),
        disabled: busy,
        rows: 5,
        autoFocus: true,
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value),
      }),
      React.createElement('p', { className: 'dsh-memo-hint' }, t('forceConfirmText')),
      React.createElement('div', { className: 'dsh-memo-actions' },
        React.createElement('button', {
          type: 'button', className: 'dsh-memo-btn', disabled: busy || text.trim().length === 0, onClick: onConfirm,
        }, t('confirm')),
        React.createElement('button', { type: 'button', className: 'dsh-memo-btn', onClick: onCancel }, t('cancel'))),
    ))
}

/** Generic confirmation dialog. */
function ConfirmDialog({ message, confirmLabel, cancelLabel, busy, onCancel, onConfirm }: {
  message: string
  confirmLabel: string
  cancelLabel: string
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}): React.ReactElement {
  return React.createElement('div', { className: 'dsh-memo-overlay', role: 'presentation' },
    React.createElement('div', {
      className: 'dsh-memo-dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': confirmLabel,
    },
      React.createElement('p', { className: 'dsh-memo-hint' }, message),
      React.createElement('div', { className: 'dsh-memo-actions' },
        React.createElement('button', {
          type: 'button', className: 'dsh-memo-btn dsh-memo-btn--danger', disabled: busy, onClick: onConfirm,
        }, confirmLabel),
        React.createElement('button', { type: 'button', className: 'dsh-memo-btn', onClick: onCancel }, cancelLabel)),
    ))
}

/** Map a dimension to its locale key. */
function periodKey(period: string): MemoKey {
  if (period === 'week') return 'periodWeek'
  if (period === 'month') return 'periodMonth'
  if (period === 'quarter') return 'periodQuarter'
  return 'periodYear'
}

/**
 * Render a route for display.
 * @param provider - the provider route key.
 * @param model - the model id.
 * @param fallback - text to use when either half is missing.
 * @returns `provider · model`, or the fallback.
 */
function routeSummary(provider: string, model: string, fallback: string): string {
  if (provider.length === 0 || model.length === 0) return fallback
  return `${provider} · ${model}`
}

/**
 * A label for one model entry.
 * @param model - the model entry to label.
 * @returns `name (id)`, or just the id when the provider names it nothing.
 */
function modelLabel(model: MemoModelInfo): string {
  return model.name.length > 0 ? `${model.name} (${model.id})` : model.id
}

/**
 * The pinned model as an entry, when the provider's catalog omits it.
 *
 * The pinned id has to stay selectable or the menu could not display the value
 * it is actually using. DSH calls its catalog advisory — an unlisted model is
 * not an invalid one — so absence must not silently drop the user's choice.
 *
 * @param provider - the provider whose group is being built.
 * @param view - the current board state.
 * @returns one entry to append, or none when the catalog already lists it.
 */
function pinnedModel(provider: MemoModelProvider, view: MemoViewState): MemoModelInfo[] {
  const choice = view.modelChoice
  if (choice === undefined || choice.provider !== provider.id) return []
  if (provider.models.some(model => model.id === choice.model)) return []
  return [{ id: choice.model, name: '' }]
}

/** Subscribe a component to the controller. */
function useView(controller: MemoController): MemoViewState {
  const [state, setState] = React.useState<MemoViewState>(controller.getSnapshot)
  React.useEffect(() => {
    setState(controller.getSnapshot())
    return controller.subscribe(() => setState(controller.getSnapshot()))
  }, [controller])
  return state
}
