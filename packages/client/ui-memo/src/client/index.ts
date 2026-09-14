/**
 * Memo UI plugin, browser half.
 *
 * The board is registered as a `settings.section` entry, the extension point
 * DSH provides for "one settings page per list entry" — the same seat the
 * official Agent preset page uses. The shell owns the nav row, the modal, and
 * the close affordance, so this plugin contributes no global DOM, no sidebar
 * observer, and no panel positioning: earlier revisions injected a sidebar row
 * and absolutely positioned a panel inside the conversation column, which both
 * fought the shell on every navigation and could not be tested.
 *
 * @module dsh-client-ui-memo/client
 */

import * as React from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
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

/** Settings section id, also the nav key the shell filters by. */
export const MEMO_SECTION_ID = 'memo'

/** Nav position: after the shipped sections (general/models/plugins/presets). */
export const MEMO_SECTION_ORDER = 30

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

/** Required services: slots for the section, locale for i18n, theme for tokens, connection for RPC. */
export const inject = ['slots', 'locale', 'theme', 'connection']

/**
 * Register the memo settings section.
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
   * The label is a thunk, so the nav row follows the active locale without the
   * shell having to subscribe to locale state.
   */
  const label = (): string => ctx.locale.bind(NS)('nav')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: MEMO_SECTION_ID,
    order: MEMO_SECTION_ORDER,
    label,
  }, ({ close }) => React.createElement(MemoBoard, {
    controller,
    t: (key: MemoKey) => ctx.locale.bind(NS)(key),
    close,
    openUrl: (url: string) => { window.open(url, '_blank', 'noopener,noreferrer') },
    copyText: (text: string) => navigator.clipboard.writeText(text),
  })))
}
