import { describe, expect, it } from 'vitest'
import { GithubIssueClient, parseRepository } from '../src/github.ts'

/** A JSON response with the given status. */
function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

/** Build a client whose transport is the supplied fake. */
function client(fetchImpl: typeof fetch, token: string | null = 'secret', repoUrl = 'https://github.com/acme/widgets'): GithubIssueClient {
  return new GithubIssueClient({ repoUrl, apiBaseUrl: 'https://api.github.com', token: token ?? undefined, timeoutMs: 1000, fetchImpl })
}

describe('parseRepository', () => {
  it('splits a repository URL and tolerates a trailing slash', () => {
    expect(parseRepository('https://github.com/acme/widgets')).toEqual({ owner: 'acme', repo: 'widgets' })
    expect(parseRepository('https://github.com/acme/widgets/')).toEqual({ owner: 'acme', repo: 'widgets' })
  })

  it('rejects a URL that does not name a repository', () => {
    expect(parseRepository('https://github.com/acme')).toBeUndefined()
    expect(parseRepository('not-a-url')).toBeUndefined()
  })
})

describe('GithubIssueClient.createIssue', () => {
  it('posts the report with the bearer token', async () => {
    let captured: { url: string; init: RequestInit } | undefined
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      captured = { url: String(url), init: init ?? {} }
      return json({ number: 7, html_url: 'https://github.com/acme/widgets/issues/7' }, 201)
    }) as typeof fetch
    const result = await client(fetchImpl).createIssue({ title: 'Crash', body: '<details>x</details>', labels: ['bug'] })
    expect(result).toEqual({ ok: true, value: { number: 7, url: 'https://github.com/acme/widgets/issues/7' } })
    expect(captured?.url).toBe('https://api.github.com/repos/acme/widgets/issues')
    expect(captured?.init.method).toBe('POST')
    expect((captured?.init.headers as Record<string, string>).authorization).toBe('Bearer secret')
    expect(JSON.parse(String(captured?.init.body))).toEqual({ title: 'Crash', body: '<details>x</details>', labels: ['bug'] })
  })

  it('reports a missing credential without sending a request', async () => {
    let called = false
    const fetchImpl = (async () => {
      called = true
      return json({})
    }) as typeof fetch
    const result = await client(fetchImpl, null).createIssue({ title: 'x', body: 'y', labels: [] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('auth-missing')
    expect(called).toBe(false)
  })

  it('classifies the HTTP failures a deployment must distinguish', async () => {
    const cases: { response: Response; code: string }[] = [
      { response: json({ message: 'Bad credentials' }, 401), code: 'auth-failure' },
      { response: json({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0' }), code: 'rate-limited' },
      { response: json({ message: 'Validation Failed' }, 422), code: 'invalid-request' },
      { response: json({ message: 'Server Error' }, 500), code: 'http-failure' },
    ]
    for (const item of cases) {
      const fetchImpl = (async () => item.response.clone()) as typeof fetch
      const result = await client(fetchImpl).createIssue({ title: 'x', body: 'y', labels: [] })
      expect(result.ok, item.code).toBe(false)
      if (result.ok) continue
      expect(result.error.code).toBe(item.code)
    }
  })

  it('reports a transport error as a network failure', async () => {
    const fetchImpl = (async () => {
      throw new Error('socket hang up')
    }) as typeof fetch
    const result = await client(fetchImpl).createIssue({ title: 'x', body: 'y', labels: [] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('network-failure')
    expect(result.error.message).toContain('socket hang up')
  })

  it('rejects a repository URL that is not one', async () => {
    const fetchImpl = (async () => json({})) as typeof fetch
    const result = await client(fetchImpl, 'secret', 'not-a-url').createIssue({ title: 'x', body: 'y', labels: [] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('invalid-repo')
  })
})

describe('GithubIssueClient.listClaimable', () => {
  it('keeps issues carrying the claim label and drops pull requests', async () => {
    const payload = [
      { number: 1, title: 'A', html_url: 'u1', body: 'b1', labels: [{ name: 'ready-for-agent' }] },
      { number: 2, title: 'PR', html_url: 'u2', body: 'b2', labels: [{ name: 'ready-for-agent' }], pull_request: {} },
      { number: 3, title: 'B', html_url: 'u3', body: 'b3', labels: [{ name: 'bug' }] },
      { number: 4, title: 'C', html_url: 'u4', body: 'b4', labels: [{ name: 'Ready-For-Agent' }] },
    ]
    const fetchImpl = (async () => json(payload)) as typeof fetch
    const result = await client(fetchImpl).listClaimable('ready-for-agent', 10)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.map(issue => issue.number)).toEqual([1, 4])
    expect(result.value[0]?.labels).toEqual(['ready-for-agent'])
  })

  it('reports an unreadable body as an HTTP failure', async () => {
    const fetchImpl = (async () => new Response('not json', { status: 200 })) as typeof fetch
    const result = await client(fetchImpl).listClaimable('ready-for-agent', 10)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('http-failure')
  })
})