/**
 * Memo board React component — non-modal inline panel in the center column.
 *
 * Mirrors the dsh-task-board pattern: the board occupies the full center
 * column area (not a modal overlay). It is toggled by the sidebar entry
 * button via the `data-dsh-memo-active` attribute on `<html>`.
 *
 * Features:
 * - Text entry with add button (req 1)
 * - Week history selector with past-week badge (req 2, 3)
 * - Entry edit/delete with force gate for past weeks (req 3)
 * - Period selector (week/month/quarter/year) for analysis (req 4)
 * - AI analysis buttons (organize/summarize/analyze) (req 4)
 * - Report export with .md download (req 6)
 * - Log analysis with pre-filled issue URL (req 8, 9)
 * - Issue editor with LLM optimization (req 11)
 * - Long-term memory store (persistent ledger) (supplement 3)
 *
 * @module dsh-client-ui-memo/client/MemoPanel
 */

import * as React from 'react'
import type { MemoAnalysisType, MemoAnalysisPeriod } from 'dsh-memo/client'
import type { MemoController, MemoViewState, RpcCaller } from './controller.ts'
import type { MemoKey } from './locales.ts'

const ICON_SVG = '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 2h8l2 2v10H3z"/><path d="M11 2v3h2"/><line x1="5" y1="8" x2="10" y2="8"/><line x1="5" y1="11" x2="9" y2="11"/></svg>'

export { ICON_SVG }

/** Stable translate function type. */
type T = (key: MemoKey) => string

