import { describe, expect, it } from 'vitest'
import {
  compileRules,
  DEFAULT_REDACTION_MARKER,
  DEFAULT_REDACTION_RULES,
  redactMetadata,
  redactText,
  type RedactionOptions,
} from '../src/redaction.ts'

/** Compile the default policy, optionally with overrides. */
function defaults(overrides: Partial<RedactionOptions> = {}) {
  return compileRules({
    enabled: true,
    marker: DEFAULT_REDACTION_MARKER,
    rules: DEFAULT_REDACTION_RULES,
    ...overrides,
  })
}

describe('redactText with the default rules', () => {
  const rules = defaults()

  it('redacts an email address', () => {
    expect(redactText('contact jane.doe+work@example.co.uk about it', rules))
      .toBe('contact [redacted:email] about it')
  })

  it('redacts a bearer token and a prefixed key', () => {
    expect(redactText('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def', rules))
      .toBe('Authorization: [redacted:credential]')
    expect(redactText('using ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345', rules))
      .toBe('using [redacted:credential]')
    expect(redactText('api_key=abcdef123456', rules)).toBe('[redacted:credential]')
  })

  it('redacts a home directory on either platform', () => {
    expect(redactText('read /Users/zjlzld/projects/secret/notes.md', rules))
      .toBe('read [redacted:home-path]')
    expect(redactText('read C:\\Users\\zjlzld\\.dsh\\config.yml', rules))
      .toBe('read [redacted:home-path]')
  })

  it('redacts any other absolute Windows path', () => {
    expect(redactText('cannot open D:\\ProgramFiles\\nvm\\v24\\node.exe', rules))
      .toBe('cannot open [redacted:windows-path]')
  })

  it('redacts IPv4 and IPv6 addresses', () => {
    expect(redactText('connect to 10.0.0.7 failed', rules)).toBe('connect to [redacted:ipv4] failed')
    expect(redactText('bound to 2001:0db8:85a3:0000:0000:8a2e:0370:7334', rules))
      .toBe('bound to [redacted:ipv6]')
  })

  it('redacts long hex and base64 blobs', () => {
    expect(redactText('checksum d41d8cd98f00b204e9800998ecf8427e rejected', rules))
      .toBe('checksum [redacted:hex] rejected')
    expect(redactText('payload VGhpcyBpcyBhIHZlcnkgbG9uZyBiYXNlNjQgc3RyaW5nIQ==', rules))
      .toBe('payload [redacted:base64]')
  })

  it('leaves ordinary text, and a bare path segment, alone', () => {
    // A rule set that also chews up the channel and endpoint names it will be
    // asked to explain is a rule set nobody can debug with.
    const plain = 'memo/analyze failed for 2026-Q3 after 3 attempts at /api'
    expect(redactText(plain, rules)).toBe(plain)
  })

  it('redacts every occurrence in one value, not only the first', () => {
    expect(redactText('a@b.co and c@d.co', rules)).toBe('[redacted:email] and [redacted:email]')
  })
})

describe('compileRules', () => {
  it('drops a rule whose pattern does not compile instead of throwing', () => {
    // A typo in deployment configuration must not stop the host recording.
    const rules = compileRules({
      enabled: true,
      marker: DEFAULT_REDACTION_MARKER,
      rules: [
        { name: 'broken', pattern: '([' },
        { name: 'email', pattern: '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}' },
      ],
    })
    expect(rules.map(rule => rule.name)).toEqual(['email'])
    expect(redactText('a@b.co', rules)).toBe('[redacted:email]')
  })

  it('honours a custom marker and a custom rule', () => {
    const rules = compileRules({
      enabled: true,
      marker: '<{rule}>',
      rules: [{ name: 'ticket', pattern: 'JIRA-\\d+' }],
    })
    expect(redactText('see JIRA-4210', rules)).toBe('see <ticket>')
  })

  it('applies rules in order, so the specific one names the match', () => {
    // A token is also long and base64-shaped; whichever runs first is the label
    // a reader sees.
    const rules = compileRules({
      enabled: true,
      marker: DEFAULT_REDACTION_MARKER,
      rules: [
        { name: 'token', pattern: 'sk-[A-Za-z0-9]{16,}' },
        { name: 'base64', pattern: '\\b[A-Za-z0-9+/]{20,}\\b' },
      ],
    })
    expect(redactText('key sk-abcdefghijklmnopqrst', rules)).toBe('key [redacted:token]')
  })

  it('redacts nothing when the rule set is empty', () => {
    expect(redactText('a@b.co and C:\\Users\\me\\x', defaults({ rules: [] })))
      .toBe('a@b.co and C:\\Users\\me\\x')
  })

  it('accepts a case-insensitive rule', () => {
    const rules = compileRules({
      enabled: true,
      marker: DEFAULT_REDACTION_MARKER,
      rules: [{ name: 'secret', pattern: 'password', flags: 'i' }],
    })
    expect(redactText('PASSWORD=x', rules)).toBe('[redacted:secret]=x')
  })
})

describe('redactMetadata', () => {
  const rules = defaults()

  it('redacts strings nested in objects and arrays', () => {
    const redacted = redactMetadata({
      nested: { path: '/home/me/secret.txt', list: ['a@b.co', 'plain'] },
    }, rules)
    expect(redacted).toEqual({
      nested: { path: '[redacted:home-path]', list: ['[redacted:email]', 'plain'] },
    })
  })

  it('keeps non-string leaves at their own type', () => {
    const redacted = redactMetadata({ count: 3, ok: true, nothing: null }, rules)
    expect(redacted).toEqual({ count: 3, ok: true, nothing: null })
    expect(typeof (redacted as Record<string, unknown>).count).toBe('number')
  })

  it('returns undefined for absent metadata, so no key is written at all', () => {
    // An `undefined` metadata field and a missing one differ at the durable
    // schema boundary, which is why this is not `{}`.
    expect(redactMetadata(undefined, rules)).toBeUndefined()
  })

  it('stringifies a value that is not plain data, so nothing slips past', () => {
    const redacted = redactMetadata({ odd: new Date(0) }, rules) as Record<string, unknown>
    expect(typeof redacted.odd).toBe('string')
  })

  it('does not mutate what the caller passed in', () => {
    const original = { path: '/Users/me/secret.txt' }
    redactMetadata(original, rules)
    expect(original.path).toBe('/Users/me/secret.txt')
  })
})
