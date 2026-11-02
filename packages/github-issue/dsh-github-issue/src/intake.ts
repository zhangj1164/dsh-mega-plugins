/**
 * Pure helpers for the issue intake loop.
 *
 * Everything here is deterministic and free of host services: the report body
 * normalization, the dispatch prompt rendering, and the local-day key that makes
 * "the first startup of the day" mean the user's day rather than UTC's.
 *
 * @module @zhangj1164/dsh-github-issue/intake
 */

import type { GithubIssueReport, GithubIssueTask } from './types.ts'

/**
 * The dispatch prompt a deployment gets when it configures none.
 *
 * The placeholders are documented on {@link renderDispatchPrompt}; the text
 * tells the receiving Session where the issue is and which workflow to follow,
 * without assuming a repository-specific branch naming scheme.
 */
export const DEFAULT_DISPATCH_PROMPT = [
  '你在处理 GitHub issue #{number}：{title}',
  '',
  '{url}',
  '',
  '请按仓库 AGENTS.md 的工作流完成它：从最新 main 切分支、实现并补测试、跑通门禁、开 PR 并引用 #{number}。不要直接提交到 main。',
  '',
  'Issue 正文：',
  '{body}',
].join('\n')

/** Placeholders {@link renderDispatchPrompt} replaces. */
const PLACEHOLDER = /\{(number|title|url|body|labels)\}/gu

/**
 * Strip the leading `## title` line from an optimized report body.
 *
 * The optimizer repeats the title as the body's first heading so the same text
 * can drive the pre-filled URL form. GitHub takes the title as its own field,
 * so filing that body unchanged would show the title twice.
 *
 * @param report - the optimized report.
 * @returns the body without its leading title heading.
 */
export function issueBody(report: GithubIssueReport): string {
  const lines = report.body.replace(/\r\n/gu, '\n').split('\n')
  if (/^##\s+/u.test(lines[0] ?? '')) {
    lines.shift()
    while (lines.length > 0 && (lines[0] ?? '').trim().length === 0) lines.shift()
  }
  return lines.join('\n').trimEnd()
}

/**
 * Render the dispatch prompt for one issue.
 *
 * Supported placeholders are `{number}`, `{title}`, `{url}`, `{body}`, and
 * `{labels}`. An unknown `{token}` is left untouched rather than dropped, so a
 * typo in a deployment template stays visible instead of silently disappearing.
 *
 * @param template - the configured prompt template.
 * @param issue - the issue being dispatched.
 * @returns the prompt the receiving Session reads.
 */
export function renderDispatchPrompt(template: string, issue: GithubIssueTask): string {
  const values: Record<string, string> = {
    number: String(issue.number),
    title: issue.title,
    url: issue.url,
    body: issue.body,
    labels: issue.labels.join(', '),
  }
  return template.replace(PLACEHOLDER, (_match, key: string) => values[key] ?? '')
}

/**
 * Format one instant as a local calendar day.
 *
 * The key is the deployment's local date, not UTC's: "today" for a user in
 * Asia/Shanghai starts eight hours before UTC's, and a UTC key would let a late
 * restart skip the day or run the check twice.
 *
 * @param now - instant in epoch milliseconds.
 * @param timeZone - IANA zone; an empty value follows the host's own zone.
 * @returns the `YYYY-MM-DD` local date.
 */
export function localDayKey(now: number, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    ...(timeZone.length === 0 ? {} : { timeZone }),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = formatter.formatToParts(new Date(now))
  const read = (type: 'year' | 'month' | 'day'): string => parts.find(part => part.type === type)?.value ?? ''
  return `${read('year')}-${read('month')}-${read('day')}`
}

/**
 * Verify that one IANA time-zone name is usable.
 *
 * Called while the service configures itself, so a typo fails at load with a
 * named field instead of at the first startup check, hours later.
 *
 * @param timeZone - candidate zone; an empty value is always valid.
 * @returns true when the zone resolves.
 */
export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone.length === 0) return true
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}
