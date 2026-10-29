/**
 * A stand-in for the Host settings form, shared by this package's tests.
 *
 * It mirrors the two behaviours the page depends on: a write either settles
 * into a new accepted snapshot (which notifies subscribers) or is refused
 * without changing anything, and the `user` layer is what marks a field
 * overridden.
 *
 * @module @zhangj1164/dsh-client-ui-memo-settings/tests/fake-form
 */

import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { MemoSettingsValues } from '../src/client/form.ts'

/** One write the model sent to the Host. */
export interface RecordedWrite {
  /** Whether the write set a value or cleared one. */
  readonly kind: 'set' | 'unset'
  /** The field written. */
  readonly field: string
  /** The value written, absent for a clear. */
  readonly value?: unknown
}

/** A Host form whose accept/refuse behaviour each test decides. */
export class FakeForm implements ConfigForm<MemoSettingsValues> {
  /** Every write received, in order. */
  readonly writes: RecordedWrite[] = []
  /** Whether the next write is accepted. */
  accept = true
  /** Snapshot subscribers. */
  readonly listeners = new Set<() => void>()
  private snapshot: ConfigFormSnapshot<MemoSettingsValues>

  /**
   * @param value - the accepted section.
   * @param user - the user layer as stored, which marks overrides.
   */
  constructor(value: MemoSettingsValues, user: unknown = {}) {
    this.snapshot = {
      status: 'ready',
      value,
      base: {},
      user,
      revision: 1,
      writable: true,
    }
  }

  /** @returns the current Host snapshot. */
  getSnapshot(): ConfigFormSnapshot<MemoSettingsValues> {
    return this.snapshot
  }

  /**
   * @param listener - the subscriber.
   * @returns the disposer.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * @param field - the field to write.
   * @param value - the value to write.
   * @returns whether the Host accepted it.
   */
  async set(field: string, value: unknown): Promise<boolean> {
    this.writes.push({ kind: 'set', field, value })
    if (!this.accept) return false
    this.commit(field, value)
    return true
  }

  /**
   * @param field - the field to clear.
   * @returns whether the Host accepted it.
   */
  async unset(field: string): Promise<boolean> {
    this.writes.push({ kind: 'unset', field })
    if (!this.accept) return false
    this.commit(field, undefined)
    return true
  }

  /**
   * @param ops - unused by the page; present for interface completeness.
   * @returns whether the Host accepted the mutation.
   */
  async mutate(ops: readonly unknown[]): Promise<boolean> {
    this.writes.push({ kind: 'set', field: String(ops.length), value: ops.length })
    return this.accept
  }

  /**
   * Replace the accepted section, as a Host write settlement would.
   * @param value - the new accepted section.
   * @param user - the new user layer.
   */
  replace(value: MemoSettingsValues, user: unknown): void {
    this.snapshot = { ...this.snapshot, value, user, revision: this.snapshot.revision + 1 }
    this.notify()
  }

  /**
   * Flip the Host document's writability.
   * @param writable - the new state.
   */
  setWritable(writable: boolean): void {
    this.snapshot = { ...this.snapshot, writable }
    this.notify()
  }

  /**
   * Move the namespace to another mirror state.
   * @param status - the new state.
   */
  setStatus(status: ConfigFormSnapshot<MemoSettingsValues>['status']): void {
    this.snapshot = { ...this.snapshot, status }
    this.notify()
  }

  /** Notify every subscriber after a snapshot replacement. */
  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }

  /**
   * Record one accepted write into the accepted section and the user layer.
   * @param field - the field written.
   * @param value - the written value, undefined for a clear.
   */
  private commit(field: string, value: unknown): void {
    const next: Record<string, unknown> = { ...this.snapshot.value }
    const user: Record<string, unknown> = { ...(this.snapshot.user as Record<string, unknown>) }
    if (value === undefined) {
      delete next[field]
      delete user[field]
    } else {
      next[field] = value
      user[field] = value
    }
    this.replace(next as MemoSettingsValues, user)
  }
}
