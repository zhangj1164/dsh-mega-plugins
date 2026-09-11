/**
 * Shared model-text helper for host services that ask a model for a single
 * block of text.
 *
 * The DSH LLM runtime normalizes every adapter, credential, routing, and
 * transport failure into a terminal `finish` chunk carrying an
 * {@link LlmFailure}. Collapsing that into a bare `undefined` destroys the
 * only actionable facts — the machine-routing `code` (`NO_ADAPTER`,
 * `MISSING_CREDENTIAL`, `AUTH`, `RATE_LIMIT`, …), the provider-neutral
 * message, and the HTTP status — and makes a misconfigured provider route
 * indistinguishable from a model that legitimately returned nothing.
 *
 * This helper therefore reports the two outcomes separately: a successful
 * text result, or a terminal-failure result that preserves the DSH facts.
 * An empty successful stream is reported as `EMPTY_RESPONSE`, the code DSH
 * itself reserves for that condition.
 *
 * @module dsh-memo/llm-text
 */

import { EMPTY_RESPONSE_CODE, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, Message, StreamChunk } from '@deepseek-ai/dsh-llm'

/**
 * Minimal shape of the DSH `llm` service this helper needs. Declared
 * structurally so a caller never has to depend on the concrete service class.
 */
export interface LlmTextSource {
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}

/** The model route a request should be sent to. */
export interface LlmRoute {
  /** Registered DSH provider route, or an empty string when unresolved. */
  readonly provider: string
  /** Model id, or an empty string when unresolved. */
  readonly model: string
}

/** Serializable failure facts preserved from a DSH terminal `finish` chunk. */
export interface LlmTextFailure {
  /** DSH provider-neutral machine-routing code (`NO_ADAPTER`, `AUTH`, …). */
  readonly code: string
  /** DSH human-readable failure message. */
  readonly message: string
  /** HTTP status returned by the provider, when DSH supplied one. */
  readonly status?: number
}

/**
 * The outcome of one model text call: either the concatenated text, or the
 * reason the call produced no text.
 */
export type LlmTextResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly failure: LlmTextFailure }

/**
 * Stream one model call and collect its text output.
 *
 * @param llm - the DSH `llm` service, or `undefined` when it is not mounted.
 * @param route - the provider and model to call.
 * @param system - system prompt text.
 * @param userText - user message text.
 * @returns the collected text, or the preserved terminal-failure facts.
 */
export async function streamLlmText(
  llm: LlmTextSource | undefined,
  route: LlmRoute,
  system: string,
  userText: string,
): Promise<LlmTextResult> {
  if (llm === undefined) {
    return { ok: false, failure: { code: 'LLM_UNAVAILABLE', message: 'the llm service is not mounted' } }
  }
  if (route.provider.length === 0 || route.model.length === 0) {
    return {
      ok: false,
      failure: {
        code: 'NO_MODEL_ROUTE',
        message: 'no model route is configured; set the provider and model on this service or on agent-default-model',
      },
    }
  }
  const message = createUserMessage({
    content: [{ type: 'text', text: userText }],
    source: { kind: 'user' },
  })
  const options: GenerateOptions = {
    provider: route.provider,
    model: route.model,
    messages: [message as Message],
    system,
  }
  let text = ''
  try {
    for await (const chunk of llm.stream(options)) {
      if (chunk.type === 'text-delta') {
        text += chunk.text
      } else if (chunk.type === 'finish' && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
        const failure = chunk.reason.failure
        return {
          ok: false,
          failure: {
            code: failure.code,
            message: failure.message,
            ...(failure.status === undefined ? {} : { status: failure.status }),
          },
        }
      }
    }
  } catch (error) {
    // A transport-level throw that escaped DSH's normalization still carries
    // the actionable message; keep it instead of reporting an empty call.
    return {
      ok: false,
      failure: {
        code: 'LLM_STREAM_THREW',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
  if (text.length === 0) {
    return {
      ok: false,
      failure: { code: EMPTY_RESPONSE_CODE, message: 'the model returned no text for this request' },
    }
  }
  return { ok: true, text }
}
