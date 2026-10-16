/**
 * OpenWiki preview host service.
 *
 * Owns exactly two effects: probing the machine for an openwiki installation and
 * a DSH release, and supervising the `openwiki visualize` child process that
 * serves one workspace's wiki. Everything else it exposes is a decision it
 * delegates to `./environment.ts`.
 *
 * It extends `TypertRemoteService` because the browser half reaches all of it
 * through the API Gateway as `openwikiVisualize/<method>`, which is the same
 * path `@zhangj1164/dsh-memo` takes and the reason the pane can report a real
 * port instead of guessing one.
 *
 * The child is supervised, not detached: it is reaped on plugin teardown so a
 * reload never leaves a stray server holding a port, and a child that dies on
 * its own is reported through `status()` rather than thrown at a caller that had
 * nothing to do with it.
 *
 * @module @zhangj1164/dsh-openwiki-visualize
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  classifyWikiDir,
  isPortInRange,
  meetsMinimum,
  OPENWIKI_SCAFFOLD_FILES,
  parseOpenwikiVersion,
  parseVisualizePort,
  portCandidates,
  visualizeArgs,
} from './environment.ts'
import type {
  DshVersionInfo,
  OpenWikiEnvironmentReport,
  OpenWikiFailure,
  OpenWikiResult,
  OpenWikiServeStatus,
  OpenWikiStartRequest,
  OpenWikiToolInfo,
  OpenWikiUpdateReport,
  OpenWikiVersionReport,
  OpenWikiVersionRequest,
  OpenWikiWorkspaceReport,
  OpenWikiWorkspaceRequest,
} from './types.ts'

export type * from './types.ts'

export {
  classifyWikiDir,
  compareVersions,
  isPortInRange,
  MAXIMUM_PORT,
  meetsMinimum,
  MINIMUM_PORT,
  OPENWIKI_MARKERS,
  OPENWIKI_SCAFFOLD_FILES,
  parseOpenwikiVersion,
  parseVersion,
  parseVisualizePort,
  portCandidates,
  stripAnsi,
  visualizeArgs,
} from './environment.ts'
export type { ParsedVersion, WikiDetection, WikiMarker } from './environment.ts'

// ── Configuration ──────────────────────────────────────────────────────────

/**
 * Deployment configuration for the OpenWiki preview plugin.
 *
 * Every value here is something a deployment can legitimately want to differ on;
 * nothing in this plugin hardcodes a URL, port, threshold, or path. The
 * protocol constants that must NOT vary — the visualizer's fixed routes, the CLI
 * subcommand name, the scaffolding filenames — are named constants in
 * `./environment.ts` instead, because a deployment that changed one of those
 * would produce a plugin that no longer speaks to the CLI.
 */
export interface Config {
  /** Lowest openwiki version the preview will drive. */
  readonly minOpenwikiVersion: string
  /** Lowest DSH release whose right-Sidebar tab registry this plugin targets. */
  readonly minDshVersion: string
  /** Directory the wiki lives in, relative to the workspace. */
  readonly wikiDirName: string
  /** Preferred port for the visualizer; it increments past a busy one. */
  readonly defaultPort: number
  /** How many ports to consider, matching the CLI's own attempt budget. */
  readonly portAttempts: number
  /** Registry the update check asks for the latest published version. */
  readonly registryUrl: string
  /** The package this plugin updates and reports the version of. */
  readonly packageName: string
  /** Executable name or path of the openwiki CLI. */
  readonly openwikiCommand: string
  /** Executable name or path of the DSH CLI, used only for the update action. */
  readonly dshCommand: string
  /** Profile the update action installs into. */
  readonly profileName: string
  /** Package manifests consulted, in order, to learn the running DSH version. */
  readonly dshVersionPackages: readonly string[]
  /** Whether to check for a newer plugin version as soon as the plugin starts. */
  readonly updateCheckOnStart: boolean
  /** How long any single child process may run before it is killed, in ms. */
  readonly spawnTimeoutMs: number
  /** How long the registry request may take, in ms. */
  readonly registryTimeoutMs: number
  /** Workspace to inspect when the caller names none. */
  readonly defaultWorkspacePath: string
}

