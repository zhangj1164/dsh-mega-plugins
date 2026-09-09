/**
 * Run local and CI quality gates with bounded in-process scheduling.
 *
 * Package scripts own public aggregate names; this runner owns their validated
 * dependency graphs, scheduler environment, and process diagnostics. Adapted
 * from the DeepSeek Harness run-gates.ts for the dsh-mega-plugins monorepo.
 */
import { spawn } from 'node:child_process'
import { availableParallelism } from 'node:os'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { pnpmInvocation } from './pnpm-invocation.ts'

/** A named aggregate exposed by the gate runner. */
export type Mode = 'check-all' | 'hygiene' | 'doc-sync'

type GateResultStatus = 'passed' | 'failed' | 'skipped'
type GateState = 'pending' | 'running' | GateResultStatus

/** A command and its dependency metadata inside one aggregate. */
export interface Gate {
  id: string
  label: string
  displayCommand: string
  command: string
  args: string[]
  needs?: string[]
  after?: string[]
  env?: Record<string, string | undefined>
  allowFailure?: boolean
  streamOutput?: boolean
}

/** The observed outcome of one gate process. */
export interface GateResult {
  gate: Gate
  status: GateResultStatus
  durationMs: number
  output: GateOutputChunk[]
  exitCode: number | null
  signalCode: NodeJS.Signals | null
  error?: string
}

interface GateOutputChunk {
  stream: 'stdout' | 'stderr'
  text: string
}

interface RunningGate {
  gate: Gate
  promise: Promise<GateResult>
}

interface ConcurrencyDefault {
  workers: number
  source: string
}

type GateExecutor = (gate: Gate) => Promise<GateResult>
type ResultObserver = (result: GateResult) => void

const root = resolve(import.meta.dirname, '..')
if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2))
}

async function main(args: string[]): Promise<number> {
  const mode = parseMode(args[0])
  const gates = gatesForMode(mode)
  const concurrencyDefault = defaultConcurrency(mode, gates.length)
  const concurrencyOverride = process.env.DSH_GATE_CONCURRENCY
  const maxConcurrency = concurrencyFromEnv('DSH_GATE_CONCURRENCY', concurrencyDefault.workers)
  const concurrencySource = concurrencyOverride === undefined || concurrencyOverride === ''
    ? concurrencyDefault.source
    : '$DSH_GATE_CONCURRENCY'
  const startedAt = performance.now()
  console.log(`run-gates: ${mode} running ${gates.length} gate(s) with ${maxConcurrency} worker(s) from ${concurrencySource}.`)

  const results = await runGates(gates, maxConcurrency, runGate, printResult)
  printSummary(results, performance.now() - startedAt)
  return results.some(result => result.gate.allowFailure !== true && (result.status === 'failed' || result.status === 'skipped'))
    ? 1
    : 0
}

function parseMode(raw: string | undefined): Mode {
  switch (raw) {
    case 'check-all':
    case 'hygiene':
    case 'doc-sync':
      return raw
    default:
      throw new Error(
        `run-gates: expected mode check-all | hygiene | doc-sync, got ${JSON.stringify(raw)}.`,
      )
  }
}

/**
 * Resolve the default worker count for one aggregate.
 * @param selectedMode - aggregate whose resource posture applies.
 * @param total - number of gates in the aggregate.
 * @param available - host CPU availability for ordinary modes.
 * @returns the default worker count and its diagnostic source.
 */
export function defaultConcurrency(
  selectedMode: Mode,
  total: number,
  available = availableParallelism(),
): ConcurrencyDefault {
  // Local modes cap workers: several doc gates each build a full ts.Program,
  // so an uncapped default on a large host trades wall clock for memory blowups.
  const localCap = selectedMode === 'check-all' || selectedMode === 'hygiene' || selectedMode === 'doc-sync'
  const modeLimit = localCap ? Math.min(4, available) : available
  return {
    workers: Math.min(total, modeLimit),
    source: localCap
      ? `${available} available CPU(s), ${selectedMode} cap 4`
      : `${available} available CPU(s)`,
  }
}

function concurrencyFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`run-gates: ${name} must be a positive integer, got ${JSON.stringify(raw)}.`)
  }
  return parsed
}

function pnpmScript(id: string, script: string, options: Partial<Gate> = {}): Gate {
  return {
    id,
    label: options.label ?? script,
    displayCommand: `pnpm run ${script}`,
    ...pnpmInvocation(['run', script]),
    ...options,
  }
}

function pnpmExec(id: string, args: string[], options: Partial<Gate> = {}): Gate {
  return {
    id,
    label: options.label ?? `pnpm exec ${args.join(' ')}`,
    displayCommand: `pnpm exec ${args.join(' ')}`,
    ...pnpmInvocation(['exec', ...args]),
    ...options,
  }
}

/** Build a gate that runs `node --test` on a test file. */
function nodeGate(id: string, args: string[], options: Partial<Gate> = {}): Gate {
  const allArgs = ['--test', ...args]
  return {
    id,
    label: options.label ?? `node ${allArgs.join(' ')}`,
    displayCommand: `node ${allArgs.join(' ')}`,
    command: process.execPath,
    args: allArgs,
    ...options,
  }
}

/**
 * Construct the complete gate list for a named aggregate.
 * @param selected - aggregate mode to construct.
 * @returns the aggregate's gate graph.
 */
export function gatesForMode(selected: Mode): Gate[] {
  switch (selected) {
    case 'check-all':
      return [
        pnpmScript('test', 'test'),
        pnpmScript('build', 'build'),
        ...hygieneLeafGates({ artifactNeeds: ['build'] }),
        ...docSyncLeafGates(),
        nodeGate('issue-policy', ['.github/issue-management/policy.test.mjs'], {
          label: 'issue management policy',
        }),
      ]
    case 'hygiene':
      return hygieneLeafGates()
    case 'doc-sync':
      return docSyncLeafGates()
  }
}

function hygieneLeafGates(options: { artifactNeeds?: string[] } = {}): Gate[] {
  return [
    pnpmScript('export-jsdoc', 'verify-export-jsdoc', { label: 'export jsdoc' }),
  ]
}

function docSyncLeafGates(): Gate[] {
  return [
    pnpmScript('translation-pairing', 'verify-translation-pairing', { label: 'translation pairing' }),
    pnpmScript('markdown-links', 'verify-md-links', { label: 'markdown links' }),
    pnpmScript('markdown-wrap', 'verify-md-wrap', { label: 'markdown wrap' }),
  ]
}

/**
 * Reject a gate list whose graph cannot be executed unambiguously.
 * @param gates - complete aggregate to validate.
 */
function validateGateGraph(gates: readonly Gate[]): void {
  if (gates.length === 0) throw new Error('run-gates: gate graph has no gates.')

  const ids = new Set<string>()
  for (const gate of gates) {
    if (ids.has(gate.id)) throw new Error(`run-gates: duplicate gate id ${JSON.stringify(gate.id)}.`)
    ids.add(gate.id)
  }
  for (const gate of gates) {
    for (const dependency of gate.needs ?? []) {
      if (!ids.has(dependency)) {
        throw new Error(`run-gates: gate ${JSON.stringify(gate.id)} depends on unknown gate ${JSON.stringify(dependency)}.`)
      }
    }
    for (const predecessor of gate.after ?? []) {
      if (!ids.has(predecessor)) {
        throw new Error(`run-gates: gate ${JSON.stringify(gate.id)} waits for unknown gate ${JSON.stringify(predecessor)}.`)
      }
    }
  }

  const cycle = findDependencyCycle(gates)
  if (cycle !== undefined) throw new Error(`run-gates: dependency cycle: ${cycle.join(' -> ')}.`)
}

