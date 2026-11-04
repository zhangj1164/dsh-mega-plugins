/**
 * The update entry of the memo settings page.
 *
 * Two surfaces with different costs. The page footer carries one icon button —
 * the entry point where the Save action used to live — and nothing else happens
 * until it is pressed. Pressing it opens a dialog that reads the registry once,
 * reports the running and published versions, and offers both ways forward: the
 * deployment's own plugin-manager install, or the exact command a human can run.
 *
 * The dialog never invents an approval. Updating goes through
 * `pluginManager/installBundle`, the same path `dsh plugin add` uses, so the
 * profile lock, compatibility checks, and rollback are the platform's, not this
 * page's.
 *
 * @module @zhangj1164/dsh-client-ui-memo-settings/client/UpdateDialog
 */

import * as React from 'react'
import type { MemoKey } from './locales.ts'

/** Local facts about the running package. */
export interface MemoUpdateInfo {
  /** Version this host runs. */
  readonly currentVersion: string
  /** Package the update check asks about. */
  readonly packageName: string
  /** Registry the update check reads. */
  readonly registryUrl: string
  /** Profile the update targets. */
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

/** What one automatic update attempt reported. */
export interface MemoUpdateInstallResult {
  /** Whether the package manager accepted the install. */
  readonly ok: boolean
  /** Version it installed, when the manager reported one. */
  readonly version?: string
  /** Why it failed, when it did. */
  readonly reason?: string
}

/** Props the settings page hands the update entry. */
export interface UpdateEntryProps {
  /** Locale lookup bound to the settings dictionary. */
  readonly t: (key: MemoKey) => string
  /** Read the local running facts; resolves either the facts or a reason. */
  readonly readInfo: () => Promise<MemoUpdateInfo | { readonly error: string }>
  /** Ask the registry; resolves either the check or a reason. */
  readonly checkUpdate: () => Promise<MemoUpdateCheck | { readonly error: string }>
  /**
   * Install the checked version through the deployment's plugin manager.
   *
   * Optional: a deployment without `pluginManager` still gets the check and the
   * manual command, and the button explains why it is unavailable instead of
   * being silently absent.
   */
  readonly applyUpdate?: (check: MemoUpdateCheck) => Promise<MemoUpdateInstallResult>
  /** Copy one string to the clipboard. Injected so the dialog stays testable. */
  readonly copyText: (text: string) => Promise<void>
}

/** Render one label/value pair of the dialog's fact grid. */
function pair(label: string, value: string): React.ReactElement {
  return React.createElement('div', { className: 'dsh-memo-update-pair' },
    React.createElement('dt', null, label),
    React.createElement('dd', null, value))
}

/** The circular-arrow glyph of the update button. */
function updateGlyph(): React.ReactElement {
  return React.createElement('svg', {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  },
    React.createElement('path', { d: 'M3 12a9 9 0 0 1 15-6.7L21 8' }),
    React.createElement('path', { d: 'M21 3v5h-5' }),
    React.createElement('path', { d: 'M21 12a9 9 0 0 1-15 6.7L3 16' }),
    React.createElement('path', { d: 'M3 21v-5h5' }))
}

/** Props of {@link UpdateDialog}. */
interface UpdateDialogProps extends UpdateEntryProps {
  /** The local facts read when the page mounted; the dialog may open later. */
  readonly info: MemoUpdateInfo | null
  /** Close the dialog. */
  readonly onClose: () => void
}

/**
 * The update dialog: one registry read, both ways forward.
 * @param props - copy, the three readers, the clipboard writer, and the close action.
 * @returns the dialog.
 */
function UpdateDialog({
  t,
  info,
  readInfo,
  checkUpdate,
  applyUpdate,
  copyText,
  onClose,
}: UpdateDialogProps): React.ReactElement {
  const [checking, setChecking] = React.useState(false)
  const [checked, setChecked] = React.useState<MemoUpdateCheck | null>(null)
  const [checkError, setCheckError] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)
  const [applying, setApplying] = React.useState(false)
  const [installed, setInstalled] = React.useState<MemoUpdateInstallResult | null>(null)
  const [installError, setInstallError] = React.useState<string | null>(null)
  const [facts, setFacts] = React.useState<MemoUpdateInfo | null>(info)
  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  // The readers are held in refs so a shell that rebuilds the injected face on
  // every render cannot re-trigger the opening check.
  const checkRef = React.useRef(checkUpdate)
  checkRef.current = checkUpdate
  const readInfoRef = React.useRef(readInfo)
  readInfoRef.current = readInfo
  const applyingRef = React.useRef(false)

  /** Read the registry once and publish either the check or its reason. */
  const run = React.useCallback(async (): Promise<void> => {
    setChecking(true)
    setCheckError(null)
    const result = await checkRef.current()
    setChecking(false)
    if ('error' in result) {
      setChecked(null)
      setCheckError(result.error)
      return
    }
    setChecked(result)
    setInstalled(null)
    setInstallError(null)
  }, [])

  // Opening the dialog is the read: the entry button itself stays inert, so a
  // page visit costs nothing and a dialog that never opens costs nothing either.
  const infoAsked = React.useRef(false)
  React.useEffect(() => {
    if (infoAsked.current || facts !== null) return
    infoAsked.current = true
    void (async () => {
      const read = await readInfoRef.current()
      if (!('error' in read)) setFacts(read)
    })()
  }, [facts])