/** Fallback workspace package names consulted for the running DSH version. */
const DEFAULT_DSH_VERSION_PACKAGES: readonly string[] = Object.freeze([
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
])

/** Schemastery configuration for the OpenWiki preview service. */
export const Config: s<Config> = s.object({
  minOpenwikiVersion: s.string().default('0.7.2'),
  minDshVersion: s.string().default('0.1.5-rc.1'),
  wikiDirName: s.string().default('openwiki'),
  defaultPort: s.number().default(4321),
  portAttempts: s.number().default(20),
  registryUrl: s.string().default('https://registry.npmjs.org'),
  packageName: s.string().default('@zhangj1164/dsh-openwiki-visualize'),
  openwikiCommand: s.string().default('openwiki'),
  dshCommand: s.string().default('dsh'),
  profileName: s.string().default(process.env.DSH_PROFILE ?? 'web'),
  dshVersionPackages: s.array(s.string()).default([...DEFAULT_DSH_VERSION_PACKAGES]),
  updateCheckOnStart: s.boolean().default(true),
  spawnTimeoutMs: s.number().default(15_000),
  registryTimeoutMs: s.number().default(8_000),
  defaultWorkspacePath: s.string().default(''),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    openwikiVisualize: OpenWikiVisualizeService
  }
}

// ── Constants ──────────────────────────────────────────────────────────────

/** The service key this plugin registers under, and its Remote namespace. */
const SERVICE_KEY = 'openwikiVisualize'

/** The graph endpoint that proves a visualizer is answering. */
const GRAPH_PATH = '/api/graph'

/** How many directory levels the page count walks before giving up. */
const MAX_PAGE_DEPTH = 12

/** The loopback host the visualizer binds; it has no flag to change this. */
const LOOPBACK_HOST = '127.0.0.1'

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a failed result.
 * @param code - machine-readable cause.
 * @param message - human-readable explanation.
 * @returns the failed result.
 */
function failure<T>(code: string, message: string): OpenWikiResult<T> {
  return { ok: false, error: { code, message } }
}

/**
 * Build a successful result.
 * @param value - the payload.
 * @returns the successful result.
 */
function success<T>(value: T): OpenWikiResult<T> {
  return { ok: true, value }
}

/**
 * Percent-encode a package name for a registry path.
 *
 * A scoped name's slash must be encoded; leaving it raw makes the registry read
 * the scope as a path segment and answer 404 for a package that exists.
 *
 * @param name - the package name, scoped or not.
 * @returns the path segment to append to a registry base URL.
 */
function encodePackageName(name: string): string {
  return name.replace('/', '%2F')
}

/**
 * Resolve a package manifest's version through Node's own resolution.
 * @param specifier - a `package/subpath` specifier to resolve.
 * @returns the manifest's `version`, or `undefined` when unresolvable.
 */
function readResolvedVersion(specifier: string): string | undefined {
  try {
    const require = createRequire(import.meta.url)
    const path = require.resolve(specifier)
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : undefined
  } catch {
    return undefined
  }
}

/**
 * Count the renderable markdown pages under a wiki, recursively.
 *
 * Recursive because the visualizer's own graph walk is recursive, and a count
 * that only saw the top level would contradict the reader it sits next to.
 *
 * @param dir - directory to walk.
 * @param depth - remaining depth budget.
 * @returns the number of markdown files that are wiki content.
 */
function countPages(dir: string, depth: number = MAX_PAGE_DEPTH): number {
  if (depth <= 0) return 0
  let total = 0
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return 0
  }
  const scaffolding = new Set(OPENWIKI_SCAFFOLD_FILES)
  for (const name of entries) {
    const full = join(dir, name)
    if (name.endsWith('.md')) {
      if (!scaffolding.has(name)) total += 1
      continue
    }
    total += countPages(full, depth - 1)
  }
  return total
}

// ── Service ────────────────────────────────────────────────────────────────

/** The serving child's identity, once it has announced a port. */
interface ServeState {
  readonly port: number
  readonly url: string
  readonly wikiPath: string
  readonly pid?: number
  readonly startedAt: number
}

