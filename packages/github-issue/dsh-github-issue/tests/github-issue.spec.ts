import { afterEach, describe, expect, it } from 'vitest'
import type { TestHarness } from './harness.ts'
import { setupHarness } from './harness.ts'

const harnesses: TestHarness[] = []

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map(h => h.dispose()))
})

async function harness(opts?: Parameters<typeof setupHarness>[0]): Promise<TestHarness> {
  const h = await setupHarness(opts)
  harnesses.push(h)
  return h
}

describe('GithubIssueService prefilledIssueUrl', () => {
  it('builds a correct GitHub issue URL', async () => {
    const { service } = await harness()
    const result = service.prefilledIssueUrl({
      repoUrl: 'https://github.com/owner/repo',
      report: { title: 'Bug: crash on startup', body: '## Steps\n1. Start app', labels: ['bug', 'crash'] },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const url = new URL(result.value)
    expect(url.origin).toBe('https://github.com')
    expect(url.pathname).toBe('/owner/repo/issues/new')
    expect(url.searchParams.get('title')).toBe('Bug: crash on startup')
    expect(url.searchParams.get('body')).toBe('## Steps\n1. Start app')
    expect(url.searchParams.get('labels')).toBe('bug,crash')
  })

  it('rejects an invalid repo URL', async () => {
    const { service } = await harness()
    const result = service.prefilledIssueUrl({
      repoUrl: 'not-a-url',
      report: { title: 't', body: 'b', labels: [] },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('invalid-url')
  })

  it('uses the config default when repoUrl is empty', async () => {
    const { service } = await harness({ repoUrl: 'https://github.com/default/repo' })
    const result = service.prefilledIssueUrl({
      repoUrl: '',
      report: { title: 't', body: 'b', labels: [] },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const url = new URL(result.value)
    expect(url.pathname).toBe('/default/repo/issues/new')
  })
})

describe('GithubIssueService optimizeIssue', () => {
  it('rejects an empty description', async () => {
    const { service } = await harness()
    const result = await service.optimizeIssue({
      description: '   ',
      provider: 'test',
      model: 'test',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('empty-input')
  })

  it('returns a structured report from the model output', async () => {
    const { service } = await harness({
      llmText: '## \u767b\u5f55\u9875\u9762\u7a7a\u767d\n\n<details><summary>\u590d\u73b0</summary>\n\nBlank page on Firefox\n\n</details>',
    })
    const result = await service.optimizeIssue({
      description: 'login is broken on firefox',
      provider: 'test',
      model: 'test',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.title).toBe('\u767b\u5f55\u9875\u9762\u7a7a\u767d')
    expect(result.value.body).toContain('Blank page')
    expect(result.value.body).toContain('<details>')
    expect(result.value.labels).toContain('bug')
  })

  it('returns llm-failure when the model produces no output', async () => {
    const { service } = await harness({ emptyLlm: true })
    const result = await service.optimizeIssue({
      description: 'something broke',
      provider: 'test',
      model: 'test',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('llm-failure')
  })
})

describe('GithubIssueService generateReport', () => {
  it('generates a report from telemetry analysis input', async () => {
    const { service } = await harness({
      llmText: '## memo \u9065\u6d4b\u5931\u8d25\n\n<details><summary>\u8bca\u65ad\u62a5\u544a</summary>\n\nTimeout\n\n</details>',
    })
    const result = await service.generateReport({
      pluginId: 'memo',
      totalEvents: 10,
      totalFailures: 3,
      failureGroups: [
        { featureCodeRef: 'memo:analyze', count: 2, errorCode: 'LLM_FAILURE', errorMessage: 'timeout' },
        { featureCodeRef: 'memo:addEntry', count: 1, errorCode: 'FS_ERROR', errorMessage: 'disk full' },
      ],
      provider: 'test',
      model: 'test',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.title).toBe('memo \u9065\u6d4b\u5931\u8d25')
    expect(result.value.body).toContain('Timeout')
    expect(result.value.body).toContain('<details>')
    expect(result.value.labels).toContain('telemetry')
  })
})
