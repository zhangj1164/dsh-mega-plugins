/**
 * The button that opens the OpenWiki preview.
 *
 * Placed in the Conversation header's utility list immediately to the left of
 * "Open locally": `open-in-app` holds `order -10` in that list, so this
 * plugin's lower order renders first.
 *
 * The button disables itself rather than opening an empty pane, and it says why
 * in its tooltip, so a workspace without a wiki does not look like a broken
 * preview.
 *
 * @module @zhangj1164/dsh-openwiki-visualize/client/EntryButton
 */

import * as React from 'react'
import type { OpenWikiClient } from './controller.ts'
import type { OpenWikiTranslate } from './locales.ts'
import { useOpenWikiState } from './hooks.ts'

/** Props the `conversation.session.header.utilities` seat supplies. */
export interface OpenWikiEntryButtonProps {
  /** The shared data controller. */
  readonly client: OpenWikiClient
  /** Translate function bound to this plugin's namespace. */
  readonly t: OpenWikiTranslate
  /** Start the visualizer and reveal the preview tab. */
  readonly open: () => void
}

/**
 * Why the preview cannot be opened, or `undefined` when it can.
 * @param state - the current view state.
 * @param t - the translate function.
 * @returns the user-facing reason, when there is one.
 */
function blockingReason(state: ReturnType<OpenWikiClient['getSnapshot']>, t: OpenWikiTranslate): string | undefined {
  const openwiki = state.environment?.openwiki
  if (openwiki !== undefined && !openwiki.found) return t('nav.disabled.noTool')
  if (openwiki !== undefined && !openwiki.meetsMinimum) {
    return t('empty.belowMinimum', { minimum: openwiki.minimumVersion })
  }
  if (state.workspace !== undefined && !state.workspace.hasWiki) return t('nav.disabled.noWiki')
  return undefined
}

/**
 * The OpenWiki glyph: an open book with a link mark.
 * @returns the inline SVG.
 */
function Glyph(): React.ReactElement {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M2.5 3.25h4a2 2 0 0 1 2 2v7a1.5 1.5 0 0 0-1.5-1.5h-4.5z" />
      <path d="M13.5 3.25h-4a2 2 0 0 0-2 2v7a1.5 1.5 0 0 1 1.5-1.5h4.5z" />
    </svg>
  )
}

/**
 * Render the Sidebar entry button.
 * @param props - the controller, the translate function, and the open action.
 * @returns the button.
 */
export function OpenWikiEntryButton({ client, t, open }: OpenWikiEntryButtonProps): React.ReactElement {
  const state = useOpenWikiState(client)

  React.useEffect(() => { void client.ensureLoaded() }, [client])

  const reason = blockingReason(state, t)
  const busy = state.starting
  const disabled = reason !== undefined || busy
  const title = busy ? t('nav.busy') : (reason ?? t('nav.tooltip'))

  return (
    <button
      type="button"
      className="dsh-openwiki-entry"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={() => { open() }}
    >
      <Glyph />
    </button>
  )
}
