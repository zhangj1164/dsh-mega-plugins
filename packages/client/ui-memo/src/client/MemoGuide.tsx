/**
 * First-use guide for the memo board.
 *
 * The board opens this overlay on its own when the stored guide version is
 * behind the content version, and its header offers it again on demand. The
 * guide is deliberately a sequence of small pages rather than one wall of text:
 * the board is a dense surface, and a tour that names one feature at a time is
 * read instead of dismissed.
 *
 * @module @zhangj1164/dsh-client-ui-memo/client/MemoGuide
 */

import * as React from 'react'
import type { MemoGuideStep } from './logic.ts'
import type { MemoKey } from './locales.ts'

/** Props of {@link MemoGuide}. */
export interface MemoGuideProps {
  /** Locale lookup bound to this plugin's dictionary. */
  readonly t: (key: MemoKey) => string
  /** The pages to show, in display order; never empty. */
  readonly steps: readonly MemoGuideStep[]
  /** Mark the guide content read and hide the guide. */
  readonly onClose: () => void
}

/**
 * Render the guide as a modal over the board.
 *
 * It uses the board's ordinary overlay/dialog classes, so Escape, the backdrop,
 * and the focused primary button behave the way they do in every other dialog
 * here. The primary button starts focused: the first keypress moves to the next
 * page instead of reaching the board behind the overlay.
 *
 * @param props - pages, translator, and the close callback.
 * @returns the guide overlay.
 */
export function MemoGuide({ t, steps, onClose }: MemoGuideProps): React.ReactElement {
  const [index, setIndex] = React.useState(0)
  const last = index >= steps.length - 1
  const step = steps[index] ?? steps[0]

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return React.createElement('div', { className: 'dsh-memo-overlay', role: 'presentation', onClick: onClose },
    React.createElement('div', {
      className: 'dsh-memo-dialog dsh-memo-guide',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': t('guideTitle'),
      onClick: (event: React.MouseEvent) => event.stopPropagation(),
    },
      React.createElement('div', { className: 'dsh-memo-guideHead' },
        React.createElement('h3', { className: 'dsh-memo-subtitle' }, t('guideTitle')),
        React.createElement('span', { className: 'dsh-memo-guideCounter', 'aria-live': 'polite' },
          `${String(index + 1)} / ${String(steps.length)}`)),
      step === undefined
        ? null
        : React.createElement('div', { className: 'dsh-memo-guideBody' },
            React.createElement('h4', { className: 'dsh-memo-guideStep' }, t(step.title)),
            React.createElement('p', { className: 'dsh-memo-guideText' }, t(step.body))),
      React.createElement('div', { className: 'dsh-memo-actions dsh-memo-guideActions' },
        // The first page can only move forward, so its secondary button skips
        // the whole tour; a later page keeps "Back" where that button was, so
        // the row does not jump under the pointer between pages.
        index === 0
          ? React.createElement('button', {
              type: 'button', className: 'dsh-memo-btn', onClick: onClose,
            }, t('guideSkip'))
          : React.createElement('button', {
              type: 'button',
              className: 'dsh-memo-btn',
              onClick: () => { setIndex(current => Math.max(0, current - 1)) },
            }, t('guidePrevious')),
        last
          ? React.createElement('button', {
              type: 'button', className: 'dsh-memo-btn', autoFocus: true, onClick: onClose,
            }, t('guideStart'))
          : React.createElement('button', {
              type: 'button',
              className: 'dsh-memo-btn',
              autoFocus: true,
              onClick: () => { setIndex(current => Math.min(steps.length - 1, current + 1)) },
            }, t('guideNext'))),
    ))
}
