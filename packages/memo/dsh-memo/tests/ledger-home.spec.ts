import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import type { MemoMemoryEntry } from '../src/types.ts'
import type { TestHarness } from './harness.ts'
import { setupHarness } from './harness.ts'

/**
 * Where the AI-analysis ledger lives.
 *
 * The ledger is the one memo artifact written straight to the filesystem
 * rather than the storage domain, so its path has to follow DSH's own home
 * contract: an explicit `$DSH_HOME`, otherwise `~/.dsh`. These cases pin that
 * contract, the one-time migration of the ledger an earlier resolver left in
 * the platform home, and the read/write symmetry between `analyze` and
 * `listMemory`.
 */

const savedEnv = {
  DSH_HOME: process.env.DSH_HOME,
  USERPROFILE: process.env.USERPROFILE,
  HOME: process.env.HOME,
}

const tempDirs: string[] = []
const harnesses: TestHarness[] = []

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map(h => h.dispose()))
  restoreEnvironment()
})

afterAll(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A fresh temp directory this case owns, removed by the file-level cleanup. */
function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `dsh-memo-ledger-${tag}-`))
  tempDirs.push(dir)
  return dir
}

/** Point the platform home at `dir`, as a host started from that home would see it. */
function setPlatformHome(dir: string): void {
  process.env.USERPROFILE = dir
  process.env.HOME = dir
}

/** Put the environment back exactly as the test process found it. */
function restoreEnvironment(): void {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

/** Mount the service with the ledger environment the case set up. */
async function harness(): Promise<TestHarness> {
  const created = await setupHarness({ ledgerHome: 'inherit' })
  harnesses.push(created)
  return created
}

/** One persisted analysis in the shape the ledger stores. */
function memoryEntry(id: string, generatedAt: number): MemoMemoryEntry {
  return {
    id,
    period: 'week',
    periodLabel: '2026-W01',
    analysisType: '总结',
    summary: `summary ${id}`,
    generatedAt,
  }
}

/** Write a ledger document to `file`, creating its directory. */
function seedLedger(file: string, entries: readonly MemoMemoryEntry[]): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ schemaVersion: 1, analyses: entries }, null, 2), 'utf8')
}

/** Read a ledger document back off disk. */
function readLedgerFile(file: string): { schemaVersion: number; analyses: readonly MemoMemoryEntry[] } {
  return JSON.parse(readFileSync(file, 'utf8')) as { schemaVersion: number; analyses: readonly MemoMemoryEntry[] }
}

/** The process working directory's entries, for proving a fallback wrote nothing there. */
function cwdEntries(): string[] {
  return readdirSync(process.cwd()).sort()
}

/** Run one successful `analyze`, which is what appends to the ledger. */
async function analyzeOnce(ctx: TestHarness['ctx']): Promise<boolean> {
  const week = await ctx.memo.getOrCreateCurrentWeek({})
  if (!week.ok) return false
  await ctx.memo.addEntry({ weekId: week.value.weekId, type: 'text', content: 'ledger path case' })
  const result = await ctx.memo.analyze({ period: 'week', periodLabel: week.value.weekId, analysisType: '总结' })
  return result.ok
}

describe('memo ledger home resolution', () => {
  it('writes under ~/.dsh when DSH_HOME is unset', async () => {
    const home = tempDir('unset')
    setPlatformHome(home)
    delete process.env.DSH_HOME
    const created = await harness()

    expect(await analyzeOnce(created.ctx)).toBe(true)

    expect(existsSync(join(home, '.dsh', 'memo', 'ledger.json'))).toBe(true)
    expect(existsSync(join(home, 'memo', 'ledger.json'))).toBe(false)
  })

  it('honours an explicit DSH_HOME', async () => {
    const home = tempDir('explicit')
    const dshHome = tempDir('explicit-dsh')
    setPlatformHome(home)
    process.env.DSH_HOME = dshHome
    const created = await harness()

    expect(await analyzeOnce(created.ctx)).toBe(true)

    expect(existsSync(join(dshHome, 'memo', 'ledger.json'))).toBe(true)
    expect(existsSync(join(home, '.dsh', 'memo', 'ledger.json'))).toBe(false)
  })

  it('treats a blank DSH_HOME as unset instead of resolving a relative path', async () => {
    const home = tempDir('blank')
    setPlatformHome(home)
    process.env.DSH_HOME = '   '
    const created = await harness()
    const before = cwdEntries()

    expect(await analyzeOnce(created.ctx)).toBe(true)

    expect(existsSync(join(home, '.dsh', 'memo', 'ledger.json'))).toBe(true)
    expect(cwdEntries()).toEqual(before)
  })

  it('expands a tilde prefix in DSH_HOME against the platform home', async () => {
    const home = tempDir('tilde')
    setPlatformHome(home)
    process.env.DSH_HOME = '~/custom-dsh'
    const created = await harness()
    const before = cwdEntries()

    expect(await analyzeOnce(created.ctx)).toBe(true)

    expect(existsSync(join(home, 'custom-dsh', 'memo', 'ledger.json'))).toBe(true)
    expect(cwdEntries()).toEqual(before)
  })

  it('reads back through listMemory what analyze wrote', async () => {
    const home = tempDir('readback')
    setPlatformHome(home)
    delete process.env.DSH_HOME
    const created = await harness()

    expect(await analyzeOnce(created.ctx)).toBe(true)
    const listed = created.ctx.memo.listMemory({})

    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    expect(listed.value.length).toBe(1)
    expect(existsSync(join(home, '.dsh', 'memo', 'ledger.json'))).toBe(true)
  })
})

