/**
 * Pure helpers that turn one archived session's model-visible surface into a
 * bounded prompt, and render the source annotation appended to a summary entry.
 *
 * The host service owns the RPC orchestration; everything here is deterministic
 * and has no dependency on Cordis, storage, or a concrete session package, so the
 * extraction and budgeting rules are directly testable.
 *
 * @module @zhangj1164/dsh-memo/session-transcript
 */

/** The two roles a session summary cares about. */
export type SessionTranscriptRole = 'user' | 'assistant'

/**
 * Minimal shape of one `sessionQuery.readSurface` event this module needs.
 * Declared structurally so the memo package does not depend on the concrete
 * session event types.
 */
export interface SessionSurfaceEventLike {
  /** Event discriminant (`user/message`, `assistant/message`, …). */
  readonly type: string
  /** Monotonic event sequence within the session. */
  readonly seq: number
  /** Event payload; its shape is validated defensively below. */
  readonly data?: unknown
}

/** One extracted conversation turn. */
export interface SessionTranscriptMessage {
  /** Who produced the text. */
  readonly role: SessionTranscriptRole
  /** Concatenated text blocks of the message. */
  readonly text: string
  /** Source event sequence, preserved for ordering and debugging. */
  readonly seq: number
}

/** Character budgets applied when rendering a transcript. */
export interface SessionTranscriptLimits {
  /** Maximum characters of the rendered transcript. */
  readonly maxChars: number
  /** Maximum characters of one message before it is truncated. */
  readonly maxMessageChars?: number
}

/** One rendered transcript plus what was dropped to fit the budget. */
export interface SessionTranscript {
  /** The rendered prompt text. */
  readonly text: string
  /** How many user/assistant messages the session actually holds. */
  readonly messageCount: number
  /** How many messages the budget omitted from the middle. */
  readonly elidedMessages: number
  /** Whether anything at all was truncated or elided. */
  readonly truncated: boolean
}

/**
 * Per-message ceiling.
 *
 * A protocol constant rather than a `Config` field: it exists so one runaway
 * tool dump cannot consume the whole transcript budget, and the total budget is
 * the deployment-tunable value.
 */
export const DEFAULT_MAX_MESSAGE_CHARS = 4_000

/** Text appended to a message that was too long to include whole. */
const TRUNCATED_MESSAGE_SUFFIX = ' …(truncated)'

/** Text inserted between the kept head and tail of an over-budget transcript. */
function elisionMarker(messages: number, chars: number): string {
  return `… (omitted ${messages} messages, ${chars} characters) …`
}

/** Narrow an unknown value to a string-keyed record. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

/**
 * Slice at whole UTF-16 surrogate pairs, so a cut never produces a lone half of
 * an emoji or a CJK extension character.
 * @param text - the text to slice.
 * @param end - the exclusive end offset.
 * @returns the prefix that does not split a surrogate pair.
 */
function sliceWholeCharacters(text: string, end: number): string {
  if (end <= 0) return ''
  if (end >= text.length) return text
  const previous = text.charCodeAt(end - 1)
  const next = text.charCodeAt(end)
  const splitsPair = previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
  return text.slice(0, splitsPair ? end - 1 : end)
}

/** Concatenate the text blocks of one message content value. */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const block of content) {
      if (typeof block === 'string') {
        parts.push(block)
        continue
      }
      const record = asRecord(block)
      if (record === undefined || record.type !== 'text' || typeof record.text !== 'string') continue
      parts.push(record.text)
    }
    return parts.join('\n')
  }
  const record = asRecord(content)
  if (record !== undefined && record.type === 'text' && typeof record.text === 'string') return record.text
  return ''
}

/**
 * Extract the human-visible conversation from a session surface.
 *
 * Surface events wrap the actual message in `data.message`; an older or simpler
 * producer may put the message fields directly in `data`, so both are accepted.
 * Tool results, system/developer messages, tool-generated user messages, and
 * non-text content are skipped: a summary is about what the user and assistant
 * said, not about every byte a tool returned.
 *
 * @param events - the session's current surface events.
 * @returns the user/assistant turns in log order.
 */
export function extractSessionMessages(events: readonly SessionSurfaceEventLike[]): SessionTranscriptMessage[] {
  const messages: SessionTranscriptMessage[] = []
  for (const event of events) {
    const role: SessionTranscriptRole | undefined = event.type === 'user/message'
      ? 'user'
      : event.type === 'assistant/message' ? 'assistant' : undefined
    if (role === undefined) continue
    const data = asRecord(event.data)
    const message = asRecord(data?.message) ?? data
    if (message === undefined) continue
    if (role === 'user') {
      const source = asRecord(message.source)
      const kind = source?.kind
      // Tool results and other synthesized prompts are not the user's own words.
      if (typeof kind === 'string' && kind !== 'user') continue
    }
    const text = contentText(message.content)
    if (text.trim().length === 0) continue
    messages.push({ role, text, seq: event.seq })
  }
  return messages
}

