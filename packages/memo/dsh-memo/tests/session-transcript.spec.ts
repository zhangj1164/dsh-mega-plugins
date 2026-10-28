import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MAX_MESSAGE_CHARS,
  extractSessionMessages,
  isSubagentSession,
  renderSessionTranscript,
  renderSourceAnnotation,
  sessionTitleOrFallback,
  type SessionSurfaceEventLike,
} from '../src/session-transcript.ts'

/** One text block. */
function text(value: string): { type: 'text'; text: string } {
  return { type: 'text', text: value }
}

describe('extractSessionMessages', () => {
  it('keeps user and assistant text and skips system, tool, and synthesized turns', () => {
    const events: SessionSurfaceEventLike[] = [
      { type: 'system/message', seq: 1, data: { content: [text('system')] } },
      { type: 'developer/message', seq: 2, data: { content: [text('developer')] } },
      { type: 'user/message', seq: 3, data: { message: { content: [text('hello')], source: { kind: 'user' } } } },
      { type: 'assistant/message', seq: 4, data: { message: { content: [text('world')] } } },
      { type: 'tool/result', seq: 5, data: { message: { content: [text('tool')] } } },
      { type: 'user/message', seq: 6, data: { message: { content: [text('synthesized')], source: { kind: 'tool' } } } },
    ]
    expect(extractSessionMessages(events)).toEqual([
      { role: 'user', text: 'hello', seq: 3 },
      { role: 'assistant', text: 'world', seq: 4 },
    ])
  })

  it('accepts message fields placed directly in data', () => {
    const messages = extractSessionMessages([
      { type: 'user/message', seq: 1, data: { content: 'direct', source: { kind: 'user' } } },
    ])
    expect(messages).toEqual([{ role: 'user', text: 'direct', seq: 1 }])
  })

  it('joins only text blocks and skips empty messages', () => {
    const messages = extractSessionMessages([
      { type: 'assistant/message', seq: 1, data: { message: { content: [text('a'), { type: 'tool-call' }, text('b')] } } },
      { type: 'assistant/message', seq: 2, data: { message: { content: [text('   ')] } } },
    ])
    expect(messages).toEqual([{ role: 'assistant', text: 'a\nb', seq: 1 }])
  })
})

describe('renderSessionTranscript', () => {
  it('keeps every message when the budget allows', () => {
    const transcript = renderSessionTranscript([
      { role: 'user', text: 'hello', seq: 1 },
      { role: 'assistant', text: 'world', seq: 2 },
    ], { maxChars: 1_000 })
    expect(transcript.text).toBe('User: hello\n\nAssistant: world')
    expect(transcript.truncated).toBe(false)
    expect(transcript.elidedMessages).toBe(0)
  })

  it('returns an empty render for an empty conversation', () => {
    expect(renderSessionTranscript([], { maxChars: 1_000 })).toEqual({
      text: '',
      messageCount: 0,
      elidedMessages: 0,
      truncated: false,
    })
  })

  it('keeps the head and tail and marks the elided middle', () => {
    const messages = Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      text: `message-${index}-${'x'.repeat(80)}`,
      seq: index,
    }))
    const transcript = renderSessionTranscript(messages, { maxChars: 500 })
    expect(transcript.truncated).toBe(true)
    expect(transcript.elidedMessages).toBeGreaterThan(0)
    expect(transcript.text).toContain('omitted')
    expect(transcript.text).toContain('message-0-')
    expect(transcript.text).toContain('message-9-')
    expect(transcript.text.length).toBeLessThanOrEqual(500)
  })

  it('truncates one over-long message and marks it', () => {
    const transcript = renderSessionTranscript([
      { role: 'user', text: 'y'.repeat(DEFAULT_MAX_MESSAGE_CHARS + 500), seq: 1 },
    ], { maxChars: 20_000 })
    expect(transcript.text).toContain('(truncated)')
    expect(transcript.text.length).toBeLessThanOrEqual(DEFAULT_MAX_MESSAGE_CHARS + 40)
  })

  it('does not split a surrogate pair at the cut', () => {
    const transcript = renderSessionTranscript([
      { role: 'user', text: 'a'.repeat(9) + '😀😀', seq: 1 },
    ], { maxChars: 20_000, maxMessageChars: 10 })
    // The cut would land between the two halves of the first emoji; the helper
    // backs off one code unit instead of emitting a lone surrogate.
    expect(transcript.text).not.toContain('\ud83d')
  })
})

describe('renderSourceAnnotation', () => {
  it('substitutes the documented placeholders', () => {
    expect(renderSourceAnnotation('\n\n来源会话：{sessionId}', {
      sessionId: 'session-a',
      sessionTitle: 'Fix CI',
    })).toBe('\n\n来源会话：session-a')
    expect(renderSourceAnnotation('[{sessionTitle}]({sessionId})', {
      sessionId: 'session-a',
      sessionTitle: 'Fix CI',
    })).toBe('[Fix CI](session-a)')
  })

  it('leaves unknown placeholders untouched', () => {
    expect(renderSourceAnnotation('{sessionId} {unknown}', {
      sessionId: 'session-a',
      sessionTitle: 'Fix CI',
    })).toBe('session-a {unknown}')
  })
})

describe('sessionTitleOrFallback', () => {
  it('trims a real title and falls back to a short id', () => {
    expect(sessionTitleOrFallback('  Fix CI  ', 'session-a')).toBe('Fix CI')
    expect(sessionTitleOrFallback('   ', 'session-abcdef')).toBe('Session session-')
    expect(sessionTitleOrFallback(undefined, '')).toBe('Session')
  })
})

describe('isSubagentSession', () => {
  it('recognizes only the subagent origin', () => {
    expect(isSubagentSession({ origin: 'subagent' })).toBe(true)
    expect(isSubagentSession({ origin: undefined })).toBe(false)
    expect(isSubagentSession(undefined)).toBe(false)
  })
})
