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

  it('shortens the body so the URL stays within the configured budget', async () => {
    const note = '\n\n[truncated]'
    const { service } = await harness({ maxPrefillUrlLength: 400, prefillTruncationNote: note })
    const body = 'x'.repeat(2000)
    const result = service.prefilledIssueUrl({
      repoUrl: 'https://github.com/owner/repo',
      report: { title: 't', body, labels: ['bug'] },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.length).toBeLessThanOrEqual(400)
    const sent = new URL(result.value).searchParams.get('body') ?? ''
    expect(sent.endsWith(note)).toBe(true)
    // What survives must be a real prefix of the report, not scrambled text.
    expect(body.startsWith(sent.slice(0, -note.length))).toBe(true)
    expect(sent.length).toBeLessThan(body.length)
  })

  it('spends the same budget on the title and labels as on the body', async () => {
    // A body-only rule would allow a 400-character body here and still emit a
    // URL well past the limit, which is the failure this guards.
    const { service } = await harness({ maxPrefillUrlLength: 400, prefillTruncationNote: '[cut]' })
    const result = service.prefilledIssueUrl({
      repoUrl: 'https://github.com/owner/repo',
      report: { title: 'T'.repeat(80), body: 'x'.repeat(2000), labels: ['L'.repeat(40)] },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.length).toBeLessThanOrEqual(400)
    const url = new URL(result.value)
    expect(url.searchParams.get('title')).toBe('T'.repeat(80))
    expect(url.searchParams.get('labels')).toBe('L'.repeat(40))
  })

  it('reduces the body to the note when the title alone exceeds the budget', async () => {
    const note = '[cut]'
    const { service } = await harness({ maxPrefillUrlLength: 120, prefillTruncationNote: note })
    const result = service.prefilledIssueUrl({
      repoUrl: 'https://github.com/owner/repo',
      report: { title: 'T'.repeat(200), body: 'body', labels: [] },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The title names the report and cannot be shortened without lying about it,
    // so the body gives up everything it can and the URL stays as short as
    // possible; the limit is then unreachable by construction.
    expect(new URL(result.value).searchParams.get('body')).toBe(note)
  })

  it('leaves the body alone when shortening is disabled', async () => {
    const { service } = await harness({ maxPrefillUrlLength: 0 })
    const body = 'x'.repeat(2000)
    const result = service.prefilledIssueUrl({
      repoUrl: 'https://github.com/owner/repo',
      report: { title: 't', body, labels: [] },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(new URL(result.value).searchParams.get('body')).toBe(body)
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

  it('names the preserved failure code instead of blaming the model', async () => {
    // The old message was "the model produced no output" for every cause,
    // including an unroutable provider — which is why the issue editor's
    // optimize button sent a user looking for a model problem.
    const { service } = await harness({
      emptyLlm: true,
      llmFailure: { code: 'RATE_LIMIT', message: 'the provider rate limited this call', status: 429 },
    })
    const result = await service.optimizeIssue({
      description: 'something broke',
      provider: 'test',
      model: 'test',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('llm-failure')
    expect(result.error.message).toContain('RATE_LIMIT')
    expect(result.error.message).toContain('the provider rate limited this call')
    expect(result.error.message).toContain('"test"')
    expect(result.error.message).not.toContain('produced no output')
  })

  it('turns a throwing provider into an llm-failure rather than an escaping error', async () => {
    const { service } = await harness({ throwingLlm: true, provider: 'test', model: 'test' })

    const result = await service.optimizeIssue({ description: 'something broke' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('llm-failure')
    expect(result.error.message).toContain('LLM_STREAM_THREW')
    expect(result.error.message).toContain('socket hang up')
  })

  it('resolves the route from the deployment default when the caller sends none', async () => {
    // The defect this guards: the browser sends only a description, and a
    // service that resolves nothing calls the model with no adapter, which
    // surfaces as "the model produced no output" — a model-shaped message for a
    // routing problem. The whole panel was unusable this way.
    const { service, llm } = await harness({ defaultRoute: { provider: 'default-provider', model: 'default-model' } })
    const result = await service.optimizeIssue({ description: 'the optimize button reports no output' })
    expect(result.ok).toBe(true)
    expect(llm.requests[0]).toMatchObject({ provider: 'default-provider', model: 'default-model' })
  })

  it('prefers the callers route over Config and the deployment default', async () => {
    const { service, llm } = await harness({
      provider: 'config-provider',
      model: 'config-model',
      defaultRoute: { provider: 'default-provider', model: 'default-model' },
    })
    await service.optimizeIssue({ description: 'explicit', provider: 'caller-provider', model: 'caller-model' })
    expect(llm.requests[0]).toMatchObject({ provider: 'caller-provider', model: 'caller-model' })
  })

  it('prefers Config over the deployment default', async () => {
    const { service, llm } = await harness({
      provider: 'config-provider',
      model: 'config-model',
      defaultRoute: { provider: 'default-provider', model: 'default-model' },
    })
    await service.optimizeIssue({ description: 'configured' })
    expect(llm.requests[0]).toMatchObject({ provider: 'config-provider', model: 'config-model' })
  })

  it('treats a blank route as absent instead of calling the model with it', async () => {
    // Blank is the shape an omitted field takes, and it must not shadow the
    // fallback: the deployment default still answers.
    const { service, llm } = await harness({ defaultRoute: { provider: 'default-provider', model: 'default-model' } })
    const result = await service.optimizeIssue({ description: 'blank', provider: '', model: '   ' })
    expect(result.ok).toBe(true)
    expect(llm.requests[0]).toMatchObject({ provider: 'default-provider', model: 'default-model' })
  })

  it('names a missing route instead of attempting a call without one', async () => {
    const { service, llm } = await harness()
    const result = await service.optimizeIssue({ description: 'nothing resolves a route' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('route-missing')
    // No model call is attempted: it could not have succeeded, and attempting it
    // produces the misleading "no output" that hides the real cause.
    expect(llm.requests).toHaveLength(0)
  })

  it('names a missing route on report generation too', async () => {
    const { service, llm } = await harness()
    const result = await service.generateReport({
      pluginIds: ['memo'],
      totalEvents: 1,
      totalFailures: 1,
      failureGroups: [],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('route-missing')
    expect(llm.requests).toHaveLength(0)
  })
})

describe('GithubIssueService generateReport', () => {
  it('generates a report from telemetry analysis input', async () => {
    const { service } = await harness({
      llmText: '## memo \u9065\u6d4b\u5931\u8d25\n\n<details><summary>\u8bca\u65ad\u62a5\u544a</summary>\n\nTimeout\n\n</details>',
    })
    const result = await service.generateReport({
      pluginIds: ['memo'],
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

  it('puts the window, route, and recency of each group into the prompt', async () => {
    const { service, prompts } = await harness()
    const result = await service.generateReport({
      pluginIds: ['memo'],
      totalEvents: 458,
      totalFailures: 5,
      window: { firstEventAt: Date.parse('2026-09-01T07:22:00Z'), lastEventAt: Date.parse('2026-09-15T08:19:00Z') },
      failureGroups: [{
        featureCodeRef: 'memo:analyze',
        count: 3,
        errorCode: 'LLM_FAILURE',
        errorMessage: 'model produced no output',
        lastFailureAt: Date.parse('2026-09-11T03:04:00Z'),
        attemptsAfterLastFailure: 14,
        route: { provider: 'deepseek-cu', model: 'deepseek-flash', status: 429 },
      }],
      provider: 'test',
      model: 'test',
    })
    expect(result.ok).toBe(true)

    const { user } = prompts[0]!
    // The plugins are named in the prompt: a report that covers a suite has to
    // say which packages it read, or the reader cannot tell what was omitted.
    expect(user).toContain('Plugins: memo')
    expect(user).toContain('Analysis window: 2026-09-01T07:22:00.000Z .. 2026-09-15T08:19:00.000Z')
    expect(user).toContain('route: deepseek-cu / deepseek-flash (status 429)')
    expect(user).toContain('lastFailureAt: 2026-09-11T03:04:00.000Z')
    expect(user).toContain('attemptsAfterLastFailure: 14')
  })

  it('labels a fact the analysis does not carry as not recorded', async () => {
    const { service, prompts } = await harness()
    // The shape of every failure recorded before the route metadata existed.
    await service.generateReport({
      pluginIds: ['memo'],
      totalEvents: 458,
      totalFailures: 5,
      failureGroups: [{ featureCodeRef: 'memo:analyze', count: 3 }],
      provider: 'test',
      model: 'test',
    })

    const { user } = prompts[0]!
    expect(user).toContain('Analysis window: not recorded')
    expect(user).toContain('route: not recorded')
    expect(user).toContain('lastFailureAt: not recorded')
    expect(user).toContain('attemptsAfterLastFailure: not recorded')
  })

  it('tells the model which facts it may not invent, and how to read recency', async () => {
    const { service, prompts } = await harness()
    await service.generateReport({
      pluginIds: ['memo'],
      totalEvents: 1,
      totalFailures: 0,
      failureGroups: [],
      provider: 'test',
      model: 'test',
    })

    // The prompt, not the model, is what kept producing plausible causes for
    // mechanisms this plugin does not have (sampling parameters, chunking,
    // parsing). These statements are the guard.
    const { system } = prompts[0]!
    expect(system).toContain('do not mention sampling parameters')
    // Phrases are asserted inside one wrapped line: the prompt is joined with
    // newlines, so a longer fragment would be testing the line breaks.
    expect(system).toContain('failure that has not recurred is not a current defect')
    expect(system).toContain('Never write')
    expect(system).toContain('### 路由与时间 / Route and Timing')
  })
})

describe('GithubIssueService telemetry', () => {
  /** The first recorded event for one action, asserting that there is one. */
  function eventFor(events: { kind: string; input: Record<string, unknown> }[], action: string): Record<string, unknown> {
    const event = events.find(candidate => candidate.input.action === action)
    expect(event, `no telemetry event was recorded for ${action}`).toBeDefined()
    return event!.input
  }

  it('records the route on a successful optimization', async () => {
    const { service, telemetry } = await harness({ provider: 'test-provider', model: 'test-model' })

    const result = await service.optimizeIssue({ description: 'the panel is empty' })
    expect(result.ok).toBe(true)

    expect(eventFor(telemetry!.events, 'optimizeIssue')).toMatchObject({
      pluginId: 'github-issue',
      result: 'success',
      metadata: { provider: 'test-provider', model: 'test-model' },
    })
  })

  it('records a failed call with the preserved code, the route, and a feature anchor', async () => {
    // This is the record that was missing entirely: every click of the issue
    // editor's optimize button failed while telemetry stayed silent, so the
    // defect surfaced as a user report instead of as a failure group.
    const { service, telemetry } = await harness({
      emptyLlm: true,
      llmFailure: { code: 'NO_ADAPTER', message: 'no adapter registered for provider "custom"', status: 400 },
      provider: 'custom',
      model: 'glm-5-2-260617',
    })

    const result = await service.optimizeIssue({ description: 'the panel is empty' })
    expect(result.ok).toBe(false)

    const event = telemetry!.events.find(candidate => candidate.kind === 'trackError')
    expect(event).toBeDefined()
    expect(event!.input).toMatchObject({
      pluginId: 'github-issue',
      action: 'optimizeIssue',
      error: {
        code: 'NO_ADAPTER',
        message: 'no adapter registered for provider "custom"',
        featureCodeRef: 'github-issue:optimizeIssue',
      },
      metadata: { provider: 'custom', model: 'glm-5-2-260617', status: 400 },
    })
  })

  it('records a call that arrived with no resolvable route', async () => {
    // No route anywhere is not a model failure; it is recorded under the same
    // code memo uses, so a suite-wide report can group both packages together.
    const { service, telemetry } = await harness()

    const result = await service.optimizeIssue({ description: 'the panel is empty' })
    expect(result.ok).toBe(false)

    const event = telemetry!.events.find(candidate => candidate.kind === 'trackError')
    expect(event).toBeDefined()
    expect(event!.input).toMatchObject({
      action: 'optimizeIssue',
      error: { code: 'NO_MODEL_ROUTE', featureCodeRef: 'github-issue:optimizeIssue' },
    })
  })

  it('records which plugins a generated report analyzed', async () => {
    const { service, telemetry } = await harness({ provider: 'test-provider', model: 'test-model' })

    const result = await service.generateReport({
      pluginIds: ['memo', 'github-issue'],
      totalEvents: 4,
      totalFailures: 1,
      failureGroups: [],
    })
    expect(result.ok).toBe(true)

    expect(eventFor(telemetry!.events, 'generateReport')).toMatchObject({
      pluginId: 'github-issue',
      result: 'success',
      metadata: { pluginIds: ['memo', 'github-issue'], provider: 'test-provider', model: 'test-model' },
    })
  })

  it('records a failed report too, not only a failed optimization', async () => {
    const { service, telemetry } = await harness({
      emptyLlm: true,
      llmFailure: { code: 'AUTH', message: 'the provider rejected the credential' },
      provider: 'test-provider',
      model: 'test-model',
    })

    const result = await service.generateReport({
      pluginIds: ['memo'],
      totalEvents: 4,
      totalFailures: 1,
      failureGroups: [],
    })
    expect(result.ok).toBe(false)

    const event = telemetry!.events.find(candidate => candidate.kind === 'trackError')
    expect(event!.input).toMatchObject({
      action: 'generateReport',
      error: { code: 'AUTH', featureCodeRef: 'github-issue:generateReport' },
    })
  })

  it('works with no telemetry mounted at all', async () => {
    // A diagnostic dependency must never be why a service refuses to run: this
    // package installs on its own bundle, without telemetry.
    const okHarness = await harness({ withoutTelemetry: true, provider: 'test-provider', model: 'test-model' })
    expect(okHarness.telemetry).toBeUndefined()
    const ok = await okHarness.service.optimizeIssue({ description: 'the panel is empty' })
    expect(ok.ok).toBe(true)

    const failingHarness = await harness({
      withoutTelemetry: true,
      emptyLlm: true,
      llmFailure: { code: 'NO_ADAPTER', message: 'no adapter registered' },
      provider: 'test-provider',
      model: 'test-model',
    })
    expect(failingHarness.telemetry).toBeUndefined()
    const failed = await failingHarness.service.optimizeIssue({ description: 'the panel is empty' })
    expect(failed.ok).toBe(false)
    if (failed.ok) return
    expect(failed.error.code).toBe('llm-failure')
    expect(failed.error.message).toContain('NO_ADAPTER')
  })
})