export function createMemoPanel(controller: MemoController, t: T): React.FC<{ onClose: () => void }> {
  return function MemoPanel({ onClose }: { onClose: () => void }): React.ReactElement {
    const view = useShim(controller.subscribe, controller.getSnapshot)

    React.useEffect(() => {
      if (view.status === 'cold') void controller.refresh()
    }, [view.status, controller])

    const [text, setText] = React.useState('')
    const [analysisType, setAnalysisType] = React.useState<MemoAnalysisType>('梳理')
    const [period, setPeriod] = React.useState<MemoAnalysisPeriod>('week')
    const [showIssueEditor, setShowIssueEditor] = React.useState(false)
    const [issueText, setIssueText] = React.useState('')
    const [editingId, setEditingId] = React.useState<string | null>(null)
    const [editText, setEditText] = React.useState('')
    const [forceConfirm, setForceConfirm] = React.useState<{ action: () => void } | null>(null)

    const cw = view.weeks[view.selectedWeekIndex]
    const entries = cw?.entries ?? []
    const currentWeekId = view.weeks[0]?.weekId
    const isPastWeek = cw !== undefined && currentWeekId !== undefined && cw.weekId !== currentWeekId

    const handleEdit = (entryId: string, content: string): void => {
      setEditingId(entryId)
      setEditText(content)
    }

    const handleSubmitEdit = async (): Promise<void> => {
      if (!editingId || !cw) return
      const doEdit = async (): Promise<void> => {
        await controller.updateEntry(cw.weekId, editingId, editText, true)
        setEditingId(null)
        setEditText('')
      }
      if (isPastWeek) {
        setForceConfirm({ action: doEdit })
      } else {
        await doEdit()
      }
    }

    const handleDelete = async (entryId: string): Promise<void> => {
      if (!cw) return
      const doDelete = async (): Promise<void> => {
        await controller.deleteEntry(cw.weekId, entryId, true)
      }
      if (isPastWeek) {
        setForceConfirm({ action: doDelete })
      } else {
        await doDelete()
      }
    }

    // ── Build entry items as an array ──
    const entryItems = entries.length > 0
      ? entries.map((entry) =>
          React.createElement('div', { key: entry.id, className: 'dsh-memo-entry-item' },
            React.createElement('div', { className: 'dsh-memo-entry-content' },
              editingId === entry.id
                ? React.createElement('textarea', {
                    className: 'dsh-memo-textarea',
                    value: editText,
                    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setEditText(e.target.value),
                    disabled: view.busy,
                    style: { minHeight: '40px' },
                  })
                : React.createElement('div', null, String(entry.content)),
              React.createElement('div', { className: 'dsh-memo-meta' }, new Date(entry.createdAt).toLocaleString())),
            React.createElement('div', { className: 'dsh-memo-entry-actions' },
              editingId === entry.id
                ? React.createElement(React.Fragment, null,
                    React.createElement('button', { className: 'dsh-memo-entry-action', onClick: () => void handleSubmitEdit(), disabled: view.busy }, t('confirm')),
                    React.createElement('button', { className: 'dsh-memo-entry-action', onClick: () => { setEditingId(null); setEditText('') } }, t('cancel')))
                : React.createElement(React.Fragment, null,
                    React.createElement('button', { className: 'dsh-memo-entry-action', onClick: () => handleEdit(entry.id, entry.content) }, t('editEntry')),
                    React.createElement('button', { className: 'dsh-memo-entry-action', onClick: () => void handleDelete(entry.id) }, t('deleteEntry'))),
            ),
          )
        )
      : [React.createElement('div', { key: 'empty', className: 'dsh-memo-empty' }, t('noEntries'))]

    // ── Build entries section ──
    let entriesSection: React.ReactElement
    if (view.status === 'loading') {
      entriesSection = React.createElement('div', { className: 'dsh-memo-loading' }, t('loading'))
    } else if (cw !== undefined) {
      entriesSection = React.createElement('div', null,
        React.createElement('div', { className: 'dsh-memo-section-title' },
          t('currentWeek') + ': ' + cw.weekId + ' (' + entries.length + ' ' + t('entries') + ')',
          isPastWeek ? React.createElement('span', { className: 'dsh-memo-past-badge' }, t('forceConfirm')) : null),
        ...entryItems,
      )
    } else {
      entriesSection = React.createElement('div', { className: 'dsh-memo-empty' }, t('noWeeks'))
    }

    return React.createElement('div', { className: 'dsh-memo-board' },
      // Board header (title + close/back button)
      React.createElement('div', { className: 'dsh-memo-board-header' },
        React.createElement('h2', { className: 'dsh-memo-board-title' }, t('panelTitle')),
        React.createElement('button', { className: 'dsh-memo-btn', onClick: onClose, style: { marginLeft: 'auto' } }, t('close')),
      ),
      // Board body (scrollable content)
      React.createElement('div', { className: 'dsh-memo-board-body' },
        view.error ? React.createElement('div', { className: 'dsh-memo-error' }, view.error) : null,

        // ── Add entry ──
        React.createElement('textarea', {
          className: 'dsh-memo-textarea',
          value: text, onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value),
          placeholder: t('addPlaceholder'), disabled: view.busy,
        }),
        React.createElement('div', { className: 'dsh-memo-btnrow' },
          React.createElement('button', {
            className: 'dsh-memo-btn dsh-memo-btn-primary',
            onClick: () => { void controller.addEntry(text); setText('') },
            disabled: view.busy || !text.trim(),
          }, t('addEntry')),
          React.createElement('select', {
            className: 'dsh-memo-select',
            value: analysisType,
            onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setAnalysisType(e.target.value as MemoAnalysisType),
            disabled: view.busy,
          },
            React.createElement('option', { value: '梳理' }, t('organize')),
            React.createElement('option', { value: '总结' }, t('summarize')),
            React.createElement('option', { value: '分析' }, t('analyzeLabel'))),
          React.createElement('select', {
            className: 'dsh-memo-select',
            value: period,
            onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setPeriod(e.target.value as MemoAnalysisPeriod),
            disabled: view.busy,
          },
            React.createElement('option', { value: 'week' }, t('periodWeek')),
            React.createElement('option', { value: 'month' }, t('periodMonth')),
            React.createElement('option', { value: 'quarter' }, t('periodQuarter')),
            React.createElement('option', { value: 'year' }, t('periodYear'))),
          React.createElement('button', { className: 'dsh-memo-btn', onClick: () => void controller.analyze(analysisType, period), disabled: view.busy }, t('analyze')),
          React.createElement('button', { className: 'dsh-memo-btn', onClick: () => void controller.exportReport(period), disabled: view.busy }, t('exportReport')),
          React.createElement('button', { className: 'dsh-memo-btn', onClick: () => { void controller.analyzeLogs() }, disabled: view.busy }, t('analyzeLogs')),
          React.createElement('button', { className: 'dsh-memo-btn', onClick: () => setShowIssueEditor(!showIssueEditor), disabled: view.busy }, t('addIssue')),
          React.createElement('button', { className: 'dsh-memo-btn', onClick: () => void controller.refresh(), disabled: view.busy }, t('refresh')),
        ),

        // ── Week history ──
        view.weeks.length > 1
          ? React.createElement('div', null,
              React.createElement('div', { className: 'dsh-memo-subtitle' }, t('weekHistory')),
              React.createElement('div', { className: 'dsh-memo-week-list' },
                view.weeks.map((w, i) => React.createElement('button', {
                  key: w.weekId,
                  className: 'dsh-memo-week-chip',
                  'data-active': i === view.selectedWeekIndex ? '' : undefined,
                  onClick: () => controller.selectWeek(i),
                }, w.weekId)))
            )
          : null,

        // ── Entries ──
        entriesSection,

        // ── Force confirm dialog ──
        forceConfirm !== null
          ? React.createElement('div', { className: 'dsh-memo-error', style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
              React.createElement('div', { className: 'dsh-memo-subtitle' }, t('forceConfirm')),
              React.createElement('div', null, t('forceConfirmText')),
              React.createElement('div', { className: 'dsh-memo-btnrow' },
                React.createElement('button', {
                  className: 'dsh-memo-btn dsh-memo-btn-danger',
                  onClick: () => { void forceConfirm.action(); setForceConfirm(null) },
                }, t('confirm')),
                React.createElement('button', {
                  className: 'dsh-memo-btn',
                  onClick: () => setForceConfirm(null),
                }, t('cancel')),
              ),
            )
          : null,

        // ── Issue editor (req 11) ──
        showIssueEditor
          ? React.createElement('div', null,
              React.createElement('div', { className: 'dsh-memo-divider' }),
              React.createElement('div', { className: 'dsh-memo-subtitle' }, t('issueEditorTitle')),
              React.createElement('textarea', {
                className: 'dsh-memo-textarea',
                value: issueText,
                onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setIssueText(e.target.value),
                placeholder: t('issuePlaceholder'), disabled: view.busy,
                style: { minHeight: '60px' },
              }),
              React.createElement('div', { className: 'dsh-memo-btnrow' },
                React.createElement('button', {
                  className: 'dsh-memo-btn dsh-memo-btn-primary',
                  onClick: () => void controller.optimizeIssue(issueText),
                  disabled: view.busy || !issueText.trim(),
                }, t('optimizeIssue')),
                React.createElement('button', {
                  className: 'dsh-memo-btn',
                  onClick: () => { setIssueText(''); setShowIssueEditor(false) },
                  disabled: view.busy,
                }, t('clearIssue')),
              ),
              view.issueReport !== null
                ? React.createElement('div', null,
                    React.createElement('div', { className: 'dsh-memo-subtitle' }, t('issueOptimized')),
                    React.createElement('div', { className: 'dsh-memo-result' },
                      React.createElement('strong', null, view.issueReport.title),
                      '\n\n',
                      view.issueReport.body),
                    React.createElement('div', { className: 'dsh-memo-btnrow' },
                      React.createElement('button', {
                        className: 'dsh-memo-btn dsh-memo-btn-primary',
                        onClick: () => {
                          if (view.issueReport !== null) {
                            const params = new URLSearchParams()
                            params.set('title', view.issueReport.title)
                            params.set('body', view.issueReport.body)
                            params.set('labels', view.issueReport.labels.join(','))
                            controller.openUrl('https://github.com/zhangj1164/dsh-mega-plugins/issues/new?' + params.toString())
                          }
                        },
                      }, t('openGithub')),
                    ),
                  )
                : null,
            )
          : null,

        // ── Log analysis result (req 8, 9) ──
        view.logAnalysis !== null
          ? React.createElement('div', null,
              React.createElement('div', { className: 'dsh-memo-divider' }),
              React.createElement('div', { className: 'dsh-memo-subtitle' }, t('logAnalysisTitle')),
              React.createElement('div', { className: 'dsh-memo-result' },
                React.createElement('strong', null, view.logAnalysis.report.title),
                '\n\n',
                view.logAnalysis.report.body),
              React.createElement('div', { className: 'dsh-memo-btnrow' },
                React.createElement('button', {
                  className: 'dsh-memo-btn dsh-memo-btn-primary',
                  onClick: () => controller.openUrl(view.logAnalysis!.issueUrl),
                }, t('openPrefilledIssue')),
              ),
            )
          : null,

        // ── Analysis result ──
        view.analysis ? React.createElement('div', null,
          React.createElement('div', { className: 'dsh-memo-subtitle' }, t('analysisResult')),
          React.createElement('div', { className: 'dsh-memo-result' }, view.analysis)) : null,

        // ── Report result ──
        view.report ? React.createElement('div', null,
          React.createElement('div', { className: 'dsh-memo-subtitle' }, t('reportResult')),
          React.createElement('div', { className: 'dsh-memo-result' }, view.report)) : null,
      ),
    )
  }
}

/** useSyncExternalStore shim. */
function useShim<T>(subscribe: (fn: () => void) => (() => void), getSnapshot: () => T): T {
  const [state, setState] = React.useState<T>(getSnapshot)
  React.useEffect(() => {
    const fn = () => setState(getSnapshot())
    const dispose = subscribe(fn)
    fn()
    return dispose
  }, [subscribe, getSnapshot])
  return state
}