function findDependencyCycle(gates: readonly Gate[]): string[] | undefined {
  const byId = new Map(gates.map(gate => [gate.id, gate]))
  const complete = new Set<string>()
  const active = new Map<string, number>()
  const path: string[] = []

  const visit = (id: string): string[] | undefined => {
    if (complete.has(id)) return undefined
    const cycleStart = active.get(id)
    if (cycleStart !== undefined) return [...path.slice(cycleStart), id]
    const gate = byId.get(id)
    if (gate === undefined) return undefined

    active.set(id, path.length)
    path.push(id)
    for (const predecessor of [...(gate.needs ?? []), ...(gate.after ?? [])]) {
      const cycle = visit(predecessor)
      if (cycle !== undefined) return cycle
    }
    path.pop()
    active.delete(id)
    complete.add(id)
    return undefined
  }

  for (const gate of gates) {
    const cycle = visit(gate.id)
    if (cycle !== undefined) return cycle
  }
  return undefined
}

/**
 * Validate and run one aggregate before the injected executor can start a child.
 * @param gates - complete aggregate to execute.
 * @param maxActive - maximum concurrent child count.
 * @param execute - child-process executor.
 * @param observe - result observer invoked when each gate settles.
 * @returns results in aggregate order.
 */
export async function runGates(
  gates: Gate[],
  maxActive: number,
  execute: GateExecutor,
  observe: ResultObserver = () => {},
): Promise<GateResult[]> {
  validateGateGraph(gates)
  if (!Number.isSafeInteger(maxActive) || maxActive < 1) {
    throw new Error(`run-gates: max concurrency must be a positive integer, got ${JSON.stringify(maxActive)}.`)
  }
  const states = new Map<string, GateState>(gates.map(gate => [gate.id, 'pending']))
  const results = new Map<string, GateResult>()
  const running: RunningGate[] = []

  for (;;) {
    let madeProgress = false
    while (running.length < maxActive) {
      const ready = gates.find(gate => states.get(gate.id) === 'pending' && predecessorsReady(gate, states))
      if (ready === undefined) break
      states.set(ready.id, 'running')
      running.push({ gate: ready, promise: execute(ready) })
      console.log(`run-gates: start ${ready.label}`)
      madeProgress = true
    }

    if (running.length === 0) {
      const pending = gates.filter(gate => states.get(gate.id) === 'pending')
      if (pending.length === 0) break
      const gate = pending.find(item => (item.needs ?? []).some(id => gateFailed(states.get(id))))
      if (gate === undefined) throw new Error('run-gates: validated graph stalled without a failed dependency.')
      const failedDeps = (gate.needs ?? []).filter(id => gateFailed(states.get(id)))
      const result: GateResult = {
        gate,
        status: 'skipped',
        durationMs: 0,
        output: [],
        exitCode: null,
        signalCode: null,
        error: `dependency failed or skipped: ${failedDeps.join(', ')}`,
      }
      states.set(gate.id, 'skipped')
      results.set(gate.id, result)
      observe(result)
      continue
    }

    if (!madeProgress) {
      const settled = await Promise.race(running.map(async item => ({ item, result: await item.promise })))
      running.splice(running.indexOf(settled.item), 1)
      states.set(settled.item.gate.id, settled.result.status)
      results.set(settled.item.gate.id, settled.result)
      observe(settled.result)
    }
  }

  return gates.map((gate) => {
    const result = results.get(gate.id)
    if (result === undefined) throw new Error(`run-gates: missing result for ${gate.id}.`)
    return result
  })
}

function predecessorsReady(gate: Gate, states: Map<string, GateState>): boolean {
  return (gate.needs ?? []).every(id => states.get(id) === 'passed')
    && (gate.after ?? []).every(id => gateSettled(states.get(id)))
}

function gateSettled(state: GateState | undefined): boolean {
  return state === 'passed' || state === 'failed' || state === 'skipped'
}

function gateFailed(state: GateState | undefined): boolean {
  return state === 'failed' || state === 'skipped'
}

/**
 * Execute one gate through the real shell-free child-process boundary.
 * @param gate - command and scheduler environment to execute.
 * @returns the complete process outcome.
 */
