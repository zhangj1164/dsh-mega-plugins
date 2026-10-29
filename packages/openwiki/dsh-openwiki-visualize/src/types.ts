/**
 * Wire and view types shared by the OpenWiki preview plugin's two halves.
 *
 * This module is type-only on purpose: both halves import it, and a type-only
 * import is erased, so nothing here is duplicated into the browser bundle. Every
 * Remote method takes one `request` object and returns an
 * {@link OpenWikiResult}, which is the envelope shape the host's
 * `TypertRemoteService` and the client's RPC unwrapping already agree on.
 *
 * @module @zhangj1164/dsh-openwiki-visualize/types
 */

/** A failure a caller can branch on, carried inside a failed result. */
export interface OpenWikiFailure {
  /** Machine-readable cause, stable enough to switch on. */
  readonly code: string
  /** Human-readable explanation, already localized by the producer. */
  readonly message: string
}

/**
 * The business result every Remote method returns.
 *
 * Distinct from the transport envelope the RPC layer wraps around it: the
 * transport reports whether the call arrived, this reports whether the work
 * succeeded.
 */
export type OpenWikiResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: OpenWikiFailure }

/** What the openwiki environment check found on this machine. */
export interface OpenWikiToolInfo {
  /** Whether an `openwiki` executable could be resolved at all. */
  readonly found: boolean
  /** The version it reported, when one could be read. */
  readonly version?: string
  /** How it was located — an executable path or an installed manifest. */
  readonly source?: string
  /** Whether {@link version} satisfies the configured minimum. */
  readonly meetsMinimum: boolean
  /** The minimum this check applied. */
  readonly minimumVersion: string
  /** Why the check failed, present only when something went wrong. */
  readonly failure?: OpenWikiFailure
}

/** What the DSH version check found. */
export interface DshVersionInfo {
  /** The DSH release this host is running. */
  readonly version: string
  /** The minimum this plugin targets. */
  readonly minimumVersion: string
  /** Whether {@link version} satisfies {@link minimumVersion}. */
  readonly meetsMinimum: boolean
  /** Where the version was read from, so a wrong answer is diagnosable. */
  readonly source: string
}

/** The full environment report: openwiki, DSH, and the runtime. */
export interface OpenWikiEnvironmentReport {
  /** Whether every precondition for previewing is satisfied. */
  readonly ok: boolean
  /** The openwiki tool check. */
  readonly openwiki: OpenWikiToolInfo
  /** The DSH release check. */
  readonly dsh: DshVersionInfo
  /** Node.js version running the host, for diagnostics. */
  readonly node: string
  /** Host platform, for diagnostics. */
  readonly platform: string
}

/** Request for the workspace probe. */
export interface OpenWikiWorkspaceRequest {
  /** Workspace directory to inspect; the selected session's cwd by default. */
  readonly path?: string
}

/** What the workspace probe found. */
export interface OpenWikiWorkspaceReport {
  /** Whether an initialized wiki was found in the workspace. */
  readonly hasWiki: boolean
  /** The directory the wiki lives in, whether or not it exists. */
  readonly wikiPath: string
  /** The workspace directory that was inspected. */
  readonly workspacePath: string
  /** Which marker identified the wiki, when one did. */
  readonly marker?: string
  /** Number of renderable markdown pages found, when counted. */
  readonly pageCount?: number
}

/** Request for starting the visualizer. */
export interface OpenWikiStartRequest {
  /** Workspace directory to serve; the selected session's cwd by default. */
  readonly path?: string
  /** Preferred port; the visualizer increments past it on conflict. */
  readonly port?: number
}

/** Request for the version and update check. */
export interface OpenWikiVersionRequest {
  /** Skip the registry and report only what is already known. */
  readonly cached?: boolean
}

/** The running visualizer's status. */
export interface OpenWikiServeStatus {
  /** Whether a visualizer child is currently serving. */
  readonly running: boolean
  /** The port actually bound, once known. */
  readonly port?: number
  /** The loopback URL to embed. */
  readonly url?: string
  /** The wiki directory being served. */
  readonly wikiPath?: string
  /** Process id of the serving child, for diagnostics. */
  readonly pid?: number
  /** When the child started, as epoch milliseconds. */
  readonly startedAt?: number
  /** The last failure, present when the child stopped or never started. */
  readonly failure?: OpenWikiFailure
}

/** This plugin's own version and its update posture. */
export interface OpenWikiVersionReport {
  /** The installed version of this plugin. */
  readonly current: string
  /** The latest version the registry offers, once checked. */
  readonly latest?: string
  /** Whether {@link latest} is newer than {@link current}. */
  readonly updateAvailable: boolean
  /** When the registry was last consulted, as epoch milliseconds. */
  readonly checkedAt?: number
  /** The registry the check asked. */
  readonly registryUrl: string
  /** The package name the check asked about. */
  readonly packageName: string
  /** Why the check could not complete, present when it could not. */
  readonly failure?: OpenWikiFailure
}

/** Outcome of asking the profile to install a newer version. */
export interface OpenWikiUpdateReport {
  /** Whether the install command reported success. */
  readonly updated: boolean
  /** The command that was run, so the user can repeat it by hand. */
  readonly command: string
  /** The command's combined output, trimmed. */
  readonly output: string
  /** Whether DSH must be reloaded before the new version is live. */
  readonly reloadRequired: boolean
}
