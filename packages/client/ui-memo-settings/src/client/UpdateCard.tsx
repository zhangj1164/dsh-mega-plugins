/**
 * Version and update card for the memo settings page.
 *
 * Two reads with different costs: the running version is local and loads on
 * mount, while the registry lookup runs only when the user asks. The card never
 * installs anything — a panel click happens between turns, where no approval can
 * be requested — so a newer version is reported together with the exact command
 * a human can run.
 *
 * @module @zhangj1164/dsh-client-ui-memo-settings/client/UpdateCard
 */

import * as React from 'react'
import type { MemoKey } from './locales.ts'

/** Local facts about the running memo package. */
export interface MemoUpdateInfo {
  /** Version this host runs. */
  readonly currentVersion: string
  /** Package the update check asks about. */
  readonly packageName: string
  /** Registry the update check reads. */
  readonly registryUrl: string
  /** Profile the manual command targets. */
  readonly profileName: string
}

/** One successful registry check. */
export interface MemoUpdateCheck {
  /** Version this host runs. */
  readonly currentVersion: string
  /** Latest published version. */
  readonly latestVersion: string
  /** Whether the published version is newer. */
  readonly updateAvailable: boolean
  /** Package that was checked. */
  readonly packageName: string
  /** Registry that was read. */
  readonly registryUrl: string
  /** Exact command that installs the published version. */
  readonly manualCommand: string
  /** Epoch milliseconds of the check. */
  readonly checkedAt: number
}

/** Props the settings page hands the card. */
export interface UpdateCardProps {
  /** Locale lookup bound to the settings dictionary. */
  readonly t: (key: MemoKey) => string
  /** Read the local running facts; resolves either the facts or a reason. */
  readonly readInfo: () => Promise<MemoUpdateInfo | { readonly error: string }>
  /** Ask the registry; resolves either the check or a reason. */
  readonly checkUpdate: () => Promise<MemoUpdateCheck | { readonly error: string }>
  /** Copy one string to the clipboard. Injected so the card stays testable. */
  readonly copyText: (text: string) => Promise<void>
}

/**
 * Render the version and update card.
 * @param props - copy, the two readers, and the clipboard writer.
 * @returns the card.
 */
export function UpdateCard({ t, readInfo, checkUpdate, copyText }: UpdateCardProps): React.ReactElement {
  const [info, setInfo] = React.useState<MemoUpdateInfo | null>(null)
  const [checked, setChecked] = React.useState<MemoUpdateCheck | null>(null)
  const [checking, setChecking] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)
  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  // The card loads its local facts once. Keeping the reader in a ref means a
  // shell that rebuilds the injected face on every render cannot re-trigger it.
  const readInfoRef = React.useRef(readInfo)
  readInfoRef.current = readInfo

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const read = await readInfoRef.current()
      if (cancelled || 'error' in read) return
      setInfo(read)
    })()
    return () => { cancelled = true }
  }, [])

  // A confirmation belongs to one copy, not to the page: clearing the timer is
  // what keeps a closed page from writing state after unmount.
  React.useEffect(() => () => {
    if (copyTimer.current !== null) clearTimeout(copyTimer.current)
  }, [])

  const run = async (): Promise<void> => {
    if (checking) return
    setChecking(true)
    setError(null)
    setCopied(false)
    const result = await checkUpdate()
    setChecking(false)
    if ('error' in result) {
      setChecked(null)
      setError(result.error)
      return
    }
    setChecked(result)
    setInfo(current => current ?? {
      currentVersion: result.currentVersion,
      packageName: result.packageName,
      registryUrl: result.registryUrl,
      profileName: '',
    })
  }

  const copy = async (): Promise<void> => {
    if (checked === null) return
    try {
      await copyText(checked.manualCommand)
    } catch {
      // A blocked clipboard is not worth failing the card over: the command
      // stays on screen for manual selection.
      return
    }
    setCopied(true)
    if (copyTimer.current !== null) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => { setCopied(false) }, 2000)
  }

  const current = checked?.currentVersion ?? info?.currentVersion ?? '—'
  const latest = checked?.latestVersion ?? '—'

  return (
    <section className="dsh-memo-settings-group dsh-memo-update">
      <h3 className="dsh-memo-settings-groupTitle">{t('updateGroup')}</h3>
      <p className="dsh-memo-settings-hint">{t('updateHint')}</p>

      <dl className="dsh-memo-update-grid">
        <div className="dsh-memo-update-pair">
          <dt>{t('updateCurrent')}</dt>
          <dd>{current}</dd>
        </div>
        <div className="dsh-memo-update-pair">
          <dt>{t('updateLatest')}</dt>
          <dd>{latest}</dd>
        </div>
      </dl>

      <div className="dsh-memo-update-actions">
        <button
          type="button"
          className="dsh-memo-settings-save"
          disabled={checking}
          onClick={() => { void run() }}
        >
          {checking ? t('updateChecking') : t('updateCheck')}
        </button>
        {checked === null ? null : (
          <span className="dsh-memo-update-state" data-available={checked.updateAvailable ? '' : undefined} role="status">
            {checked.updateAvailable ? t('updateAvailable') : t('updateUpToDate')}
          </span>
        )}
      </div>

      {checked !== null && checked.updateAvailable ? (
        <div className="dsh-memo-update-command">
          <span className="dsh-memo-update-commandLabel">{t('updateCommand')}</span>
          <div className="dsh-memo-update-commandRow">
            <code className="dsh-memo-update-code">{checked.manualCommand}</code>
            <button type="button" className="dsh-memo-settings-reset" onClick={() => { void copy() }}>
              {copied ? t('updateCopied') : t('updateCopy')}
            </button>
          </div>
        </div>
      ) : null}

      {error === null ? null : (
        <p className="dsh-memo-update-error" role="alert">
          {`${t('updateFailed')}: ${error}`}
        </p>
      )}
    </section>
  )
}