/**
 * OpenWiki preview service: environment checks, wiki detection, visualizer
 * supervision, and plugin self-update.
 */
export class OpenWikiVisualizeService extends TypertRemoteService {
  static Config = Config

  private readonly settings: Config
  private child?: ChildProcess
  private serve?: ServeState
  private lastFailure?: OpenWikiFailure
  private cachedVersion?: OpenWikiVersionReport

  /**
   * @param ctx - host context.
   * @param config - validated deployment configuration.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, SERVICE_KEY)
    this.settings = Object.freeze({ ...config })

    // The child outlives no reload: reaping it here is what keeps a plugin
    // reload from leaving a second server bound to the next port up.
    this.ctx.effect(() => () => {
      this.reap()
    }, 'openwiki-visualize: reap visualizer')

    this.ctx.effect(() => {
      if (this.settings.updateCheckOnStart) {
        void this.checkUpdate().catch(() => undefined)
      }
      return () => undefined
    }, 'openwiki-visualize: initial update check')
  }

  // ── Environment ──────────────────────────────────────────────────────────

  /**
   * Check the machine for a usable openwiki and report the running DSH release.
   * @returns the environment report, always successful — a missing openwiki is
   * a finding, not an error.
   */
  @Remote('environment')
  async environment(): Promise<OpenWikiResult<OpenWikiEnvironmentReport>> {
    const openwiki = await this.probeOpenwiki()
    const dsh = await this.readDshVersion()
    return success({
      ok: openwiki.found && openwiki.meetsMinimum && dsh.meetsMinimum,
      openwiki,
      dsh,
      node: process.version,
      platform: process.platform,
    })
  }

  // ── Workspace ────────────────────────────────────────────────────────────

  /**
   * Look for an initialized openwiki in one workspace.
   * @param request - the workspace to inspect, defaulting to the configured one.
   * @returns what was found, including a page count.
   */
  @Remote('workspace')
  async workspace(request: OpenWikiWorkspaceRequest): Promise<OpenWikiResult<OpenWikiWorkspaceReport>> {
    const workspacePath = this.resolveWorkspace(request?.path)
    const wikiPath = join(workspacePath, this.settings.wikiDirName)
    let entries: string[]
    try {
      entries = readdirSync(wikiPath)
    } catch {
      return success({ hasWiki: false, wikiPath, workspacePath })
    }
    const detection = classifyWikiDir(entries)
    if (!detection.hasWiki) return success({ hasWiki: false, wikiPath, workspacePath })
    return success({
      hasWiki: true,
      wikiPath,
      workspacePath,
      marker: detection.marker,
      pageCount: countPages(wikiPath),
    })
  }

  // ── Serve lifecycle ──────────────────────────────────────────────────────

  /**
   * Report the visualizer's current state.
   * @returns whether it is serving, and where.
   */
  @Remote('status')
  async status(): Promise<OpenWikiResult<OpenWikiServeStatus>> {
    return success(this.serveStatus())
  }

  /**
   * Start the visualizer for one workspace's wiki.
   *
   * Idempotent per wiki: asking again for the wiki already being served returns
   * the running server rather than racing a second child for the same port.
   *
   * @param request - the workspace to serve and the preferred port.
   * @returns the running server's status.
   */
  @Remote('start')
  async start(request: OpenWikiStartRequest): Promise<OpenWikiResult<OpenWikiServeStatus>> {
    const workspacePath = this.resolveWorkspace(request?.path)
    const wikiPath = join(workspacePath, this.settings.wikiDirName)

    if (this.serve !== undefined && this.serve.wikiPath === wikiPath && this.isChildAlive()) {
      return success(this.serveStatus())
    }

    this.reap()

    try {
      readdirSync(wikiPath)
    } catch {
      const message = `no openwiki at ${wikiPath}; run \`openwiki --init\` in the workspace first`
      this.lastFailure = { code: 'wiki-missing', message }
      return failure('wiki-missing', message)
    }

    const preferred = this.resolvePort(request?.port)
    try {
      const state = await this.spawnVisualizer(wikiPath, preferred)
      this.serve = state
      this.lastFailure = undefined
      return success(this.serveStatus())
    } catch (error) {
      const message = describeError(error)
      this.lastFailure = { code: 'start-failed', message }
      return failure('start-failed', message)
    }
  }

