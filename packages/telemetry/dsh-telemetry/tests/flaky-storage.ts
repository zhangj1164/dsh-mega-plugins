/**
 * Test-only storage backend that injects the Windows rename-over-open-handle
 * failure into the first N durable writes.
 *
 * The real failure is a timing race with an antivirus or indexer, so it cannot
 * be reproduced on demand. Wrapping the JSON backend makes the retry path
 * deterministic while still exercising the real domain and unit below it.
 *
 * @module tests/flaky-storage
 */

import type { Context } from '@deepseek-ai/cordis'
import type { KvUnit, KvUnitDescriptor, StorageBackend } from '@deepseek-ai/dsh-storage'

/** Backend name the wrapping backend registers under. */
export const FLAKY_BACKEND = 'json-flaky'

/** How the wrapper should fail its first durable writes. */
export interface FlakyStorageOptions {
  /** Durable writes that fail before the first success. */
  readonly failures: number
  /** errno code carried by each injected failure; defaults to `EPERM`. */
  readonly code?: string
}

/** Counts the durable writes the wrapper has seen, failures included. */
export interface FlakyStorageProbe {
  /** Write attempts observed so far. */
  readonly attempts: number
  /**
   * Fail the next `failures` durable writes with `code` (default `EPERM`).
   * Tests use this to target a later write after earlier writes succeeded.
   * @param failures - writes to refuse before letting the next one through.
   * @param code - errno code for the injected failures.
   */
  arm(failures: number, code?: string): void
}

/**
 * Register a wrapper over the already-mounted JSON backend.
 *
 * The wrapper decorates `putRecord` only; `deleteRecord`, `loadAll`, and
 * `setGlobal` delegate unchanged. All state stays on the medium through the
 * JSON unit, so a retried write still has to survive the real publish path.
 *
 * @param ctx - the harness context, with `storage` and the `json` backend mounted.
 * @param options - how many writes to fail, and with which errno code.
 * @returns a live probe of the write attempts the wrapper observed.
 */
export function installFlakyStorage(ctx: Context, options: FlakyStorageOptions): FlakyStorageProbe {
  const inner = ctx.storage.backend.get('json')
  if (inner.kv === undefined) throw new Error('flaky-storage: the json backend exposes no kv facet')
  const state = { attempts: 0, failures: options.failures, code: options.code ?? 'EPERM' }
  const backend: StorageBackend = {
    kv: {
      async open(descriptor: KvUnitDescriptor): Promise<KvUnit> {
        const unit = await inner.kv!.open(descriptor)
        const injectFailure = (): void => {
          state.attempts += 1
          if (state.failures <= 0) return
          state.failures -= 1
          const error = new Error(`${state.code}: operation not permitted, rename`) as NodeJS.ErrnoException
          error.code = state.code
          throw error
        }
        return {
          loadAll: () => unit.loadAll(),
          putRecord: async (table, key, value) => {
            injectFailure()
            await unit.putRecord(table, key, value)
          },
          deleteRecord: async (table, key) => {
            injectFailure()
            await unit.deleteRecord(table, key)
          },
          setGlobal: value => unit.setGlobal(value),
          close: () => unit.close(),
          ...(unit.backupRecord === undefined
            ? {}
            : { backupRecord: (table: string, key: string) => unit.backupRecord!(table, key) }),
        }
      },
    },
    // The JSON backend owns the medium; the wrapper only decorates it.
    close: async () => {},
  }
  ctx.storage.backend.register(FLAKY_BACKEND, backend)
  // The domain layer activates on the lifecycle key of the backend its config
  // names, so the wrapper has to provide it before StorageDomain mounts.
  ctx.provide(`storage.backend.${FLAKY_BACKEND}`, backend)
  return Object.freeze({
    get attempts() {
      return state.attempts
    },
    arm(failures: number, code?: string): void {
      state.failures += failures
      if (code !== undefined) state.code = code
    },
  })
}
