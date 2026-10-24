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

  it('leaves ordinary text, a bare path segment, and a number that only looks like an ID alone', () => {
    // A rule set that also chews up the channel and endpoint names it will be
    // asked to explain is a rule set nobody can debug with.
    const plain = 'memo/analyze failed for 2026-Q3 after 3 attempts at /api and /v1'
    expect(redactText(plain, rules)).toBe(plain)
    // Eighteen digits with no plausible date in the middle are not a resident ID.
    expect(redactText('snowflake 123456789012345678', rules)).toBe('snowflake 123456789012345678')
    // Eleven digits that do not open with an allocated mobile prefix are not a phone.
    expect(redactText('build 10123456789', rules)).toBe('build 10123456789')
  })

  it('redacts every occurrence in one value, not only the first', () => {
    expect(redactText('a@b.co and c@d.co', rules)).toBe('[redacted:email] and [redacted:email]')
  })
})

/**
 * One row per shape, and one row per control that must come back unchanged.
 * Each row is its own case, so a shape that leaks names itself in the report
 * instead of hiding inside a grouped assertion.
 */
const defaultRuleSamples: Array<[label: string, input: string, expected: string]> = [
  // Paths outside the home prefixes, which the default set used to miss.
  ['a workspace path', '/workspace/a/b.md', '[redacted:absolute-path]'],
  ['an srv path', '/srv/a/b.xlsx', '[redacted:absolute-path]'],
  ['a data path', '/data/a/b.csv', '[redacted:absolute-path]'],
  ['a media path', '/media/a/b.sql', '[redacted:absolute-path]'],
  ['a mounted volume path', '/Volumes/a/b.pdf', '[redacted:absolute-path]'],
  ['an app path', '/app/a/b.yml', '[redacted:absolute-path]'],
  ['a tilde path', '~/a/b.pdf', '[redacted:home-path]'],
  ['a UNC path', '\\\\fileserver\\hr-share\\a.xlsx', '[redacted:unc-path]'],
  ['a file URL', 'file:///srv/app/report.pdf', '[redacted:file-url]'],
  ['a two-segment route', '/v1/chat/completions', '[redacted:absolute-path]'],
  ['a stack frame keeps its position', 'open (/srv/a/b.ts:12:5)', 'open ([redacted:absolute-path]:12:5)'],
  // Credential families the prefixed-key rule does not cover.
  ['an AWS access key', 'AKIAIOSFODNN7EXAMPLE', '[redacted:credential]'],
  ['a Google API key', 'AIzaSyA-EXAMPLE_EXAMPLE-EXAMPLE_12345', '[redacted:credential]'],
  ['a JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U', '[redacted:jwt]'],
  ['a credential in a query string', 'https://host/p?token=abc123def456ghi789', 'https://host/p[redacted:query-credential]'],
  ['a signature in a query string', 'https://host/p?x=1&signature=deadbeef', 'https://host/p?x=1[redacted:query-credential]'],
  // Personal identifiers, with the shapes that merely look like them.
  ['a mobile number', 'call 13800138000 now', 'call [redacted:cn-mobile] now'],
  ['a resident ID', '110101199003072316', '[redacted:cn-id]'],
  ['a resident ID ending in X', '11010119900307231X', '[redacted:cn-id]'],
  ['a single bare segment', '/v1', '/v1'],
  ['bare segments in prose', 'memo/analyze failed for 2026-Q3 after 3 attempts at /api', 'memo/analyze failed for 2026-Q3 after 3 attempts at /api'],
  ['a thirteen-digit timestamp', '1797000000000', '1797000000000'],
  ['a year', '2026', '2026'],
  ['an ISO week', '2025-W03', '2025-W03'],
  ['a long number with no date inside', '123456789012345678', '123456789012345678'],
  ['a route provider and model', 'provider deepseek-cu model glm-5-2-260617', 'provider deepseek-cu model glm-5-2-260617'],
  // Behaviour that predates this rule set and has to stay identical.
  ['an email address', 'me@example.com', '[redacted:email]'],
  ['a bearer token', 'Authorization: Bearer abcdefghijklmnop', 'Authorization: [redacted:credential]'],
  ['a GitHub token', 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345', '[redacted:credential]'],
  ['an sk- key', 'sk-abcdefghijklmnopqrst', '[redacted:credential]'],
  ['a key assignment', 'api_key=abcdef123456', '[redacted:credential]'],
  ['a home path on POSIX', '/home/me/x.md', '[redacted:home-path]'],
  ['a home path on Windows', 'C:\\Users\\me\\x', '[redacted:home-path]'],
  ['another Windows path', 'D:\\ProgramFiles\\nvm\\node.exe', '[redacted:windows-path]'],
  ['an IPv4 address', 'connect to 10.0.0.7 failed', 'connect to [redacted:ipv4] failed'],
  ['an IPv6 address', 'bound to 2001:0db8:85a3:0000:0000:8a2e:0370:7334', 'bound to [redacted:ipv6]'],
  ['a hex blob', 'checksum d41d8cd98f00b204e9800998ecf8427e rejected', 'checksum [redacted:hex] rejected'],
  ['a base64 blob', 'payload VGhpcyBpcyBhIHZlcnkgbG9uZyBiYXNlNjQgc3RyaW5nIQ==', 'payload [redacted:base64]'],
]

describe('the default rule set, sample by sample', () => {
  const rules = defaults()

  it.each(defaultRuleSamples)('%s', (_label, input, expected) => {
    expect(redactText(input, rules)).toBe(expected)
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