  /**
   * Stop the visualizer.
   * @returns the status after the child is gone.
   */
  @Remote('stop')
  async stop(): Promise<OpenWikiResult<OpenWikiServeStatus>> {
    this.reap()
    return success(this.serveStatus())
  }

  // ── Version and update ───────────────────────────────────────────────────

  /**
   * Report this plugin's version and its update posture.
   * @param request - `cached: true` answers from the last registry check.
   * @returns the version report.
   */
  @Remote('version')
  async version(request: OpenWikiVersionRequest): Promise<OpenWikiResult<OpenWikiVersionReport>> {
    if (request?.cached === true && this.cachedVersion !== undefined) {
      return success(this.cachedVersion)
    }
    return this.checkUpdate()
  }

  /**
   * Ask the registry whether a newer version of this plugin exists.
   * @returns the version report, with a failure recorded when the registry could
   * not be reached — an offline machine must not look like an up-to-date one.
   */
  @Remote('checkUpdate')
  async checkUpdate(): Promise<OpenWikiResult<OpenWikiVersionReport>> {
    const current = this.readOwnVersion()
    const base: OpenWikiVersionReport = {
      current,
      updateAvailable: false,
      registryUrl: this.settings.registryUrl,
      packageName: this.settings.packageName,
    }
    try {
      const latest = await this.fetchLatestVersion()
      const available = latest !== undefined && meetsMinimum(latest, current) && latest !== current
      const report: OpenWikiVersionReport = {
        ...base,
        ...(latest === undefined ? {} : { latest }),
        updateAvailable: available,
        checkedAt: Date.now(),
      }
      this.cachedVersion = report
      return success(report)
    } catch (error) {
      const report: OpenWikiVersionReport = {
        ...base,
        checkedAt: Date.now(),
        failure: { code: 'registry-unreachable', message: describeError(error) },
      }
      this.cachedVersion = report
      return success(report)
    }
  }

  /**
   * Install the latest published version into this profile.
   *
   * Deliberately an explicit, separate step: it rewrites the profile's
   * dependencies, so a check that is allowed to be automatic must not also be
   * allowed to install. The command is returned alongside the output so a user
   * can repeat it by hand.
   *
   * @returns the outcome, and whether DSH must be reloaded for it to take effect.
   */
  @Remote('update')
  async update(): Promise<OpenWikiResult<OpenWikiUpdateReport>> {
    const args = [
      'plugin',
      '--profile',
      this.settings.profileName,
      'add',
      `${this.settings.packageName}@latest`,
    ]
    const command = [this.settings.dshCommand, ...args].join(' ')
    try {
      const output = await this.runToCompletion(this.settings.dshCommand, args)
      return success({ updated: true, command, output, reloadRequired: true })
    } catch (error) {
      return success({
        updated: false,
        command,
        output: describeError(error),
        reloadRequired: false,
      })
    }
  }

  // ── Internals ────────────────────────────────────────────────────────────

  /** Resolve the workspace to act on, preferring the caller's own answer. */
  private resolveWorkspace(path: string | undefined): string {
    if (typeof path === 'string' && path.length > 0) return path
    if (this.settings.defaultWorkspacePath.length > 0) return this.settings.defaultWorkspacePath
    return process.cwd()
  }

  /** Resolve the preferred port, rejecting one the CLI would refuse. */
  private resolvePort(port: number | undefined): number {
    if (typeof port === 'number' && isPortInRange(port)) return port
    const configured = this.settings.defaultPort
    return isPortInRange(configured) ? configured : 4321
  }

  /** The status snapshot, insensitive to whether the child is still alive. */
  private serveStatus(): OpenWikiServeStatus {
    if (this.serve !== undefined && this.isChildAlive()) {
      return {
        running: true,
        port: this.serve.port,
        url: this.serve.url,
        wikiPath: this.serve.wikiPath,
        ...(this.serve.pid === undefined ? {} : { pid: this.serve.pid }),
        startedAt: this.serve.startedAt,
      }
    }
    return {
      running: false,
      ...(this.serve === undefined ? {} : { wikiPath: this.serve.wikiPath }),
      ...(this.lastFailure === undefined ? {} : { failure: this.lastFailure }),
    }
  }

