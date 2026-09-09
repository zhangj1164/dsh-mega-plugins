/**
 * Memo UI plugin, browser half.
 *
 * Sidebar DOM injection + center-column panel (task-board pattern).
 * The panel is non-modal: it replaces the conversation view when active,
 * toggled by the sidebar entry button via the `data-dsh-memo-active`
 * attribute on `<html>`.
 *
 * Supports DSH locale (zh/en) and theme (light/dark/system) automatically.
 *
 * Module structure follows the DSH client package convention (see
 * packages/client/AGENTS.md): index.ts is the apply entry, with
 * controller/panel/sidebar/locale/style modules split by responsibility.
 *
 * @module dsh-client-ui-memo/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import { MemoController, type RpcCaller } from './controller.ts'
import { createMemoPanel, ICON_SVG } from './MemoPanel.tsx'
import { mountSidebarEntry, updateSidebarEntryLabel, ENTRY_SELECTOR } from './sidebar-entry.ts'
import { mountPanel } from './panel-mount.ts'
import { zh, en, type MemoKey } from './locales.ts'
import { CSS_TEXT } from './styles.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'memo'

/** Required services: locale for i18n, theme for CSS tokens, connection for RPC. */
export const inject = ['slots', 'locale', 'theme', 'connection']

/**
 * Mount the memo sidebar entry and overlay panel.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)

  // ── Styles (CSS uses DSH alias tokens → follows theme automatically) ──
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.dshPlugin = 'memo'
    style.textContent = CSS_TEXT
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'ui-memo: styles')

  // ── Locale dictionaries ──
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-memo: dictionaries')

  // ── Re-bind translate on locale change + update sidebar entry label ──
  ctx.on('locale/change', () => {
    const fresh = ctx.locale.bind(NS)
    updateSidebarEntryLabel(fresh('entryLabel'), fresh('entryTooltip'))
  })

  // ── Connection RPC ──
  const connection = ctx.get('connection') as { rpc: RpcCaller } | undefined
  if (connection === undefined) {
    console.error('[ui-memo] connection service not available')
    return
  }

  const controller = new MemoController(connection.rpc)

  ctx.on('connection/reset', () => { void controller.refresh() })

  // ── Panel + sidebar entry ──
  const MemoPanel = createMemoPanel(controller, t)
  const panel = mountPanel(MemoPanel, { onClose: () => panel.close() })

  const disposers: Array<() => void> = []
  try {
    disposers.push(mountSidebarEntry(ICON_SVG, t('entryLabel'), t('entryTooltip'), () => panel.toggle()))
    disposers.push(() => panel.dispose())
    disposers.push(() => controller.dispose())
  } catch (error) {
    console.warn('[ui-memo] mount failed:', error)
  }

  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0)) dispose()
  }, 'ui-memo: ui mounts')
}
