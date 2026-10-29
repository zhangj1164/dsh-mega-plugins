import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import TelemetryService from '../src/index.ts'
import { FLAKY_BACKEND, installFlakyStorage, type FlakyStorageProbe } from './flaky-storage.ts'

/** How to make the harness's durable writes fail transiently. */
export interface SetupOptions {
  /** Durable writes that fail before the first success. */
  readonly flakyWriteFailures?: number
  /** errno code for the injected failures; defaults to `EPERM`. */
  readonly flakyWriteCode?: string
}

export interface TestHarness {
  readonly ctx: Context
  readonly root: string
  /** Probe for injected transient failures, when the harness was asked for them. */
  readonly flakyWrites?: FlakyStorageProbe
  dispose(): Promise<void>
  /** Remove the context but keep the storage root for a later re-open. */
  disposeKeepRoot(): Promise<void>
}

export async function setupHarness(
  root?: string,
  config: Record<string, unknown> = {},
  options: SetupOptions = {},
): Promise<TestHarness> {
  const storageRoot = root ?? await mkdtemp(join(tmpdir(), 'dsh-telemetry-test-'))
  const ctx = new Context()
  let flaky: FlakyStorageProbe | undefined
  try {
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root: storageRoot })
    flaky = options.flakyWriteFailures === undefined
      ? undefined
      : installFlakyStorage(ctx, {
          failures: options.flakyWriteFailures,
          ...(options.flakyWriteCode === undefined ? {} : { code: options.flakyWriteCode }),
        })
    await ctx.plugin(StorageDomain, { backend: flaky === undefined ? 'json' : FLAKY_BACKEND })
    await ctx.plugin(TelemetryService, { maxEventsPerQuery: 500, ...config })
  } catch (error) {
    await ctx.fiber.dispose()
    if (root === undefined) await rm(storageRoot, { recursive: true, force: true })
    throw error
  }
  const ownsRoot = root === undefined
  return {
    ctx,
    root: storageRoot,
    ...(flaky === undefined ? {} : { flakyWrites: flaky }),
    async dispose() {
      await ctx.fiber.dispose()
      if (ownsRoot) await rm(storageRoot, { recursive: true, force: true })
    },
    async disposeKeepRoot() {
      await ctx.fiber.dispose()
    },
  }
}