  React.useEffect(() => {
    void run()
  }, [run])

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [onClose])

  React.useEffect(() => () => {
    if (copyTimer.current !== null) clearTimeout(copyTimer.current)
  }, [])

  const copy = async (): Promise<void> => {
    if (checked === null) return
    try {
      await copyText(checked.manualCommand)
    } catch {
      // A blocked clipboard is not worth failing the dialog over: the command
      // stays on screen for manual selection.
      return
    }
    setCopied(true)
    if (copyTimer.current !== null) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => { setCopied(false) }, 2000)
  }

  const apply = async (): Promise<void> => {
    if (checked === null || applyUpdate === undefined || applyingRef.current) return
    applyingRef.current = true
    setApplying(true)
    setInstallError(null)
    setInstalled(null)
    const result = await applyUpdate(checked)
    applyingRef.current = false
    setApplying(false)
    if (!result.ok) {
      setInstallError(result.reason ?? '')
      return
    }
    setInstalled(result)
  }

  const currentVersion = checked?.currentVersion ?? facts?.currentVersion ?? ''
  const latestVersion = checked?.latestVersion ?? ''
  const profileName = facts?.profileName ?? ''
  const command = checked?.manualCommand ?? ''
  const version = (value: string): string => value.length === 0 ? '—' : `v${value}`

  const status = checked === null
    ? ''
    : checked.updateAvailable
      ? `${t('updateAvailable')}: ${version(checked.latestVersion)}`
      : t('updateUpToDate')

  return React.createElement('div', {
    className: 'dsh-memo-update-overlay',
    role: 'presentation',
    // A click on the backdrop dismisses; the dialog itself stops the bubble so a
    // click inside never closes the surface the user is reading.
    onClick: onClose,
  },
    React.createElement('div', {
      className: 'dsh-memo-update-dialog',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': t('updateTitle'),
      onClick: (event: React.MouseEvent) => { event.stopPropagation() },
    },
      React.createElement('header', { className: 'dsh-memo-update-head' },
        React.createElement('h3', { className: 'dsh-memo-update-heading' }, t('updateTitle')),
        React.createElement('button', {
          type: 'button',
          className: 'dsh-memo-update-close',
          'aria-label': t('updateClose'),
          onClick: onClose,
        }, '×')),
      React.createElement('p', { className: 'dsh-memo-update-intro' }, t('updateIntro')),

      React.createElement('dl', { className: 'dsh-memo-update-grid' },
        pair(t('updateCurrent'), version(currentVersion)),
        pair(t('updateLatest'), version(latestVersion))),

      React.createElement('p', {
        className: 'dsh-memo-update-status',
        role: 'status',
        'data-available': checked?.updateAvailable === true ? '' : undefined,
        'data-error': checkError === null ? undefined : '',
      }, checkError !== null
        ? `${t('updateFailed')}: ${checkError}`
        : checking || checked === null
          ? t('updateChecking')
          : status),

      React.createElement('dl', { className: 'dsh-memo-update-grid' },
        pair(t('updateProfile'), profileName.length === 0 ? '—' : profileName)),

      React.createElement('section', { className: 'dsh-memo-update-manual' },
        React.createElement('h4', { className: 'dsh-memo-update-manualTitle' }, t('updateManual')),
        React.createElement('p', { className: 'dsh-memo-update-manualHint' }, t('updateManualHint')),
        React.createElement('div', { className: 'dsh-memo-update-commandRow' },
          React.createElement('code', { className: 'dsh-memo-update-code' }, command.length === 0 ? '—' : command),
          React.createElement('button', {
            type: 'button',
            className: 'dsh-memo-update-button',
            disabled: command.length === 0,
            onClick: () => { void copy() },
          }, copied ? t('updateCopied') : t('updateCopy')))),

      installed === null ? null : React.createElement('p', {
        className: 'dsh-memo-update-applied',
        role: 'status',
      }, `${t('updateApplied')}: ${version(installed.version ?? latestVersion)} · ${t('updateNeedsRestart')}`),

      installError === null ? null : React.createElement('p', {
        className: 'dsh-memo-update-error',
        role: 'alert',
      }, installError.length === 0
        ? t('updateInstallFailed')
        : `${t('updateInstallFailed')}: ${installError}`),

      React.createElement('footer', { className: 'dsh-memo-update-actions' },
        React.createElement('button', {
          type: 'button',
          className: 'dsh-memo-update-button',
          disabled: checking || applying,
          onClick: () => { void run() },
        }, checking ? t('updateChecking') : t('updateRecheck')),
        React.createElement('button', {
          type: 'button',
          className: 'dsh-memo-update-button dsh-memo-update-button--primary',
          disabled: checking || applying || checked === null || !checked.updateAvailable
            || applyUpdate === undefined,
          onClick: () => { void apply() },
        }, applying ? t('updateApplying') : t('updateApply')))))
}

/**
 * The footer entry: one icon button that opens {@link UpdateDialog}.
 * @param props - copy, the readers, and the clipboard writer.
 * @returns the button plus, while open, the dialog.
 */
export function UpdateEntry(props: UpdateEntryProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [info, setInfo] = React.useState<MemoUpdateInfo | null>(null)
  // The local facts are read once, when the page mounts; keeping the reader in
  // a ref means a rebuilt injected face cannot re-run the read.
  const readInfoRef = React.useRef(props.readInfo)
  readInfoRef.current = props.readInfo

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const read = await readInfoRef.current()
      if (cancelled || 'error' in read) return
      setInfo(read)
    })()
    return () => { cancelled = true }
  }, [])

  return React.createElement(React.Fragment, null,
    React.createElement('button', {
      type: 'button',
      className: 'dsh-memo-settings-iconButton',
      'aria-label': props.t('updateCheck'),
      title: props.t('updateCheck'),
      onClick: () => { setOpen(true) },
    }, updateGlyph()),
    open
      ? React.createElement(UpdateDialog, {
          ...props,
          info,
          onClose: () => { setOpen(false) },
        })
      : null)
}
