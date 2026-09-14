/**
 * Memo UI plugin, browser half.
 *
 * The board is a first-class main panel. A `sidebar.panellist` entry gives it
 * the sidebar button — the sidebar itself owns that button, its accessible name,
 * and its active state, so this plugin contributes only a glyph — and a keyed
 * `main` entry renders the board while that id is the selected panel.
 *
 * @module dsh-client-ui-memo/client
 */

import * as React from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots/client'
import { MemoController, type RpcCaller } from './controller.ts'
import { MemoBoard } from './MemoBoard.tsx'
import { zh, en, type MemoKey } from './locales.ts'
import { CSS_TEXT } from './styles.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'memo'

/**
 * Panel id.
 *
 * One id addresses both halves of the entry: it is the `sidebar.panellist` entry
 * whose button the sidebar renders, and the `main` key the board mounts under,
 * so selecting this id is exactly "open the memo board".
 */
export const MEMO_PANEL_ID = 'memo'

/** Sidebar position: after the shipped entries. */
export const MEMO_PANEL_ORDER = 30

/**
 * Panel the board returns to when it closes.
 *
 * The layout reserves the `conversation` key for the Conversation panel, so this
 * is a protocol constant rather than a deployment variable.
 */
const CONVERSATION_PANEL_ID = 'conversation' as MainPanelId

/**
 * Plugin configuration.
 *
 * `repoUrl` is the one deployment variable this half needs: the issue editor's
 * "open on GitHub" action must not hardcode a repository. It defaults to the
 * same project the host bundle patches in, and a deployment overrides it in
 * its composition.
 */
export interface Config {
  /** Repository that receives issues created from the memo board. */
  repoUrl: string
}

/** Default repository, overridable per deployment. */
export const DEFAULT_REPO_URL = 'https://github.com/zhangj1164/dsh-mega-plugins'

/**
 * Required services: slots for the two registrations, layout for panel
 * navigation, locale for i18n, theme for tokens, connection for RPC.
 */
export const inject = ['slots', 'layout', 'locale', 'theme', 'connection']

/**
 * The sidebar glyph.
 *
 * The sidebar's own button carries the label and the accessible name and
 * inherits its color for the active state, so the glyph only has to be a
 * `currentColor` shape drawn at the size the sidebar asks for.
 *
 * @param props - the glyph size chosen by the sidebar for its current width.
 * @returns the inline SVG glyph.
 */
function MemoGlyph({ size }: { readonly size: number }): React.ReactElement {
  return React.createElement('svg', {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  },
  React.createElement('rect', { x: 2.75, y: 2.25, width: 10.5, height: 11.5, rx: 1.5 }),
  React.createElement('path', { d: 'M5.75 6h4.5M5.75 8.5h4.5M5.75 11h2.5' }))
}

/**
 * Register the memo sidebar entry and its main panel.
 * @param ctx - client root context.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: ClientContext, config: Config = { repoUrl: DEFAULT_REPO_URL }): void {
  const repoUrl = config.repoUrl

  // Styles use DSH alias tokens, so they follow the active theme automatically.
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.dshPlugin = NS
    style.textContent = CSS_TEXT
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'ui-memo: styles')

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-memo: dictionaries')

  const connection = ctx.get('connection') as { rpc: RpcCaller } | undefined
  if (connection === undefined) {
    console.error('[ui-memo] connection service not available')
    return
  }

  const controller = new MemoController({ rpc: connection.rpc, repoUrl })
  ctx.effect(() => () => controller.dispose(), 'ui-memo: controller')

  ctx.on('connection/reset', () => { void controller.refresh() })

  /**
   * The label is a thunk, so the sidebar button follows the active locale
   * without the shell having to subscribe to locale state.
   */
  const label = (): string => ctx.locale.bind(NS)('nav')

  /**
   * Leave the board for the conversation panel. The layout owns panel selection,
   * so closing is a navigation rather than local component state.
   */
  const close = (): void => { ctx.layout.selectPanel(CONVERSATION_PANEL_ID) }

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: MEMO_PANEL_ID,
    order: MEMO_PANEL_ORDER,
    label,
  }, MemoGlyph))

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: MEMO_PANEL_ID,
  }, () => React.createElement(MemoBoard, {
    controller,
    t: (key: MemoKey) => ctx.locale.bind(NS)(key),
    close,
    openUrl: (url: string) => { window.open(url, '_blank', 'noopener,noreferrer') },
    copyText: (text: string) => navigator.clipboard.writeText(text),
  })))
}
