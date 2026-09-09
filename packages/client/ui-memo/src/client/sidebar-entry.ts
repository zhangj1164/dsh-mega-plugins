/**
 * Sidebar DOM injection — inserts a button into the sidebar shell via
 * MutationObserver (skill-explorer / task-board pattern). DSH's sidebar
 * exposes no slot for external plugins, so DOM-level injection is the
 * sanctioned extension route.
 *
 * @module dsh-client-ui-memo/client/sidebar-entry
 */

export const ENTRY_SELECTOR = '[data-dsh-memo-entry]'

function sidebarRoot(): HTMLElement | undefined {
  const column = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]')
  if (column === null) return undefined
  return (column.querySelector('[class*="logoRow"]') as HTMLElement | null)?.parentElement
    ?? (column.firstElementChild as HTMLElement | null) ?? undefined
}

function newSessionButton(root: HTMLElement): Element | undefined {
  const nested = root.querySelector('button[class*="newSession"]')
  if (nested !== null) return nested
  for (const child of root.children) if (child.tagName === 'BUTTON') return child
  return undefined
}

function placeEntry(root: HTMLElement, entry: HTMLElement): boolean {
  const button = newSessionButton(root)
  if (button === undefined) return false
  if (entry.parentElement !== root) {
    const row = button.closest('[class*="logoRow"]')
    const base = row !== null && row.parentElement === root ? row : button
    const family = Array.from(root.children).filter(el =>
      el instanceof HTMLElement && el.matches(
        '[data-dsh-memo-entry], [data-dsh-taskboard-entry], [data-dsh-ssh-entry], [data-dsh-skill-explorer-entry]'))
    const anchor = family.length > 0
      ? family[family.length - 1].nextElementSibling
      : base.nextElementSibling
    root.insertBefore(entry, anchor)
  }
  return true
}

/**
 * Mount the sidebar entry button.
 * @param icon - inline SVG string.
 * @param label - accessible label and visible text.
 * @param tooltip - title attribute.
 * @param onToggle - click handler (typically toggles the overlay panel).
 * @returns disposer removing the entry and its observers.
 */
export function mountSidebarEntry(
  icon: string,
  label: string,
  tooltip: string,
  onToggle: () => void,
): () => void {
  if (typeof document !== 'undefined' && document.querySelector(ENTRY_SELECTOR) !== null) return () => {}

  const entry = document.createElement('button')
  entry.type = 'button'
  entry.setAttribute('data-dsh-memo-entry', '')
  entry.setAttribute('data-dsh-plugin', 'memo')
  entry.setAttribute('data-dsh-part', 'sidebar-entry')
  entry.setAttribute('aria-label', label)
  entry.setAttribute('title', tooltip)
  entry.innerHTML = `<span class="memo-entry-icon">${icon}</span><span class="memo-entry-label">${label}</span>`
  let isActive = false
  entry.addEventListener('click', () => {
    isActive = !isActive
    if (isActive) entry.setAttribute('data-active', '')
    else entry.removeAttribute('data-active')
    onToggle()
  })

  // Sync entry state with external close (e.g., when another panel takes over)
  const syncObserver = new MutationObserver(() => {
    const memoActive = document.documentElement.hasAttribute('data-dsh-memo-active')
    if (memoActive !== isActive) {
      isActive = memoActive
      if (isActive) entry.setAttribute('data-active', '')
      else entry.removeAttribute('data-active')
    }
  })
  syncObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-dsh-memo-active'] })

  let root: HTMLElement | undefined
  let placed = false
  let waitObs: MutationObserver
  let rootObs: MutationObserver

  const tryPlace = (): void => {
    if (root !== undefined && !root.isConnected) { rootObs.disconnect(); root = undefined; placed = false }
    if (placed && !document.body.contains(entry)) { rootObs.disconnect(); root = undefined; placed = false }
    root ??= sidebarRoot()
    if (root === undefined) return
    placed = placeEntry(root, entry)
    if (placed) rootObs.observe(root, { childList: true, subtree: true })
  }
  waitObs = new MutationObserver(() => { tryPlace() })
  waitObs.observe(document.body, { childList: true, subtree: true })
  rootObs = new MutationObserver(() => {
    if (root === undefined || !root.isConnected) { placed = false; tryPlace(); return }
    if (!root.contains(entry)) placed = placeEntry(root, entry)
  })
  tryPlace()

  return (): void => {
    waitObs.disconnect()
    rootObs.disconnect()
    syncObserver.disconnect()
    entry.remove()
  }
}

/**
 * Update the sidebar entry's label/tooltip (called on locale change).
 */
export function updateSidebarEntryLabel(label: string, tooltip: string): void {
  const entry = document.querySelector(ENTRY_SELECTOR)
  if (entry instanceof HTMLElement) {
    entry.setAttribute('aria-label', label)
    entry.setAttribute('title', tooltip)
    const labelEl = entry.querySelector('.memo-entry-label')
    if (labelEl) labelEl.textContent = label
  }
}
