/**
 * Browser-side data layer for the OpenWiki preview pane.
 *
 * The pane renders from a single immutable state object published here, so the
 * tab body and the Sidebar entry share one load rather than each calling the
 * host on its own. Every host call goes through {@link callRemote}, which
 * unwraps the transport envelope the RPC layer adds and reports the business
 * result the host service returned — two different questions, and the pane needs
 * both answered to say anything useful about a failure.
 *
 * @module @zhangj1164/dsh-openwiki-visualize/client/controller
 */

import type {
  OpenWikiEnvironmentReport,
  OpenWikiFailure,
  OpenWikiResult,
  OpenWikiServeStatus,
  OpenWikiUpdateReport,
  OpenWikiVersionReport,
  OpenWikiWorkspaceReport,
} from '../types.ts'

/** Transport envelope returned by `rpc.call`. */
interface TransportEnvelope<T> {
  readonly ok: boolean
  readonly value?: T
  readonly error?: OpenWikiFailure
}

/** Minimal RPC caller interface (matches `ConnectionHandle.rpc`). */
export interface RpcCaller {
  call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown>
}

/** The Remote service key this plugin's host half is reached under. */
export const SERVICE_KEY = 'openwikiVisualize'

/** The API channel every Remote call travels on. */
const API_CHANNEL = '/api'

/**
 * Call one Remote method on the preview host service.
 * @param rpc - the RPC caller from the connection service.
 * @param method - the Remote method name.
 * @param request - the request payload; every method takes one.
 * @returns the business result, never throwing — a transport failure becomes an
 * unsuccessful result so callers have one shape to branch on.
 */
export async function callRemote<T>(
  rpc: RpcCaller,
  method: string,
  request: Record<string, unknown>,
): Promise<OpenWikiResult<T>> {
  try {
    const envelope = await rpc.call(API_CHANNEL, `${SERVICE_KEY}/${method}`, { args: { request } }) as TransportEnvelope<OpenWikiResult<T>>
    if (envelope.ok && envelope.value !== undefined) return envelope.value
    return {
      ok: false,
      error: envelope.error ?? { code: 'transport-failure', message: 'unknown transport error' },
    }
  } catch (error) {
    return {
      ok: false,
      error: { code: 'rpc-failure', message: error instanceof Error ? error.message : String(error) },
    }
  }
}

/** Lifecycle of the pane's data. */
export type OpenWikiLoadStatus = 'cold' | 'loading' | 'ready' | 'error'

/** Everything the pane renders from. */
export interface OpenWikiViewState {
  /** Where the load is. */
  readonly status: OpenWikiLoadStatus
  /** Whether a registry check is in flight. */
  readonly checking: boolean
  /** Whether an update install is in flight. */
  readonly updating: boolean
  /** Whether the visualizer is being started. */
  readonly starting: boolean
  /** Bumped to make the embedded frame load again. */
  readonly reloadToken: number
  /** The openwiki and DSH environment report. */
  readonly environment?: OpenWikiEnvironmentReport
  /** What the workspace probe found. */
  readonly workspace?: OpenWikiWorkspaceReport
  /** The visualizer's state. */
  readonly serve?: OpenWikiServeStatus
  /** This plugin's version and update posture. */
  readonly version?: OpenWikiVersionReport
  /** The last update install's outcome. */
  readonly update?: OpenWikiUpdateReport
  /** The last failure worth showing the user. */
  readonly failure?: OpenWikiFailure
}

/** The state before the first host call. */
export const INITIAL_STATE: OpenWikiViewState = Object.freeze({
  status: 'cold',
  checking: false,
  updating: false,
  starting: false,
  reloadToken: 0,
})

/** The pane's data controller: one RPC-backed state store over the host service. */
export class OpenWikiClient {
  private readonly rpc: RpcCaller
  private state: OpenWikiViewState = INITIAL_STATE
  private readonly listeners = new Set<() => void>()

  /**
   * @param rpc - the RPC caller from the connection service.
   */
  constructor(rpc: RpcCaller) {
    this.rpc = rpc
  }

  /**
   * Observe state changes.
   * @param listener - called after every publish.
   * @returns unsubscribe callback.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Read the current state.
   * @returns the reference-stable snapshot.
   */
  getSnapshot(): OpenWikiViewState {
    return this.state
  }

  /** Release every listener. */
  dispose(): void {
    this.listeners.clear()
  }

  /**
   * Load once, unless a load is already under way or has succeeded.
   *
   * Both the Sidebar entry and the pane body ask for this on mount; the guard is
   * what keeps their two mounts from producing two host round trips.
   */
  async ensureLoaded(): Promise<void> {
    if (this.state.status === 'cold' || this.state.status === 'error') {
      await this.refresh()
    }
  }

  /** Probe the environment, the workspace, and the current serve state. */
  async refresh(): Promise<void> {
    this.publish({ status: 'loading' })

    const environment = await callRemote<OpenWikiEnvironmentReport>(this.rpc, 'environment', {})
    const workspace = await callRemote<OpenWikiWorkspaceReport>(this.rpc, 'workspace', {})
    const serve = await callRemote<OpenWikiServeStatus>(this.rpc, 'status', {})

    const patch: Partial<OpenWikiViewState> = {
      status: environment.ok && workspace.ok && serve.ok ? 'ready' : 'error',
    }
    if (environment.ok) patch.environment = environment.value
    if (workspace.ok) patch.workspace = workspace.value
    if (serve.ok) patch.serve = serve.value

    if (!environment.ok) patch.failure = environment.error
    else if (!workspace.ok) patch.failure = workspace.error
    else if (!serve.ok) patch.failure = serve.error

    this.publish(patch)
  }

  /**
   * Start the visualizer.
   * @returns the running status, or `undefined` when it did not come up.
   */
  async start(): Promise<OpenWikiServeStatus | undefined> {
    this.publish({ starting: true })
    const result = await callRemote<OpenWikiServeStatus>(this.rpc, 'start', {})
    if (!result.ok) {
      this.publish({ starting: false, status: 'error', failure: result.error })
      return undefined
    }
    const running = result.value.running
    const patch: Partial<OpenWikiViewState> = {
      starting: false,
      serve: result.value,
      status: running ? 'ready' : 'error',
    }
    if (!running) {
      patch.failure = result.value.failure ?? { code: 'start-failed', message: 'the visualizer did not start' }
    }
    this.publish(patch)
    return running ? result.value : undefined
  }

  /** Stop the visualizer without leaving the pane. */
  async stop(): Promise<void> {
    const result = await callRemote<OpenWikiServeStatus>(this.rpc, 'stop', {})
    if (result.ok) this.publish({ serve: result.value })
  }

  /** Make the embedded frame load again from the server. */
  reload(): void {
    this.publish({ reloadToken: this.state.reloadToken + 1 })
  }

  /** Ask the registry whether a newer version of this plugin exists. */
  async checkUpdate(): Promise<void> {
    this.publish({ checking: true })
    const result = await callRemote<OpenWikiVersionReport>(this.rpc, 'checkUpdate', {})
    if (result.ok) this.publish({ checking: false, version: result.value })
    else this.publish({ checking: false, failure: result.error })
  }

  /** Install the latest published version into this profile. */
  async update(): Promise<void> {
    this.publish({ updating: true })
    const result = await callRemote<OpenWikiUpdateReport>(this.rpc, 'update', {})
    if (result.ok) this.publish({ updating: false, update: result.value })
    else this.publish({ updating: false, failure: result.error })
  }

  /** Publish one state patch to every listener. */
  private publish(patch: Partial<OpenWikiViewState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }
}
