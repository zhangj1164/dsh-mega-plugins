/**
 * Credential resolution through a configured shell command.
 *
 * A deployment that has no token in its environment reads one from a command
 * such as `gh auth token`. That command must survive the host's startup, where
 * DSH can block its event loop for ten seconds or more: a deadline enforced by
 * a plain timer is delivered late in that window, and a late deadline must
 * adopt a command that already finished rather than discard its output.
 *
 * @module @zhangj1164/dsh-github-issue/token-command
 */

import { exec } from 'node:child_process'

/** The most token-command output this service buffers; a credential is far smaller. */
const TOKEN_COMMAND_MAX_BUFFER = 64 * 1024

/** Raised when the configured token command outlives its deadline. */
export class TokenCommandTimeoutError extends Error {
  /**
   * @param timeoutMs - the deadline the command exceeded.
   */
  constructor(timeoutMs: number) {
    super('the token command did not finish within ' + timeoutMs + 'ms')
    this.name = 'TokenCommandTimeoutError'
  }
}

/**
 * Run the configured token command under a deadline that survives a stalled event loop.
 *
 * `exec`'s own `timeout` option is a timer on the event loop: when the process
 * stays busy past the deadline, that timer fires only after the command already
 * finished, and its result is then lost. The host blocks its event loop for ten
 * seconds or more while it starts up, which was enough to turn a working
 * `gh auth token` into a missing credential for the rest of the process. This
 * helper starts the child without a built-in timeout and checks the child's
 * real state when its own timer fires, so a late deadline adopts a command that
 * already finished and stops one that is still running. Killing the child
 * signals the shell `exec` started; on Windows a grandchild such as `gh.exe`
 * can outlive that shell, so the deadline bounds how long this service waits
 * rather than guaranteeing the process tree is gone.
 *
 * @param command - the shell command whose stdout is the token.
 * @param timeoutMs - the longest the command may be allowed to run.
 * @returns the command's stdout.
 */
export function runTokenCommand(command: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = exec(command, { windowsHide: true, maxBuffer: TOKEN_COMMAND_MAX_BUFFER }, (error, stdout) => {
      if (error === null) resolve(stdout)
      else reject(error)
    })
    const deadline = setTimeout(() => {
      setImmediate(() => {
        if (child.exitCode !== null || child.signalCode !== null) return
        child.kill()
        reject(new TokenCommandTimeoutError(timeoutMs))
      })
    }, timeoutMs)
    child.once('close', () => clearTimeout(deadline))
  })
}

/**
 * Describe why a token command produced no credential, without leaking its output.
 *
 * The report distinguishes a command that ran and failed from one that could not
 * start at all: `ENOENT` means the shell never found the program, while any
 * other code — including an over-long output buffer — means it ran and still
 * produced no usable token.
 * @param error - the command failure.
 * @returns a message safe to put in a user-visible failure and in telemetry.
 */
export function tokenCommandProblem(error: unknown): string {
  if (error instanceof TokenCommandTimeoutError) return error.message
  const code = (error as { code?: unknown }).code
  if (typeof code === 'number') return 'the token command exited with code ' + code
  if (code === 'ENOENT') return 'the token command could not be run'
  if (typeof code === 'string') return 'the token command failed (' + code + ')'
  return 'the token command could not be run'
}
