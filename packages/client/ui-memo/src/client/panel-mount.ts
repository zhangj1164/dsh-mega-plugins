/**
 * Center-column panel mount — creates a React root inside the dsh web
 * center column (conversation area), mirroring the task-board pattern.
 *
 * The panel is absolutely positioned within the center column and toggled
 * via the `data-dsh-memo-active` attribute on `<html>`. When active, the
 * conversation content is hidden via CSS; when inactive, the panel is
 * hidden and conversation content is visible.
 *
 * Clicking a session/workspace row in the sidebar auto-closes the panel
 * (same behavior as the task board): the user expects clicking a session
 * to switch to that conversation, not to stay on the memo board.
 *
 * @module dsh-client-ui-memo/client/panel-mount
 */

import * as React from 'react'
import * as ReactDOM from 'react-dom/client'

/** Selector for the dsh web center column (covers rc.6 and older shells). */
const CENTER_COLUMN_SELECTOR = '[data-pane="conversation"], [class*="centerCol"]'

/** Attribute on <html> that controls panel visibility. */
const ACTIVE_ATTR = 'data-dsh-memo-active'

/**
 * Selector for sidebar session/workspace rows. Clicking any of these while
 * the panel is open closes the panel so the conversation view takes over.
 * Mirrors the task board's SIDEBAR_ROW_SELECTOR.
 */
const SIDEBAR_ROW_SELECTOR = '[class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"], [class*="searchResultWorkspace"], [class*="newSession"]'

/**
 * Mount a React component in the center column as a non-modal panel.
 * @param Component - the React component to render.
 * @param props - props passed to the component.
 * @returns controller with toggle/open/close/dispose.
 */
export function mountPanel<P extends { onClose: () => void }>(
  Component: React.FC<P>,
  props: P,
): { toggle: () => void; open: () => void; close: () => void; dispose: () => void } {
  let root: ReactDOM.Root | undefined
  let container: HTMLDivElement | undefined

  const close = (): void => {
    document.documentElement.removeAttribute(ACTIVE_ATTR)
    if (root !== undefined) {
      root.unmount()
      root = undefined
      container?.remove()
      container = undefined
    }
  }

  const open = (): void => {
    if (root !== undefined) return
    const column = document.querySelector(CENTER_COLUMN_SELECTOR)
    if (column === null) {
      console.warn('[ui-memo] center column not found; falling back to body')
      container = document.createElement('div')
      container.dataset.dshMemoView = ''
      container.dataset.dshPlugin = 'memo'
      document.body.appendChild(container)
    } else {
      container = document.createElement('div')
      container.dataset.dshMemoView = ''
      container.dataset.dshPlugin = 'memo'
      column.appendChild(container)
    }
    document.documentElement.setAttribute(ACTIVE_ATTR, '')
    root = ReactDOM.createRoot(container)
    root.render(React.createElement(Component, props))
  }

  const toggle = (): void => {
    if (root !== undefined) close()
    else open()
  }

  // ── Sidebar-row-click-to-close (task-board pattern) ──
  // When the panel is open and the user clicks a session/workspace row in
  // the sidebar, auto-close so the conversation view takes over. The listener
  // is capture-phase so it fires before the session switch actually happens.
  const onSidebarRowClick = (event: Event): void => {
    if (root === undefined) return
    const target = event.target
    if (target instanceof Element && target.closest(SIDEBAR_ROW_SELECTOR) !== null) {
      close()
    }
  }
  document.addEventListener('click', onSidebarRowClick, true)

  const dispose = (): void => {
    document.removeEventListener('click', onSidebarRowClick, true)
    close()
  }

  return { toggle, open, close, dispose }
}
