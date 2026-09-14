/**
 * Write-time redaction for telemetry events.
 *
 * A telemetry log is only useful if it can be read back, and the fields that
 * carry the most diagnostic value — error messages, stacks, and free-form
 * metadata — are exactly the ones that pick up absolute paths, addresses, and
 * credentials along the way. Those records are also read by the log-analysis
 * feature and pasted into a GitHub issue, so a secret captured here leaves the
 * machine on the next report.
 *
 * Redaction therefore happens on the way in, before the record is written, and
 * is irreversible. Every rule lives in the deployment's `Config`, because the
 * right balance between "keeps secrets out" and "keeps enough to debug" differs
 * per deployment and cannot be decided here.
 *
 * @module dsh-telemetry/redaction
 */

/** One redaction rule: a named pattern applied to every string before storage. */
export interface RedactionRule {
  /** Rule name, reported in the replacement marker so a reader sees what was removed. */
  readonly name: string
  /** A regular-expression source. Compiled with the `g` flag plus {@link RedactionRule.flags}. */
  readonly pattern: string
  /** Extra regular-expression flags. `g` is always applied and must not be repeated here. */
  readonly flags?: string
}

/** Redaction policy: whether to redact, what to write instead, and the rule set. */
export interface RedactionOptions {
  /** Master switch. Disabling it stores events verbatim. */
  readonly enabled: boolean
  /** Replacement text. `{rule}` is substituted with the matching rule's name. */
  readonly marker: string
  /** Rules applied in order; later rules see the output of earlier ones. */
  readonly rules: readonly RedactionRule[]
}

/** One compiled rule: its name plus the global expression to apply. */
interface CompiledRule {
  readonly name: string
  readonly expression: RegExp
  /** The marker for this rule, precomputed so the hot path allocates nothing. */
  readonly marker: string
}

/**
 * The default rule set: the five families a personal telemetry log actually
 * leaks. Order matters — a token is also long and base64-shaped, so the token
 * rule runs first and gives the more informative name.
 */
export const DEFAULT_REDACTION_RULES: readonly RedactionRule[] = Object.freeze([
  Object.freeze({ name: 'email', pattern: '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}' }),
  Object.freeze({
    name: 'credential',
    pattern: '(?:Bearer|Basic)\\s+[A-Za-z0-9._~+/-]{8,}=*'
      + '|\\b(?:sk|ghp|gho|ghs|ghr|github_pat|xox[abprs])[-_][A-Za-z0-9_-]{12,}\\b'
      + '|\\b(?:api[-_]?key|access[-_]?token|auth[-_]?token|client[-_]?secret|password|passwd|secret)["\']?\\s*[=:]\\s*["\']?[^\\s"\',;]{6,}',
    flags: 'i',
  }),
  // Both branches stop at a colon. A stack frame reads `path:line:column`, and
  // swallowing the position would remove the diagnostic detail that makes the
  // path worth logging in the first place.
  Object.freeze({ name: 'home-path', pattern: '(?:[A-Za-z]:\\\\Users\\\\[^\\s"\':]+|/(?:Users|home|root|var|tmp|opt|mnt|etc)/[^\\s"\',;):]*)' }),
  Object.freeze({ name: 'windows-path', pattern: '[A-Za-z]:\\\\(?:[^\\\\\\s:*?"<>|]+\\\\)*[^\\\\\\s:*?"<>|]*' }),
  Object.freeze({ name: 'ipv4', pattern: '\\b(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)){3}\\b' }),
  Object.freeze({ name: 'ipv6', pattern: '\\b(?:[A-Fa-f0-9]{1,4}:){2,7}[A-Fa-f0-9]{1,4}\\b' }),
  Object.freeze({ name: 'hex', pattern: '\\b[A-Fa-f0-9]{32,}\\b' }),
  // No trailing `\b`: base64 padding ends in `=`, a non-word character, so a
  // trailing boundary would fail there and the engine would backtrack away the
  // padding instead of removing it.
  Object.freeze({ name: 'base64', pattern: '\\b[A-Za-z0-9+/]{40,}={0,2}' }),
])

/** Default replacement marker. */
export const DEFAULT_REDACTION_MARKER = '[redacted:{rule}]'

/**
 * Compile the rule set once, so a write path that runs on every user action
 * does not rebuild expressions each time.
 *
 * A rule whose pattern does not compile is dropped rather than thrown: a typo in
 * deployment configuration must not be able to stop the host from recording
 * anything at all.
 *
 * @param options - the redaction policy.
 * @returns the compiled rules, in application order.
 */
export function compileRules(options: RedactionOptions): CompiledRule[] {
  const compiled: CompiledRule[] = []
  for (const rule of options.rules) {
    const flags = rule.flags === undefined ? 'gu' : `${rule.flags.replace(/[gy]/gu, '')}gu`
    try {
      compiled.push({
        name: rule.name,
        expression: new RegExp(rule.pattern, flags),
        marker: options.marker.replaceAll('{rule}', rule.name),
      })
    } catch {
      continue
    }
  }
  return compiled
}

/**
 * Redact one string.
 * @param text - the text to redact.
 * @param rules - compiled rules, in application order.
 * @returns the redacted text.
 */
export function redactText(text: string, rules: readonly CompiledRule[]): string {
  let result = text
  for (const rule of rules) {
    // `lastIndex` survives a global `replace`, so reset it per value.
    rule.expression.lastIndex = 0
    result = result.replace(rule.expression, rule.marker)
  }
  return result
}

/**
 * Redact every string inside a value, recursing through arrays and plain
 * objects, so a nested metadata payload cannot smuggle a path past the filter.
 *
 * Non-string leaves keep their value and their type: redaction exists to remove
 * secrets, not to reshape the log. Values that are neither plain data nor
 * strings are stringified — an unexpected object must not reach the store
 * unexamined.
 *
 * @param value - the value to walk.
 * @param rules - compiled rules, in application order.
 * @returns an owned value with every string redacted.
 */
export function redactValue(value: unknown, rules: readonly CompiledRule[]): unknown {
  if (typeof value === 'string') return redactText(value, rules)
  if (value === null || typeof value !== 'object') {
    // Numbers, booleans, undefined, and symbols pass through untouched.
    return typeof value === 'symbol' ? redactText(String(value), rules) : value
  }
  if (Array.isArray(value)) return value.map(item => redactValue(item, rules))
  const source = value as Record<string, unknown>
  if (Object.getPrototypeOf(source) !== Object.prototype && Object.getPrototypeOf(source) !== null) {
    return redactText(String(source), rules)
  }
  const copy: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(source)) copy[key] = redactValue(item, rules)
  return copy
}

/**
 * Redact an event's metadata map.
 * @param metadata - the caller-supplied metadata, if any.
 * @param rules - compiled rules, in application order.
 * @returns the redacted map, or `undefined` when there was none.
 */
export function redactMetadata(
  metadata: Record<string, unknown> | undefined,
  rules: readonly CompiledRule[],
): Record<string, unknown> | undefined {
  if (metadata === undefined) return undefined
  return redactValue(metadata, rules) as Record<string, unknown>
}
