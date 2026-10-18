/**
 * The OpenWiki preview pane: a slim status bar above the embedded reader.
 *
 * The reader itself is a sandboxed iframe pointed at the visualizer's loopback
 * URL. The openwiki server sends no `X-Frame-Options` and no `frame-ancestors`
 * directive, so a cross-origin embed is permitted; that is what makes this pane
 * possible without proxying the site through the DSH web server.
 *
 * @module @zhangj1164/dsh-openwiki-visualize/client/Pane
 */

import * as React from 'react'
import type { OpenWikiClient, OpenWikiViewState } from './controller.ts'
import type { OpenWikiTranslate } from './locales.ts'
import { useOpenWikiState } from './hooks.ts'

/** Props the keyed `sidebar.right.pane.tab` seat supplies. */
export interface OpenWikiPaneProps {
  /** The shared data controller. */
  readonly client: OpenWikiClient
  /** Translate function bound to this plugin's namespace. */
  readonly t: OpenWikiTranslate
}

/**
 * Why no reader can be shown yet, or `undefined` when one can.
 * @param state - the current view state.
 * @param t - the translate function.
 * @returns the user-facing reason, when there is one.
 */
function blockingReason(state: OpenWikiViewState, t: OpenWikiTranslate): string | undefined {
  const openwiki = state.environment?.openwiki
  if (openwiki !== undefined && !openwiki.found) return t('empty.noTool')
  if (openwiki !== undefined && !openwiki.meetsMinimum) {
    return t('empty.belowMinimum', { minimum: openwiki.minimumVersion })
  }
  if (state.workspace !== undefined && !state.workspace.hasWiki) return t('empty.noWiki')
  return undefined
}

/**
 * One toolbar button.
 * @param props - the label, the click handler, and an optional brand variant.
 * @returns the button element.
 */
function BarButton({ label, onClick, brand = false }: {
  readonly label: string
  readonly onClick: () => void
  readonly brand?: boolean
}): React.ReactElement {
  return (
    <button
      type="button"
      className="dsh-openwiki-button"
      {...(brand ? { 'data-variant': 'brand' } : {})}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

/**
 * The version and update control group.
 * @param props - the controller, the state, and the translate function.
 * @returns the version readout plus its action.
 */
function VersionControls({ client, state, t }: {
  readonly client: OpenWikiClient
  readonly state: OpenWikiViewState
  readonly t: OpenWikiTranslate
}): React.ReactElement {
  const version = state.version
  const current = version?.current ?? ''

  return (
    <>
      {current.length > 0 ? (
        <span className="dsh-openwiki-label">{t('version.current', { version: current })}</span>
      ) : null}
      {version?.failure !== undefined ? (
        <span className="dsh-openwiki-failure">{version.failure.message}</span>
      ) : null}
      {state.checking ? (
        <span className="dsh-openwiki-label">{t('version.checking')}</span>
      ) : null}
      {state.updating ? (
        <span className="dsh-openwiki-label">{t('version.updating')}</span>
      ) : null}
      {!state.checking && !state.updating && version?.updateAvailable === true && version.latest !== undefined ? (
        <BarButton brand label={t('version.update', { version: version.latest })} onClick={() => { void client.update() }} />
      ) : null}
      {!state.checking && !state.updating && version !== undefined && !version.updateAvailable ? (
        <BarButton label={t('version.check')} onClick={() => { void client.checkUpdate() }} />
      ) : null}
    </>
  )
}

/**
 * Render the preview pane.
 * @param props - the controller and the translate function.
 * @returns the pane element.
 */
export function OpenWikiPane({ client, t }: OpenWikiPaneProps): React.ReactElement {
  const state = useOpenWikiState(client)

  React.useEffect(() => { void client.ensureLoaded() }, [client])

  const reason = blockingReason(state, t)
  const url = state.serve !== undefined && state.serve.running ? state.serve.url : undefined
  const pages = state.workspace?.pageCount
  const wikiPath = state.workspace?.wikiPath

  const dotState = state.starting
    ? 'starting'
    : url !== undefined ? 'running' : state.failure !== undefined ? 'error' : 'idle'
  const statusText = state.starting
    ? t('status.starting')
    : url !== undefined ? t('status.running') : t('status.stopped')

  return (
    <div className="dsh-openwiki-pane">
      <div className="dsh-openwiki-bar">
        <span className="dsh-openwiki-dot" data-state={dotState} />
        <span className="dsh-openwiki-label">{statusText}</span>
        {pages === undefined ? null : (
          <span className="dsh-openwiki-label">{t('wiki.pages', { count: pages })}</span>
        )}
        {wikiPath === undefined ? null : (
          <span className="dsh-openwiki-path" title={wikiPath}>{wikiPath}</span>
        )}
        <span className="dsh-openwiki-spacer" />
        <VersionControls client={client} state={state} t={t} />
        {url === undefined ? null : (
          <BarButton label={t('pane.reload')} onClick={() => { client.reload() }} />
        )}
        {url === undefined ? null : (
          <BarButton
            label={t('pane.external')}
            onClick={() => { window.open(url, '_blank', 'noopener,noreferrer') }}
          />
        )}
        {url === undefined ? null : (
          <BarButton label={t('pane.stop')} onClick={() => { void client.stop() }} />
        )}
      </div>

      {url === undefined ? (
        <div className="dsh-openwiki-empty">
          <span className="dsh-openwiki-empty-title">
            {reason ?? t('empty.startFailed')}
          </span>
          {state.failure === undefined || reason !== undefined ? null : (
            <span className="dsh-openwiki-failure">{state.failure.message}</span>
          )}
          {reason !== undefined ? null : (
            <BarButton label={t('empty.retry')} onClick={() => { void client.start() }} />
          )}
          {state.update?.reloadRequired === true ? (
            <span className="dsh-openwiki-hint">{t('version.reloadRequired')}</span>
          ) : null}
          <span className="dsh-openwiki-hint">{t('hint.offline')}</span>
        </div>
      ) : (
        <iframe
          key={state.reloadToken}
          className="dsh-openwiki-frame"
          src={url}
          title={t('tab.title')}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
        />
      )}
    </div>
  )
}