  /** Whether the tracked child is still running. */
  private isChildAlive(): boolean {
    return this.child !== undefined && this.child.exitCode === null && !this.child.killed
  }

  /** Kill and forget the tracked child. */
  private reap(): void {
    const child = this.child
    this.child = undefined
    this.serve = undefined
    if (child === undefined) return
    try {
      child.kill()
    } catch {
      // A child that already exited needs no killing; nothing to report.
    }
  }

  /** Probe the openwiki CLI and its version. */
  private async probeOpenwiki(): Promise<OpenWikiToolInfo> {
    const minimumVersion = this.settings.minOpenwikiVersion
    try {
      const output = await this.runToCompletion(this.settings.openwikiCommand, ['--help'], true)
      const version = parseOpenwikiVersion(output)
      if (version === undefined) {
        return {
          found: true,
          meetsMinimum: false,
          minimumVersion,
          source: this.settings.openwikiCommand,
          failure: {
            code: 'version-unreadable',
            message: 'openwiki answered but printed no version in its banner',
          },
        }
      }
      return {
        found: true,
        version,
        meetsMinimum: meetsMinimum(version, minimumVersion),
        minimumVersion,
        source: this.settings.openwikiCommand,
      }
    } catch (error) {
      const message = describeError(error)
      return {
        found: false,
        meetsMinimum: false,
        minimumVersion,
        source: this.settings.openwikiCommand,
        failure: {
          code: /ENOENT/u.test(message) ? 'openwiki-not-installed' : 'openwiki-probe-failed',
          message,
        },
      }
    }
  }

  /** Learn the running DSH release from an installed manifest. */
  private async readDshVersion(): Promise<DshVersionInfo> {
    const minimumVersion = this.settings.minDshVersion
    for (const packageName of this.settings.dshVersionPackages) {
      const version = readResolvedVersion(`${packageName}/package.json`)
      if (version !== undefined) {
        return {
          version,
          minimumVersion,
          meetsMinimum: meetsMinimum(version, minimumVersion),
          source: packageName,
        }
      }
    }
    try {
      const output = await this.runToCompletion(this.settings.dshCommand, ['--version'])
      const version = output.trim().split(/\s+/u)[0] ?? ''
      return {
        version,
        minimumVersion,
        meetsMinimum: meetsMinimum(version, minimumVersion),
        source: this.settings.dshCommand,
      }
    } catch (error) {
      return {
        version: 'unknown',
        minimumVersion,
        meetsMinimum: false,
        source: describeError(error),
      }
    }
  }

