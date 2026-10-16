/**
 * OpenWiki preview plugin, browser half.
 *
 * Three registrations, in the order they depend on each other:
 *
 * 1. A right-Sidebar tab **type** on `ctx.sidebarRightTabs`, which is stage one
 *    of the tab system's two-stage contract: what the type is and what its chip
 *    says.
 * 2. The tab **body** into the keyed `sidebar.right.pane.tab` seat. The key is
 *    the definition's `id`, not its `kind` — a kind can be taken over by another
 *    implementation, the id cannot.
 * 3. The **entry button** into `conversation.session.header.utilities`, ordered
 *    below `open-in-app`'s `-10` so it renders to its left.
 *
 * The right-Sidebar services are read structurally through `ctx.get` rather than
 * imported. That is deliberate: `@deepseek-ai/dsh-client-ui-sidebar-right` is a
 * shell package that a deployment composes, and this plugin collaborates with it
 * through its service contract the way `@zhangj1164/dsh-memo` collaborates with
 * the `llm` service, so nothing here breaks when the shell's own versions move.
 *
 * @module @zhangj1164/dsh-openwiki-visualize/client
 */

import * as React from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import { OpenWikiClient, type RpcCaller } from './controller.ts'
import { OpenWikiPane } from './Pane.tsx'
import { OpenWikiEntryButton } from './EntryButton.tsx'
import { zh, en, type OpenWikiKey, type OpenWikiTranslate } from './locales.ts'
import { CSS_TEXT } from './styles.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'openwiki'

/** The tab kind the right Sidebar dispatches to this plugin's pane. */
export const OPENWIKI_TAB_KIND = 'openwiki'

/**
 * The tab type's implementation id, which is also the pane seat's key.
 *
 * The package name, because the tab registry requires an id unique across every
 * registration and a package name is exactly that.
 */
export const OPENWIKI_TAB_ID = '@zhangj1164/dsh-openwiki-visualize'

/**
 * Entry order in the Conversation header utilities.
 *
 * `open-in-app` registers there at `-10`, so a lower order places this button
 * immediately to its left, which is where a preview entry belongs: beside the
 * control that opens the workspace locally.
 */
export const OPENWIKI_ENTRY_ORDER = -20

/** The id the header utility registration is owned under. */
const OPENWIKI_ENTRY_ID = 'openwiki-visualize'

/** Minimal structural face of the right-Sidebar tab registry (stage one). */
interface SidebarRightTabsFace {
  register(definition: {
    readonly id: string
    readonly kind: string
    readonly multiple?: boolean
    readonly keepMounted?: boolean
    readonly title: (address: string) => string
  }): () => void
}

/**
 * Minimal structural face of the right-Sidebar navigation service.
 *
 * The reveal methods are optional because revealing is only a best effort:
 * `openTab` places a tab, and a collapsed column shows none of it, so a caller
 * that can ask whether the column is expanded does, and one that cannot still
 * opens the tab.
 */
interface SidebarRightFace {
  openTab(kind: string, options?: { readonly params?: Record<string, unknown> }): void
  isExpanded?(): boolean
  toggleExpanded?(): void
}

/**
 * Required services: slots for the three registrations, locale for the
 * dictionaries and the chip copy, connection for the Remote calls.
 *
 * `sidebarRight` is absent on purpose — it is read optionally, so a profile that
 * composes no right Sidebar still loads this plugin and simply has nothing to
 * open the preview into.
 */
export const inject = ['slots', 'locale', 'connection']

/**
 * Register the tab type, the pane body, and the header entry.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.dshPlugin = NS
    style.textContent = CSS_TEXT
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'ui-openwiki-visualize: styles')

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-openwiki-visualize: dictionaries')

  const connection = ctx.get('connection') as { rpc: RpcCaller } | undefined
  if (connection === undefined) {
    console.error('[ui-openwiki-visualize] connection service not available')
    return
  }

  const client = new OpenWikiClient(connection.rpc)
  ctx.effect(() => () => { client.dispose() }, 'ui-openwiki-visualize: controller')
  ctx.on('connection/reset', () => { void client.refresh() })

  const t: OpenWikiTranslate = (key: OpenWikiKey, vars) =>
    (ctx.locale.bind(NS) as unknown as OpenWikiTranslate)(key, vars)

  const tabs = ctx.get('sidebarRightTabs') as SidebarRightTabsFace | undefined
  if (tabs === undefined) {
    console.warn('[ui-openwiki-visualize] right Sidebar tab registry not available; the preview cannot be opened')
  } else {
    ctx.effect(() => tabs.register({
      id: OPENWIKI_TAB_ID,
      kind: OPENWIKI_TAB_KIND,
      multiple: false,
      title: () => ctx.locale.bind(NS)('tab.title'),
    }), 'ui-openwiki-visualize: tab type')
  }

  /**
   * Start the visualizer for the current workspace, then reveal the preview tab.
   *
   * Starting is a precondition of opening rather than a separate user step: a tab
   * that only ever points at a stopped server would be a dead pane.
   */
  const open = (): void => {
    void client.start().then(status => {
      if (status === undefined) return
      const sidebar = ctx.get('sidebarRight') as SidebarRightFace | undefined
      if (sidebar === undefined) {
        console.warn('[ui-openwiki-visualize] right Sidebar service not available')
        return
      }
      sidebar.openTab(OPENWIKI_TAB_KIND, { params: { port: status.port } })
      // A tab placed in a collapsed column shows nothing, so reveal it. The
      // guard is what keeps this from collapsing a column the user already had
      // open, which calling `toggleExpanded` unconditionally would do.
      if (sidebar.isExpanded?.() === false) sidebar.toggleExpanded?.()
    })
  }

  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: OPENWIKI_TAB_ID,
  }, () => React.createElement(OpenWikiPane, { client, t })))

  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: OPENWIKI_ENTRY_ID,
    order: OPENWIKI_ENTRY_ORDER,
    locale: NS,
  }, () => React.createElement(OpenWikiEntryButton, { client, t, open })))
}