export async function runGate(gate: Gate): Promise<GateResult> {
  const started = performance.now()
  const output: GateOutputChunk[] = []
  let spawnError: string | undefined

  const outcome = await new Promise<{
    exitCode: number | null
    signalCode: NodeJS.Signals | null
  }>((resolveExit) => {
    const child = spawn(gate.command, gate.args, {
      cwd: root,
      env: { ...process.env, ...gate.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (gate.streamOutput === true) process.stdout.write(chunk)
      else output.push({ stream: 'stdout', text: chunk })
    })
    child.stderr.on('data', (chunk: string) => {
      if (gate.streamOutput === true) process.stderr.write(chunk)
      else output.push({ stream: 'stderr', text: chunk })
    })
    child.on('error', (error) => {
      spawnError = `failed to start command: ${error.message}`
      resolveExit({ exitCode: null, signalCode: null })
    })
    child.on('close', (exitCode, signalCode) => {
      resolveExit({ exitCode, signalCode })
    })
    child.stdin.end()
  })
  const { exitCode, signalCode } = outcome

  const status: GateResultStatus = exitCode === 0 && signalCode === null && spawnError === undefined ? 'passed' : 'failed'
  const result: GateResult = {
    gate,
    status,
    durationMs: performance.now() - started,
    output,
    exitCode,
    signalCode,
  }
  if (spawnError !== undefined) result.error = spawnError
  return result
}

/**
 * Format every independently observed failure fact for the aggregate summary.
 * @param result - unsuccessful gate result.
 * @returns error, exit, and signal facts without allowing one to hide another.
 */
export function formatGateResultReason(result: GateResult): string {
  const facts: string[] = []
  if (result.error !== undefined) facts.push(result.error)
  if (result.exitCode !== null) facts.push(`exit ${result.exitCode}`)
  if (result.signalCode !== null) facts.push(`signal ${result.signalCode}`)
  return facts.length === 0 ? 'no exit code or signal' : facts.join(', ')
}

function printResult(result: GateResult): void {
  const verbose = process.env.DSH_GATE_VERBOSE === '1'
  const seconds = (result.durationMs / 1000).toFixed(2)
  if (result.status === 'passed' && !verbose) {
    console.log(`run-gates: PASS ${result.gate.label} (${seconds}s)`)
    return
  }

  const heading = `${result.status.toUpperCase()} ${result.gate.label} (${seconds}s)`
  const writeHeading = result.status === 'passed' ? console.log : console.error
  writeHeading(`\n== ${heading} ==`)
  if (result.status !== 'passed') {
    console.error(`command: ${result.gate.displayCommand}`)
    console.error(`outcome: ${formatGateResultReason(result)}`)
  }
  if (result.gate.streamOutput !== true) printOutput(result.output)
}

function printSummary(results: GateResult[], durationMs: number): void {
  const passed = results.filter(result => result.status === 'passed').length
  const failed = results.filter(result => result.status === 'failed').length
  const skipped = results.filter(result => result.status === 'skipped').length
  const seconds = (durationMs / 1000).toFixed(2)
  console.log(`\nrun-gates: ${passed} passed, ${failed} failed, ${skipped} skipped in ${seconds}s.`)

  const unsuccessful = results.filter(result => result.status === 'failed' || result.status === 'skipped')
  if (unsuccessful.length === 0) return

  console.error('run-gates: unsuccessful gates:')
  for (const result of unsuccessful) {
    const duration = (result.durationMs / 1000).toFixed(2)
    const reason = formatGateResultReason(result)
    const disposition = result.gate.allowFailure === true ? 'NON-BLOCKING ' : ''
    console.error(`  - ${disposition}${result.status.toUpperCase()} ${result.gate.label} (${duration}s, ${reason})`)
    console.error(`    ${result.gate.displayCommand}`)
  }
}

function printOutput(output: GateOutputChunk[]): void {
  for (const chunk of output) {
    if (chunk.stream === 'stdout') process.stdout.write(chunk.text)
    else process.stderr.write(chunk.text)
  }
}
