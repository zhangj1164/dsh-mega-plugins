import { describe, expect, it } from 'vitest'
import { callRemote, OpenWikiClient, SERVICE_KEY, type RpcCaller } from '../src/client/controller.ts'
import type { OpenWikiResult, OpenWikiServeStatus } from '../src/types.ts'

/** One recorded RPC call. */
interface Call {
  readonly channel: string
  readonly endpoint: string
  readonly payload: unknown
}

/**
 * A fake RPC caller that answers from a table of endpoint to business result.
 *
 * `payload` is captured so the tests can prove a Remote method's single argument
 * really travels as `{ args: { request } }`, which is the wire shape the host's
 * generated gateway expects.
 */
function createFakeRpc(table: Record<string, OpenWikiResult<unknown>>): {
  readonly rpc: RpcCaller
  readonly calls: Call[]
} {
  const calls: Call[] = []
  const rpc: RpcCaller = {
    async call(channel: string, endpoint: string, payload: unknown): Promise<unknown> {
      calls.push({ channel, endpoint, payload })
      const answer = table[endpoint]
      if (answer === undefined) {
        return { ok: false, error: { code: 'not-found', message: `no fake for ${endpoint}` } }
      }
      return { ok: true, value: answer }
    },
  }
  return { rpc, calls }
}

/** A run status a fake start can answer with. */
function runningStatus(port = 4321): OpenWikiServeStatus {
  return { running: true, port, url: `http://127.0.0.1:${port}` }
}

describe('callRemote', () => {
  it('addresses the host service on the api channel with a request argument', async () => {
    const { rpc, calls } = createFakeRpc({ [`${SERVICE_KEY}/status`]: { ok: true, value: runningStatus() } })
    const result = await callRemote<OpenWikiServeStatus>(rpc, 'status', {})
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.channel).toBe('/api')
    expect(calls[0]?.endpoint).toBe(`${SERVICE_KEY}/status`)
    expect(calls[0]?.payload).toEqual({ args: { request: {} } })
  })

  it('reports a transport failure as an unsuccessful result rather than throwing', async () => {
    const rpc: RpcCaller = {
      call: async () => { throw new Error('socket closed') },
    }
    const result = await callRemote<OpenWikiServeStatus>(rpc, 'status', {})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('rpc-failure')
  })

  it('surfaces the transport envelope\u2019s own error when the call did not arrive', async () => {
    const rpc: RpcCaller = {
      call: async () => ({ ok: false, error: { code: 'untrusted', message: 'peer rejected' } }),
    }
    const result = await callRemote<OpenWikiServeStatus>(rpc, 'status', {})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('untrusted')
  })
})

describe('OpenWikiClient refresh', () => {
  it('loads the environment, the workspace, and the serve state together', async () => {
    const { rpc } = createFakeRpc({
      [`${SERVICE_KEY}/environment`]: { ok: true, value: { ok: true, node: 'v24.0.0', platform: 'win32' } },
      [`${SERVICE_KEY}/workspace`]: { ok: true, value: { hasWiki: true, wikiPath: '/repo/openwiki', workspacePath: '/repo', pageCount: 12 } },
      [`${SERVICE_KEY}/status`]: { ok: true, value: { running: false } },
    })
    const client = new OpenWikiClient(rpc)
    await client.refresh()

    const state = client.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.workspace?.pageCount).toBe(12)
    expect(state.serve?.running).toBe(false)
  })

  it('records the first failed call and marks the load an error', async () => {
    const { rpc } = createFakeRpc({
      [`${SERVICE_KEY}/environment`]: { ok: false, error: { code: 'probe-failed', message: 'boom' } },
      [`${SERVICE_KEY}/workspace`]: { ok: true, value: { hasWiki: false, wikiPath: '/w', workspacePath: '/w' } },
      [`${SERVICE_KEY}/status`]: { ok: true, value: { running: false } },
    })
    const client = new OpenWikiClient(rpc)
    await client.refresh()

    const state = client.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.failure?.code).toBe('probe-failed')
  })

  it('notifies every subscriber on each publish', async () => {
    const { rpc } = createFakeRpc({
      [`${SERVICE_KEY}/environment`]: { ok: true, value: { ok: true, node: 'v24', platform: 'win32' } },
      [`${SERVICE_KEY}/workspace`]: { ok: true, value: { hasWiki: true, wikiPath: '/w/openwiki', workspacePath: '/w' } },
      [`${SERVICE_KEY}/status`]: { ok: true, value: { running: false } },
    })
    const client = new OpenWikiClient(rpc)
    let ticks = 0
    const stop = client.subscribe(() => { ticks += 1 })
    await client.refresh()
    stop()
    // loading, then ready
    expect(ticks).toBe(2)
    await client.refresh()
    expect(ticks).toBe(2)
  })
})

