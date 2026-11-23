import { describe, expect, it } from 'vitest'
import { runTokenCommand, TokenCommandTimeoutError, tokenCommandProblem } from '../src/token-command.ts'

/** Block the event loop for the given time, as the host does while it starts up. */
function stall(milliseconds: number): void {
  const until = Date.now() + milliseconds
  while (Date.now() < until) {
    // stall the event loop
  }
}

describe('runTokenCommand', () => {
  it('adopts a command that finished before its deadline fired late', async () => {
    const pending = runTokenCommand(`"${process.execPath}" -e "process.stdout.write('tok')"`, 1000)
    stall(2500)
    await expect(pending).resolves.toBe('tok')
  })

  it('stops a command that is still running when the deadline fires', async () => {
    const pending = runTokenCommand('node -e "setTimeout(function(){}, 1500)"', 1000)
    await expect(pending).rejects.toBeInstanceOf(TokenCommandTimeoutError)
    await expect(pending).rejects.toThrow('did not finish within 1000ms')
  })

  it('passes through the exit code of a command that ran and failed', async () => {
    const error = await runTokenCommand('exit 1', 1000).then(
      () => undefined,
      (failure: unknown) => failure,
    )
    expect(error).not.toBeInstanceOf(TokenCommandTimeoutError)
    expect((error as { code?: unknown }).code).toBe(1)
  })

  it('resolves an empty string when the command printed nothing', async () => {
    await expect(runTokenCommand('exit 0', 1000)).resolves.toBe('')
  })
})

describe('tokenCommandProblem', () => {
  it('reports a timeout with the deadline it exceeded', () => {
    expect(tokenCommandProblem(new TokenCommandTimeoutError(1000))).toBe('the token command did not finish within 1000ms')
  })

  it('reports an exit code for a command that ran', () => {
    expect(tokenCommandProblem({ code: 1 })).toBe('the token command exited with code 1')
  })

  it('does not confuse an over-long output with a command that never ran', () => {
    expect(tokenCommandProblem({ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' })).toBe(
      'the token command failed (ERR_CHILD_PROCESS_STDIO_MAXBUFFER)',
    )
  })

  it('reports a missing executable as one that could not be run', () => {
    expect(tokenCommandProblem({ code: 'ENOENT' })).toBe('the token command could not be run')
  })

  it('falls back when the failure carries no code', () => {
    expect(tokenCommandProblem(new Error('nope'))).toBe('the token command could not be run')
  })
})
