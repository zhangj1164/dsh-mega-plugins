import { describe, expect, it } from 'vitest'
import { DEFAULT_DISPATCH_PROMPT, isValidTimeZone, issueBody, localDayKey, renderDispatchPrompt } from '../src/intake.ts'
import type { GithubIssueTask } from '../src/types.ts'

const ISSUE: GithubIssueTask = {
  number: 42,
  title: '登录失败',
  body: 'blank page',
  url: 'https://github.com/acme/app/issues/42',
  labels: ['bug', 'ready-for-agent'],
}

describe('issueBody', () => {
  it('removes the title heading the optimizer prepends', () => {
    expect(issueBody({ title: 'x', body: '## 登录失败\n\n<details>body</details>', labels: [] })).toBe('<details>body</details>')
  })

  it('keeps a body that carries no title heading', () => {
    expect(issueBody({ title: 'x', body: '<details>body</details>', labels: [] })).toBe('<details>body</details>')
  })

  it('tolerates CRLF and a heading with no body after it', () => {
    expect(issueBody({ title: 'x', body: '## 标题\r\n\r\n', labels: [] })).toBe('')
  })
})

describe('renderDispatchPrompt', () => {
  it('replaces every documented placeholder', () => {
    const rendered = renderDispatchPrompt('{number}|{title}|{url}|{labels}|{body}', ISSUE)
    expect(rendered).toBe('42|登录失败|https://github.com/acme/app/issues/42|bug, ready-for-agent|blank page')
  })

  it('leaves an unknown placeholder visible instead of dropping it', () => {
    expect(renderDispatchPrompt('{number} {unknown}', ISSUE)).toBe('42 {unknown}')
  })

  it('renders the default prompt with the issue facts', () => {
    const rendered = renderDispatchPrompt(DEFAULT_DISPATCH_PROMPT, ISSUE)
    expect(rendered).toContain('#42')
    expect(rendered).toContain('https://github.com/acme/app/issues/42')
    expect(rendered).toContain('blank page')
  })
})

describe('localDayKey', () => {
  it('uses the configured zone, not UTC', () => {
    // 2026-11-01T16:30Z is 2026-11-02 00:30 in Asia/Shanghai.
    const instant = Date.parse('2026-11-01T16:30:00Z')
    expect(localDayKey(instant, 'Asia/Shanghai')).toBe('2026-11-02')
    expect(localDayKey(instant, 'UTC')).toBe('2026-11-01')
  })

  it('zero-pads month and day', () => {
    expect(localDayKey(Date.parse('2026-01-05T12:00:00Z'), 'UTC')).toBe('2026-01-05')
  })
})

describe('isValidTimeZone', () => {
  it('accepts the host zone and rejects a typo', () => {
    expect(isValidTimeZone('')).toBe(true)
    expect(isValidTimeZone('Asia/Shanghai')).toBe(true)
    expect(isValidTimeZone('Asia/Shanghia')).toBe(false)
  })
})