  /** Read this plugin's own installed version from the manifest beside the build. */
  private readOwnVersion(): string {
    try {
      const path = fileURLToPath(new URL('../package.json', import.meta.url))
      const manifest = JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown }
      return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
    } catch {
      return '0.0.0'
    }
  }

  /** Ask the registry for the latest published version of this package. */
  private async fetchLatestVersion(): Promise<string | undefined> {
    const url = `${this.settings.registryUrl.replace(/\/+$/u, '')}/${encodePackageName(this.settings.packageName)}`
    const response = await fetch(url, {
      signal: AbortSignal.timeout(this.settings.registryTimeoutMs),
      headers: { accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`registry answered ${response.status}`)
    const body = await response.json() as { 'dist-tags'?: { latest?: unknown } }
    const latest = body['dist-tags']?.latest
    return typeof latest === 'string' ? latest : undefined
  }

  /**
   * Spawn the visualizer and wait until it announces the port it bound.
   *
   * The port is read from the banner because the CLI increments past a busy
   * port, so the requested port is a preference rather than a promise. When the
   * banner never arrives the candidate range is probed instead, which is the
   * only remaining way to find a server that is in fact answering.
   */
  private async spawnVisualizer(wikiPath: string, preferred: number): Promise<ServeState> {
    const args = visualizeArgs(wikiPath, preferred)
    const child = spawn(this.settings.openwikiCommand, [...args], {
      cwd: wikiPath,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.child = child

    const startedAt = Date.now()
    const port = await this.awaitPort(child)
    if (port === undefined) {
      throw new Error(
        `${this.settings.openwikiCommand} ${args.join(' ')} did not report a port within `
        + `${this.settings.spawnTimeoutMs}ms`,
      )
    }

    // A child that dies immediately after announcing a port is not a server, so
    // liveness is confirmed before the pane is told to embed it.
    await this.confirmServing(port)

    return {
      port,
      url: `http://${LOOPBACK_HOST}:${port}`,
      wikiPath,
      ...(child.pid === undefined ? {} : { pid: child.pid }),
      startedAt,
    }
  }

  /** Wait for the bound port from the child's banner, or probe for it. */
  private awaitPort(child: ChildProcess): Promise<number | undefined> {
    return new Promise<number | undefined>((resolve) => {
      let buffer = ''
      let settled = false

      const finish = (port: number | undefined): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        child.stdout?.off('data', onData)
        child.off('exit', onExit)
        child.off('error', onError)
        resolve(port)
      }

      const onData = (chunk: Buffer | string): void => {
        buffer += chunk.toString()
        const port = parseVisualizePort(buffer)
        if (port !== undefined) finish(port)
      }

      const onExit = (): void => { void probeFallback().then(finish) }
      const onError = (): void => { void probeFallback().then(finish) }

      const probeFallback = async (): Promise<number | undefined> => {
        for (const candidate of portCandidates(this.settings.defaultPort, this.settings.portAttempts)) {
          if (await this.probePort(candidate)) return candidate
        }
        return undefined
      }

      const timer = setTimeout(() => { void probeFallback().then(finish) }, this.settings.spawnTimeoutMs)

      child.stdout?.on('data', onData)
      child.once('exit', onExit)
      child.once('error', onError)
    })
  }

  /** Whether a visualizer is answering on one port right now. */
  private async probePort(port: number): Promise<boolean> {
    try {
      const response = await fetch(`http://${LOOPBACK_HOST}:${port}${GRAPH_PATH}`, {
        signal: AbortSignal.timeout(this.settings.registryTimeoutMs),
      })
      return response.ok
    } catch {
      return false
    }
  }

  /** Confirm the announced port answers, retrying briefly while it boots. */
  private async confirmServing(port: number): Promise<void> {
    if (await this.probePort(port)) return
    await new Promise(resolve => setTimeout(resolve, 250))
    if (await this.probePort(port)) return
    throw new Error(`the visualizer on ${LOOPBACK_HOST}:${port} is not answering`)
  }

  /**
   * Run a command to completion and return its combined output.
   *
   * `tolerateFailure` exists for `openwiki --help`, which prints the banner this
   * plugin needs and then exits non-zero when stdout is not a TTY. That exit
   * code is not a failure of the command this plugin is asking about.
   */
  private runToCompletion(command: string, args: readonly string[], tolerateFailure = false): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const child = spawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''
      let settled = false

      const finish = (error: Error | undefined): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error === undefined) resolve(output)
        else reject(error)
      }

      const timer = setTimeout(() => {
        try {
          child.kill()
        } catch {
          // Already gone; the timeout is what is being reported.
        }
        finish(new Error(`${command} timed out after ${this.settings.spawnTimeoutMs}ms`))
      }, this.settings.spawnTimeoutMs)

      child.stdout?.on('data', (chunk: Buffer | string) => { output += chunk.toString() })
      child.stderr?.on('data', (chunk: Buffer | string) => { output += chunk.toString() })
      child.once('error', (error: Error) => finish(error))
      child.once('exit', (code: number | null) => {
        if (code === 0 || tolerateFailure) finish(undefined)
        else finish(new Error(`${command} exited with code ${String(code)}: ${output.trim()}`))
      })
    })
  }
}

/**
 * Describe an unknown thrown value as text.
 * @param error - the caught value.
 * @returns a message safe to show a user.
 */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export default OpenWikiVisualizeService
