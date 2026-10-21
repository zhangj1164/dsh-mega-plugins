import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type { SetupOptions, TestHarness } from './harness.ts'
import { setupHarness } from './harness.ts'

const READ_PATH = 'C:/outside/secret.txt'

/** The step a stub `fs` failure throws at. */
type StubStep = 'resolve' | 'readText'

/**
 * How the stub `fs` service answers one `readExternalPath` call: read the text,
 * or throw at one of the two steps the method performs.
 */
type StubAnswer =
  | { readonly kind: 'text'; readonly text: string }
  | {
    readonly kind: 'throw'
    /** Which step throws: the path resolution or the read itself. */
    readonly at: StubStep
    /** The DSH `FsErrorCode` the thrown error carries, when it carries one. */
    readonly code?: string
  }

/**
 * Stub of the host `fs` service. `readExternalPath` uses only `resolve` and
 * `readText`, and the error it throws carries the DSH `FsErrorCode` a real
 * backend would raise, so the failure dispatch is exercised without a backend.
 */
class StubFs extends Service {
  /** Every target handed to `readText`, so a test can prove the read happened. */
  readonly reads: string[] = []
  private readonly answer: StubAnswer

  constructor(ctx: Context, answer: StubAnswer) {
    super(ctx, 'fs')
    this.answer = answer
  }

  /**
   * Resolve a requested path into the stub's opaque target.
   * @param path - the path as the caller asked for it.
   * @returns the target the read step receives.
   */
  async resolve(path: string): Promise<string> {
    if (this.throwingAt('resolve')) throw this.failure()
    return `target:${path}`
  }

  /**
   * Read one stub target.
   * @param target - the target `resolve` produced.
   * @returns the configured text.
   */
  async readText(target: string): Promise<string> {
    if (this.throwingAt('readText')) throw this.failure()
    this.reads.push(target)
    return this.answer.kind === 'text' ? this.answer.text : ''
  }

  /**
   * Whether the configured failure throws at this step.
   * @param step - the step being asked about.
   * @returns true when the stub is set to throw here.
   */
  private throwingAt(step: StubStep): boolean {
    return this.answer.kind === 'throw' && this.answer.at === step
  }

  /** Build the error the configured failure throws, carrying a DSH code when asked. */
  private failure(): Error & { readonly code?: string } {
    const error = new Error('stub filesystem failure') as Error & { code?: string }
    if (this.answer.kind === 'throw' && this.answer.code !== undefined) error.code = this.answer.code
    return error
  }
}

const harnesses: TestHarness[] = []

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map(h => h.dispose()))
})

/** Mount the service under test, with no `fs` service by default. */
async function harness(options: SetupOptions = {}): Promise<TestHarness> {
  const h = await setupHarness(options)
  harnesses.push(h)
  return h
}

/** Mount a stub `fs` answering with one fixed behaviour and return it. */
async function mountFs(h: TestHarness, answer: StubAnswer): Promise<StubFs> {
  await h.ctx.plugin(StubFs, answer)
  return h.ctx.get('fs') as StubFs
}

describe('MemoService readExternalPath', () => {
  it('returns the file text and adds no entry to any week', async () => {
    const h = await harness()
    const fs = await mountFs(h, { kind: 'text', text: 'OUTSIDE-SECRET-CONTENT' })
    const week = await h.ctx.memo.getOrCreateCurrentWeek({})
    if (!week.ok) throw new Error('the harness could not create the current week')
    const weeksBefore = h.ctx.memo.listWeeks({})

    const result = await h.ctx.memo.readExternalPath({ path: READ_PATH })

    expect(result).toEqual({ ok: true, value: 'OUTSIDE-SECRET-CONTENT' })
    // The README used to document this method as "adds it as an entry". It never
    // did, so this assertion is the contract: reading a path must not mutate the
    // memo store — not the current week, and not any other one.
    const weeksAfter = h.ctx.memo.listWeeks({})
    expect(weeksAfter).toEqual(weeksBefore)
    if (!weeksAfter.ok) return
    expect(weeksAfter.value).toHaveLength(1)
    expect(weeksAfter.value[0]?.entries).toHaveLength(0)
    expect(fs.reads).toEqual([`target:${READ_PATH}`])
  })

  it('reports fs-unavailable when the deployment mounts no fs service', async () => {
    const h = await harness()

    const result = await h.ctx.memo.readExternalPath({ path: READ_PATH })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('fs-unavailable')
    expect(result.error).toHaveProperty('path', READ_PATH)
  })

  it.each([
    ['FS_NOT_FOUND', 'resolve', 'path-not-found'],
    ['FS_NOT_TEXT', 'readText', 'path-not-text'],
    ['FS_NOT_REGULAR_FILE', 'readText', 'path-not-text'],
    ['FS_TOO_LARGE', 'readText', 'path-too-large'],
    ['FS_PERMISSION_DENIED', 'resolve', 'approval-denied'],
    ['FS_SANDBOX_DENIED', 'resolve', 'approval-denied'],
    ['FS_IO_ERROR', 'readText', 'fs-error'],
    // A deployment can mount a thin node:fs wrapper instead of the DSH backend;
    // its errno names the same causes and must not degrade to fs-error.
    ['ENOENT', 'resolve', 'path-not-found'],
    ['EACCES', 'readText', 'approval-denied'],
  ] as const)('reports %s raised at %s as %s rather than one blanket approval failure', async (fsCode, at, expected) => {
    const h = await harness()
    await mountFs(h, { kind: 'throw', at, code: fsCode })

    const result = await h.ctx.memo.readExternalPath({ path: READ_PATH })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe(expected)
    expect(result.error).toHaveProperty('path', READ_PATH)
    expect(result.error.message).toContain(READ_PATH)
  })

  it('reports fs-error for a failure that carries no filesystem code', async () => {
    const h = await harness()
    await mountFs(h, { kind: 'throw', at: 'readText' })

    const result = await h.ctx.memo.readExternalPath({ path: READ_PATH })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('fs-error')
  })

  it('records the same code in telemetry as it returns to the caller', async () => {
    const h = await harness()
    await mountFs(h, { kind: 'throw', at: 'resolve', code: 'FS_NOT_FOUND' })

    const result = await h.ctx.memo.readExternalPath({ path: READ_PATH })

    expect(result.ok).toBe(false)
    if (result.ok) return
    const failures = h.telemetry.events.filter(event => event.kind === 'trackError')
    expect(failures).toHaveLength(1)
    expect(failures[0].input).toMatchObject({
      pluginId: 'memo',
      action: 'readExternalPath',
      error: { code: 'path-not-found', featureCodeRef: 'memo:readExternalPath' },
    })
  })
})