describe('OpenWikiClient start', () => {
  it('returns the running status and keeps it', async () => {
    const { rpc } = createFakeRpc({ [`${SERVICE_KEY}/start`]: { ok: true, value: runningStatus(4400) } })
    const client = new OpenWikiClient(rpc)
    const status = await client.start()
    expect(status?.port).toBe(4400)
    expect(client.getSnapshot().serve?.url).toBe('http://127.0.0.1:4400')
    expect(client.getSnapshot().status).toBe('ready')
  })

  it('reports a start that came back not running', async () => {
    const { rpc } = createFakeRpc({
      [`${SERVICE_KEY}/start`]: {
        ok: true,
        value: { running: false, failure: { code: 'wiki-missing', message: 'no wiki' } },
      },
    })
    const client = new OpenWikiClient(rpc)
    const status = await client.start()
    expect(status).toBeUndefined()
    expect(client.getSnapshot().status).toBe('error')
    expect(client.getSnapshot().failure?.code).toBe('wiki-missing')
  })

  it('reports a start refused by the host', async () => {
    const { rpc } = createFakeRpc({
      [`${SERVICE_KEY}/start`]: { ok: false, error: { code: 'start-failed', message: 'no executable' } },
    })
    const client = new OpenWikiClient(rpc)
    expect(await client.start()).toBeUndefined()
    expect(client.getSnapshot().failure?.code).toBe('start-failed')
  })
})

describe('OpenWikiClient reload', () => {
  it('bumps a token the frame is keyed on', () => {
    const { rpc } = createFakeRpc({})
    const client = new OpenWikiClient(rpc)
    expect(client.getSnapshot().reloadToken).toBe(0)
    client.reload()
    client.reload()
    expect(client.getSnapshot().reloadToken).toBe(2)
  })
})

describe('OpenWikiClient version and update', () => {
  it('records an available update', async () => {
    const { rpc } = createFakeRpc({
      [`${SERVICE_KEY}/checkUpdate`]: {
        ok: true,
        value: { current: '0.1.0', latest: '0.2.0', updateAvailable: true, registryUrl: 'https://r', packageName: 'p' },
      },
    })
    const client = new OpenWikiClient(rpc)
    await client.checkUpdate()
    expect(client.getSnapshot().version?.latest).toBe('0.2.0')
    expect(client.getSnapshot().checking).toBe(false)
  })

  it('keeps an unreachable registry as data, not a thrown error', async () => {
    const { rpc } = createFakeRpc({
      [`${SERVICE_KEY}/checkUpdate`]: {
        ok: true,
        value: {
          current: '0.1.0',
          updateAvailable: false,
          registryUrl: 'https://r',
          packageName: 'p',
          failure: { code: 'registry-unreachable', message: 'offline' },
        },
      },
    })
    const client = new OpenWikiClient(rpc)
    await client.checkUpdate()
    expect(client.getSnapshot().version?.failure?.code).toBe('registry-unreachable')
  })

  it('reports the update outcome and its reload requirement', async () => {
    const { rpc } = createFakeRpc({
      [`${SERVICE_KEY}/update`]: {
        ok: true,
        value: { updated: true, command: 'dsh plugin add p@latest', output: 'done', reloadRequired: true },
      },
    })
    const client = new OpenWikiClient(rpc)
    await client.update()
    expect(client.getSnapshot().update?.reloadRequired).toBe(true)
    expect(client.getSnapshot().updating).toBe(false)
  })
})

describe('OpenWikiClient ensureLoaded', () => {
  it('loads once and then leaves the state alone', async () => {
    const { rpc, calls } = createFakeRpc({
      [`${SERVICE_KEY}/environment`]: { ok: true, value: { ok: true, node: 'v24', platform: 'win32' } },
      [`${SERVICE_KEY}/workspace`]: { ok: true, value: { hasWiki: true, wikiPath: '/w/openwiki', workspacePath: '/w' } },
      [`${SERVICE_KEY}/status`]: { ok: true, value: { running: false } },
    })
    const client = new OpenWikiClient(rpc)
    await client.ensureLoaded()
    await client.ensureLoaded()
    expect(calls).toHaveLength(3)
  })
})