describe('legacy ledger migration', () => {
  it('merges the platform-home ledger into the DSH ledger and keeps a receipt', async () => {
    const home = tempDir('migrate')
    setPlatformHome(home)
    delete process.env.DSH_HOME
    const legacy = join(home, 'memo', 'ledger.json')
    seedLedger(legacy, [memoryEntry('legacy-1', 1_000), memoryEntry('legacy-2', 2_000)])
    const created = await harness()

    const listed = created.ctx.memo.listMemory({})

    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    expect(listed.value.map(entry => entry.id).sort()).toEqual(['legacy-1', 'legacy-2'])
    expect(existsSync(legacy)).toBe(false)
    const receipt = `${legacy}.migrated`
    expect(existsSync(receipt)).toBe(true)
    expect(readLedgerFile(receipt).analyses.map(entry => entry.id).sort()).toEqual(['legacy-1', 'legacy-2'])
    expect(readLedgerFile(join(home, '.dsh', 'memo', 'ledger.json')).analyses).toHaveLength(2)
  })

  it('merges once, not on every read', async () => {
    const home = tempDir('idempotent')
    setPlatformHome(home)
    delete process.env.DSH_HOME
    const legacy = join(home, 'memo', 'ledger.json')
    seedLedger(legacy, [memoryEntry('legacy-1', 1_000)])
    const created = await harness()

    created.ctx.memo.listMemory({})
    created.ctx.memo.listMemory({})
    const third = created.ctx.memo.listMemory({})

    expect(third.ok).toBe(true)
    if (!third.ok) return
    expect(third.value.map(entry => entry.id)).toEqual(['legacy-1'])
    expect(readLedgerFile(join(home, '.dsh', 'memo', 'ledger.json')).analyses).toHaveLength(1)
    expect(existsSync(`${legacy}.migrated.2`)).toBe(false)
  })

  it('merges without duplicating an id the new ledger already holds', async () => {
    const home = tempDir('dedupe')
    setPlatformHome(home)
    delete process.env.DSH_HOME
    seedLedger(join(home, '.dsh', 'memo', 'ledger.json'), [memoryEntry('shared', 1_000)])
    seedLedger(join(home, 'memo', 'ledger.json'), [memoryEntry('shared', 1_000), memoryEntry('legacy-only', 2_000)])
    const created = await harness()

    const listed = created.ctx.memo.listMemory({})

    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    expect(listed.value.map(entry => entry.id)).toEqual(['legacy-only', 'shared'])
  })

  it('leaves an unparseable legacy file alone and still answers', async () => {
    const home = tempDir('corrupt')
    setPlatformHome(home)
    delete process.env.DSH_HOME
    const legacy = join(home, 'memo', 'ledger.json')
    mkdirSync(dirname(legacy), { recursive: true })
    writeFileSync(legacy, 'not a ledger', 'utf8')
    const created = await harness()

    const listed = created.ctx.memo.listMemory({})

    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    expect(listed.value).toEqual([])
    expect(existsSync(legacy)).toBe(true)
    expect(existsSync(`${legacy}.migrated`)).toBe(false)
  })

  it('still shows the legacy analyses when the new path cannot be written', async () => {
    const home = tempDir('read-only')
    setPlatformHome(home)
    delete process.env.DSH_HOME
    // A file where the DSH home directory belongs: the merge cannot be saved.
    writeFileSync(join(home, '.dsh'), 'not a directory', 'utf8')
    const legacy = join(home, 'memo', 'ledger.json')
    seedLedger(legacy, [memoryEntry('legacy-1', 1_000)])
    const created = await harness()

    const listed = created.ctx.memo.listMemory({})

    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    expect(listed.value.map(entry => entry.id)).toEqual(['legacy-1'])
    expect(existsSync(legacy)).toBe(true)
    expect(existsSync(`${legacy}.migrated`)).toBe(false)
  })

  it('does not migrate when DSH_HOME points at the platform home itself', async () => {
    const home = tempDir('same-path')
    setPlatformHome(home)
    process.env.DSH_HOME = home
    const current = join(home, 'memo', 'ledger.json')
    seedLedger(current, [memoryEntry('live-1', 1_000)])
    const created = await harness()

    const listed = created.ctx.memo.listMemory({})

    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    expect(listed.value.map(entry => entry.id)).toEqual(['live-1'])
    expect(existsSync(current)).toBe(true)
    expect(existsSync(`${current}.migrated`)).toBe(false)
  })
})