/** Render one turn as a labelled line, truncating an over-long message. */
function renderedLine(message: SessionTranscriptMessage, maxMessageChars: number): string {
  const label = message.role === 'user' ? 'User' : 'Assistant'
  const text = message.text.length > maxMessageChars
    ? `${sliceWholeCharacters(message.text, maxMessageChars)}${TRUNCATED_MESSAGE_SUFFIX}`
    : message.text
  return `${label}: ${text}`
}

/**
 * Render a transcript inside a total character budget.
 *
 * Whole messages are kept in order while they fit. Once the budget is exceeded,
 * the head and the tail are kept and the middle is replaced by one marker: a
 * work session usually states its goal at the start and its outcome at the end,
 * so dropping the middle preserves the parts a weekly summary needs most.
 *
 * @param messages - the extracted turns.
 * @param limits - the total and per-message budgets.
 * @returns the rendered transcript and what was dropped.
 */
export function renderSessionTranscript(
  messages: readonly SessionTranscriptMessage[],
  limits: SessionTranscriptLimits,
): SessionTranscript {
  if (messages.length === 0) {
    return { text: '', messageCount: 0, elidedMessages: 0, truncated: false }
  }
  const maxChars = Math.max(1, Math.floor(limits.maxChars))
  const maxMessageChars = Math.max(1, Math.floor(limits.maxMessageChars ?? DEFAULT_MAX_MESSAGE_CHARS))
  const lines = messages.map(message => renderedLine(message, maxMessageChars))
  const full = lines.join('\n\n')
  if (full.length <= maxChars) {
    return { text: full, messageCount: messages.length, elidedMessages: 0, truncated: false }
  }

  // Reserve room for the marker and the two joins around it up front, so the
  // final text stays inside the budget even when every message was elided.
  const markerBudget = elisionMarker(messages.length, full.length).length
  const keptBudget = Math.max(2, maxChars - markerBudget - 4)
  const headBudget = Math.floor(keptBudget * 0.5)
  const tailBudget = keptBudget - headBudget

  const head: string[] = []
  let headChars = 0
  for (const line of lines) {
    const next = headChars === 0 ? line.length : headChars + 2 + line.length
    if (next > headBudget) break
    head.push(line)
    headChars = next
  }
  if (head.length === 0) {
    const clipped = sliceWholeCharacters(lines[0] ?? '', headBudget)
    if (clipped.length > 0) head.push(clipped)
    headChars = clipped.length
  }

  const tail: string[] = []
  let tailChars = 0
  for (let index = lines.length - 1; index >= head.length; index -= 1) {
    const line = lines[index] ?? ''
    const next = tailChars === 0 ? line.length : tailChars + 2 + line.length
    if (next > tailBudget) break
    tail.unshift(line)
    tailChars = next
  }
  if (tail.length === 0 && head.length < lines.length) {
    const last = lines[lines.length - 1] ?? ''
    const clipped = sliceWholeCharacters(last, tailBudget)
    if (clipped.length > 0) tail.push(clipped)
    tailChars = clipped.length
  }

  const kept = head.length + tail.length
  const elided = Math.max(0, messages.length - kept)
  const elidedChars = Math.max(0, full.length - headChars - tailChars)
  const marker = elisionMarker(elided, elidedChars)
  const text = [...head, marker, ...tail].join('\n\n')
  return {
    text,
    messageCount: messages.length,
    elidedMessages: elided,
    truncated: true,
  }
}

/**
 * Render the configured source annotation for one summary.
 *
 * Only the two documented placeholders are substituted; any other braces are
 * left alone, because the template is deployment-owned text rather than a
 * general expression language.
 *
 * @param template - the configured template.
 * @param facts - the session id and title to substitute.
 * @returns the annotation text, exactly as configured apart from substitution.
 */
export function renderSourceAnnotation(
  template: string,
  facts: { readonly sessionId: string; readonly sessionTitle: string },
): string {
  return template
    .replaceAll('{sessionId}', facts.sessionId)
    .replaceAll('{sessionTitle}', facts.sessionTitle)
}

/**
 * A session's display title, or a short-id fallback when it has none.
 * @param title - the log-backed title, when one exists.
 * @param sessionId - the session id.
 * @returns the title to show and to substitute into the annotation template.
 */
export function sessionTitleOrFallback(title: string | undefined, sessionId: string): string {
  const trimmed = title?.trim() ?? ''
  if (trimmed.length > 0) return trimmed
  const shortId = sessionId.slice(0, 8)
  return shortId.length > 0 ? `Session ${shortId}` : 'Session'
}

/**
 * Whether a session header marks the session as a subagent child.
 *
 * Subagent sessions are the model's own delegation, not the user's work; they
 * would flood the picker and each summarize into a near-duplicate of its parent.
 * @param header - the session header, when it is available.
 * @returns whether the session is a subagent child.
 */
export function isSubagentSession(header: { readonly origin?: string } | undefined): boolean {
  return header?.origin === 'subagent'
}
