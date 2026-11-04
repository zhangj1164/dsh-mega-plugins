import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TestHarness } from './harness.ts'
import { setupHarness } from './harness.ts'

const harnesses: TestHarness[] = []

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map(h => h.dispose()))
  vi.unstubAllGlobals()
})

async function harness(options: Parameters<typeof setupHarness>[0] = {}): Promise<TestHarness> {
  const h = await setupHarness(options)
  harnesses.push(h)
  return h
}

/** The version this checkout's manifest declares, which the service must report. */
const MANIFEST_VERSION = (JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string }).version

/** Answer every registry request with one fixed payload and status. */
function stubRegistry(payload: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fetch = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('pluginInfo', () => {
  it('reports the local package facts without any network read', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const h = await harness()
    const result = h.ctx.memo.pluginInfo({})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.currentVersion).toBe(MANIFEST_VERSION)
    expect(result.value.packageName).toBe('@zhangj1164/dsh-memo')
    expect(result.value.registryUrl).toBe('https://registry.npmjs.org/')
    expect(result.value.profileName).toBe('web')
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('checkUpdate', () => {
  it('reports the published version, the update flag, and a copyable command', async () => {
    const fetch = stubRegistry({ 'dist-tags': { latest: '99.0.0' } })
    const h = await harness()
    const result = await h.ctx.memo.checkUpdate({})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.currentVersion).toBe(MANIFEST_VERSION)
    expect(result.value.latestVersion).toBe('99.0.0')
    expect(result.value.updateAvailable).toBe(true)
    expect(result.value.packageName).toBe('@zhangj1164/dsh-memo')
    expect(result.value.registryUrl).toBe('https://registry.npmjs.org/')
    expect(result.value.manualCommand).toBe(
      'dsh plugin --profile web add --save-exact @zhangj1164/dsh-memo@99.0.0 --registry=https://registry.npmjs.org/',
    )
    expect(result.value.checkedAt).toBeGreaterThan(0)
    const [url] = fetch.mock.calls[0] as [string]
    expect(url.startsWith('https://registry.npmjs.org/')).toBe(true)
    expect(url).toContain('dsh-memo')
  })

  it('says no update is available when the registry matches the running version', async () => {
    stubRegistry({ 'dist-tags': { latest: MANIFEST_VERSION } })
    const h = await harness()
    const result = await h.ctx.memo.checkUpdate({})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.updateAvailable).toBe(false)
  })

  it('follows the configured package, registry, and profile', async () => {
    stubRegistry({ 'dist-tags': { latest: '1.0.1' } })
    const h = await harness({
      memoConfig: {
        updatePackageName: 'my-mirror/memo',
        updateRegistryUrl: 'https://mirror.example.test/npm',
        updateProfileName: 'work profile',
      },
    })
    const result = await h.ctx.memo.checkUpdate({})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.packageName).toBe('my-mirror/memo')
    expect(result.value.registryUrl).toBe('https://mirror.example.test/npm/')
    expect(result.value.manualCommand).toBe(
      'dsh plugin --profile "work profile" add --save-exact my-mirror/memo@1.0.1 --registry=https://mirror.example.test/npm/',
    )
  })

  it('reports a refused registry instead of inventing a version', async () => {
    stubRegistry({}, 503)
    const h = await harness()
    const result = await h.ctx.memo.checkUpdate({})
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('update-check-failed')
    expect(result.error.message).toContain('503')
  })

  it('reports a network failure and records it in telemetry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('getaddrinfo ENOTFOUND') }))
    const h = await harness()
    const result = await h.ctx.memo.checkUpdate({})
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('update-check-failed')
    expect(result.error.message).toContain('ENOTFOUND')
    expect(h.telemetry.events.some(event => event.kind === 'trackError')).toBe(true)
  })
})
