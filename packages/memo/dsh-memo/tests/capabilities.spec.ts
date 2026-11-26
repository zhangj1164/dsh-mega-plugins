import { describe, expect, it } from 'vitest'
import type { MemoService } from '../src/index.ts'
import { setupHarness } from './harness.ts'

/**
 * The memo bundle must boot without the telemetry and github-issue bundles.
 *
 * Those two services used to be `inject` dependencies, so installing the memo
 * bundle alone left it pending — no service, no board, and a boot warning that
 * named a service the user never asked for. They are optional now: the memo
 * service activates with the storage domain alone, and `capabilities` is what
 * tells the board which features this deployment can actually run.
 */
describe('optional capabilities', () => {
  it('activates when only the storage domain is mounted', async () => {
    const harness = await setupHarness({ withoutOptionalServices: true })
    try {
      // The service is what a pending entry never provides: this read would
      // throw on an entry that failed to activate.
      const weeks = harness.ctx.memo.listWeeks({})
      expect(weeks.ok).toBe(true)
    } finally {
      await harness.dispose()
    }
  })

  it('reports both services as unavailable', async () => {
    const harness = await setupHarness({ withoutOptionalServices: true })
    try {
      const result = (harness.ctx.memo as MemoService).capabilities({})
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.telemetry.available).toBe(false)
      expect(result.value.githubIssue.available).toBe(false)
      expect(result.value.telemetry.packageName).toBe('@zhangj1164/dsh-telemetry')
      expect(result.value.githubIssue.packageName).toBe('@zhangj1164/dsh-github-issue')
    } finally {
      await harness.dispose()
    }
  })

  it('names the install command for the configured profile', async () => {
    const harness = await setupHarness({
      withoutOptionalServices: true,
      memoConfig: { updateProfileName: 'desk' },
    })
    try {
      const result = (harness.ctx.memo as MemoService).capabilities({})
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.telemetry.installCommand)
        .toBe('dsh plugin --profile desk add @zhangj1164/dsh-telemetry')
      expect(result.value.githubIssue.installCommand)
        .toBe('dsh plugin --profile desk add @zhangj1164/dsh-github-issue')
    } finally {
      await harness.dispose()
    }
  })

  it('reports both services as available when they are mounted', async () => {
    const harness = await setupHarness()
    try {
      const result = (harness.ctx.memo as MemoService).capabilities({})
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.telemetry.available).toBe(true)
      expect(result.value.githubIssue.available).toBe(true)
    } finally {
      await harness.dispose()
    }
  })
})
