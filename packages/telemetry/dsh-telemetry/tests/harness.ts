import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import TelemetryService from '../src/index.ts'

export interface TestHarness {
  readonly ctx: Context
  readonly root: string
  dispose(): Promise<void>
  /** Remove the context but keep the storage root for a later re-open. */
  disposeKeepRoot(): Promise<void>
}

export async function setupHarness(root?: string): Promise<TestHarness> {
  const storageRoot = root ?? await mkdtemp(join(tmpdir(), 'dsh-telemetry-test-'))
  const ctx = new Context()
  try {
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root: storageRoot })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    await ctx.plugin(TelemetryService, { maxEventsPerQuery: 500 })
  } catch (error) {
    await ctx.fiber.dispose()
    if (root === undefined) await rm(storageRoot, { recursive: true, force: true })
    throw error
  }
  const ownsRoot = root === undefined
  return {
    ctx,
    root: storageRoot,
    async dispose() {
      await ctx.fiber.dispose()
      if (ownsRoot) await rm(storageRoot, { recursive: true, force: true })
    },
    async disposeKeepRoot() {
      await ctx.fiber.dispose()
    },
  }
}
