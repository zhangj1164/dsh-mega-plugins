/**
 * Bilingual README pairing verifier for the dsh-mega-plugins monorepo.
 *
 * Enforces complete English/Chinese pairs, matching Markdown structure,
 * language switchers, and recorded git blob hashes for every package README.
 *
 * Usage:
 *   pnpm run verify-translation-pairing               # check all pairs
 *   pnpm run verify-translation-pairing --list        # show status
 *   pnpm run verify-translation-pairing --write --all # record all pairs
 *   pnpm run verify-translation-pairing --write packages/foo/README.md
 *
 * A pair is three sibling files: README.md, README.zh.md, README.i18n.yaml.
 * Both languages carry equal authority; after editing either side, bring the
 * other along and re-record with --write.
 */

import { createHash } from 'node:crypto'
import { existsSync, globSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')

// ─── CLI parsing ───────────────────────────────────────────────

interface CliRequest {
  mode: 'check' | 'write' | 'list'
  scope: 'all' | 'pairs'
  anchors: string[]
}

function parseArgs(argv: string[]): CliRequest {
  const args = argv.slice(2)
  let mode: CliRequest['mode'] = 'check'
  let list = false
  let write = false
  const anchors: string[] = []

  for (const arg of args) {
    if (arg === '--list') list = true
    else if (arg === '--write') write = true
    else if (arg === '--all') { /* scope all */ }
    else if (arg.startsWith('--')) {
      console.error(`verify-translation-pairing: unknown option ${JSON.stringify(arg)}`)
      process.exit(2)
    } else {
      anchors.push(arg.replace(/\.i18n\.yaml$/, '.md').replace(/\.zh\.md$/, '.md'))
    }
  }

  if (write && list) {
    console.error('verify-translation-pairing: --write and --list are mutually exclusive')
    process.exit(2)
  }

  return {
    mode: write ? 'write' : list ? 'list' : 'check',
    scope: anchors.length > 0 ? 'pairs' : 'all',
    anchors,
  }
}

const request = parseArgs(process.argv)

// ─── Git blob hash ─────────────────────────────────────────────

/** Compute a full SHA-1 Git blob hash for content. */
function gitBlobHash(content: Buffer): string {
  const hash = createHash('sha1')
  hash.update(`blob ${content.byteLength}\0`)
  hash.update(content)
  return hash.digest('hex')
}

/** Store working-tree bytes in the local Git object database and return the object ID. */
function storeGitBlob(content: Buffer): string {
  const result = spawnSync('git', ['hash-object', '-w', '--stdin'], {
    input: content,
    cwd: root,
  })
  if (result.error || result.status !== 0) {
    throw new Error(`git hash-object failed: ${result.error?.message ?? result.stderr.toString('utf8').trim()}`)
  }
  return result.stdout.toString('utf8').trim()
}

// ─── Pair paths ────────────────────────────────────────────────

interface PairPaths {
  source: string
  zh: string
  meta: string
}

function translationPairPaths(source: string): PairPaths {
  return {
    source,
    zh: source.replace(/\.md$/, '.zh.md'),
    meta: source.replace(/\.md$/, '.i18n.yaml'),
  }
}

// ─── Consistency record ────────────────────────────────────────

interface PairingRecord {
  sourceHash: string
  zhHash: string
}

const META_LINE = /^([^:#]+\.md): ([0-9a-f]{40})$/

function parsePairingRecord(content: string, paths: PairPaths): PairingRecord | undefined {
  const hashes = new Map<string, string>()
  for (const line of content.split('\n')) {
    if (line === '' || line.startsWith('#')) continue
    const match = META_LINE.exec(line)
    if (!match?.[1] || !match[2] || hashes.has(match[1])) return undefined
    hashes.set(match[1], match[2])
  }
  const sourceHash = hashes.get(basename(paths.source))
  const zhHash = hashes.get(basename(paths.zh))
  if (hashes.size !== 2 || sourceHash === undefined || zhHash === undefined) return undefined
  return { sourceHash, zhHash }
}

function renderPairingRecord(paths: PairPaths, record: PairingRecord): string {
  return [
    '# Bilingual-pair consistency record: the git blob hash of each',
    '# side as of the last confirmed-consistent state. Both languages carry equal authority;',
    '# after editing either side, bring the other along and re-record with:',
    `#   pnpm run verify-translation-pairing --write ${paths.source}`,
    `${basename(paths.source)}: ${record.sourceHash}`,
    `${basename(paths.zh)}: ${record.zhHash}`,
    '',
  ].join('\n')
}

// ─── File helpers ──────────────────────────────────────────────

function readFile(file: string): Buffer | undefined {
  const full = join(root, file)
  if (!existsSync(full) || !statSync(full).isFile()) return undefined
  return readFileSync(full)
}

function fileExists(file: string): boolean {
  return readFile(file) !== undefined
}

// ─── Markdown structure comparison ─────────────────────────────

interface MarkdownStructure {
  headings: { level: number; text: string }[]
  codeFences: { info: string; lines: number }[]
  tableRows: number[]
  listTypes: ('ordered' | 'unordered')[]
}

function parseMarkdownStructure(text: string): MarkdownStructure {
  const headings: { level: number; text: string }[] = []
  const codeFences: { info: string; lines: number }[] = []
  const tableRows: number[] = []
  const listTypes: ('ordered' | 'unordered')[] = []
  let inCodeBlock = false
  let codeInfo = ''
  let codeLines = 0
  let inTable = false
  let tableLineCount = 0

  for (const line of text.split('\n')) {
    const fenceMatch = /^(\s*)(```|~~~)(.*)$/.exec(line)
    if (fenceMatch) {
      if (!inCodeBlock) {
        inCodeBlock = true
        codeInfo = fenceMatch[3]?.trim() ?? ''
        codeLines = 0
      } else {
        codeFences.push({ info: codeInfo, lines: codeLines })
        inCodeBlock = false
      }
      continue
    }
    if (inCodeBlock) {
      codeLines++
      continue
    }
    const headingMatch = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
    if (headingMatch) {
      headings.push({ level: headingMatch[1].length, text: headingMatch[2]!.trim() })
      inTable = false
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (!inTable) { inTable = true; tableLineCount = 0 }
      tableLineCount++
      continue
    } else if (inTable) {
      tableRows.push(tableLineCount)
      inTable = false
    }
    if (/^\s*[-*+]\s/.test(line)) {
      listTypes.push('unordered')
    } else if (/^\s*\d+\.\s/.test(line)) {
      listTypes.push('ordered')
    }
  }
  if (inTable) tableRows.push(tableLineCount)
  return { headings, codeFences, tableRows, listTypes }
}

function structureSignature(s: MarkdownStructure): string {
  return JSON.stringify({
    headings: s.headings.map(h => `${'#'.repeat(h.level)} `),
    codeFenceCount: s.codeFences.length,
    codeFenceInfo: s.codeFences.map(f => f.info),
    tableRowCounts: s.tableRows,
    listTypes: s.listTypes,
  })
}

// ─── Language switcher check ───────────────────────────────────

function hasLanguageSwitcher(text: string, targetBasename: string): boolean {
  const pattern = new RegExp(`\\[(?:English|中文|中文)\\]\\(${targetBasename.replace(/\./g, '\\.')}\\)`, 'u')
  return pattern.test(text)
}

// ─── Discover pairs ────────────────────────────────────────────

const SCOPE_PATTERNS = ['README.md', 'README.zh.md', 'README.i18n.yaml', 'packages/**/README.md', 'packages/**/README.zh.md', 'packages/**/README.i18n.yaml']

const allFiles = new Set<string>()
for (const pattern of SCOPE_PATTERNS) {
  for (const match of globSync(pattern, { cwd: root })) {
    allFiles.add(match.split(sep).join('/'))
  }
}

const sources = [...allFiles].filter(f => f.endsWith('.README.md') || (f.endsWith('README.md') && !f.endsWith('.zh.md'))).sort()
const translations = [...allFiles].filter(f => f.endsWith('.zh.md')).sort()
const metas = [...allFiles].filter(f => f.endsWith('.i18n.yaml')).sort()

// Build pair anchors from the union of all three file kinds
const pairAnchors = new Set<string>()
for (const s of sources) pairAnchors.add(s)
for (const t of translations) pairAnchors.add(t.replace(/\.zh\.md$/, '.md'))
for (const m of metas) pairAnchors.add(m.replace(/\.i18n\.yaml$/, '.md'))

let checkAnchors: string[]
if (request.scope === 'pairs') {
  checkAnchors = request.anchors
  for (const a of request.anchors) {
    if (!pairAnchors.has(a) && !fileExists(a)) {
      console.error(`verify-translation-pairing: ${a} names no pair on disk`)
      process.exit(2)
    }
  }
} else {
  checkAnchors = [...pairAnchors].sort()
}

// ─── --write mode ──────────────────────────────────────────────

if (request.mode === 'write') {
  let written = 0
  for (const source of checkAnchors) {
    const paths = translationPairPaths(source)
    const sourceContent = readFile(source)
    const zhContent = readFile(paths.zh)
    if (sourceContent === undefined || zhContent === undefined) {
      if (request.scope === 'pairs') {
        console.error(`verify-translation-pairing: cannot record ${source}: missing ${sourceContent === undefined ? source : paths.zh}`)
        process.exit(2)
      }
      continue
    }
    const record = renderPairingRecord(paths, {
      sourceHash: storeGitBlob(sourceContent),
      zhHash: storeGitBlob(zhContent),
    })
    const metaPath = join(root, paths.meta)
    if (existsSync(metaPath) && readFileSync(metaPath, 'utf8') === record) continue
    writeFileSync(metaPath, record)
    console.log(`verify-translation-pairing: recorded ${paths.meta}`)
    written++
  }
  console.log(`verify-translation-pairing: ${written} record(s) written; run the check to validate the pairs.`)
  process.exit(0)
}

// ─── check / list mode ────────────────────────────────────────

const errors: string[] = []
const state = new Map<string, 'ok' | 'out-of-sync' | 'missing'>()

// 1. Every discovered source must have a counterpart
for (const source of sources) {
  const { zh } = translationPairPaths(source)
  if (!fileExists(zh)) {
    errors.push(`${source}: in-scope README must have a bilingual counterpart; add README.zh.md and record the pair`)
    state.set(source, 'missing')
  }
}

// 2. Every pair that exists at all is complete and consistent
for (const source of checkAnchors) {
  const paths = translationPairPaths(source)
  const have = {
    source: fileExists(source),
    zh: fileExists(paths.zh),
    meta: fileExists(paths.meta),
  }

  const missing = Object.entries(have).filter(([, ok]) => !ok).map(([k]) => k === 'source' ? source : k === 'zh' ? paths.zh : paths.meta)
  if (missing.length > 0) {
    errors.push(`${source}: incomplete pair — missing ${missing.join(', ')}`)
    continue
  }

  const sourceContent = readFile(source)!
  const zhContent = readFile(paths.zh)!
  const metaContent = readFile(paths.meta)!
  const record = parsePairingRecord(metaContent.toString('utf8'), paths)
  if (record === undefined) {
    errors.push(`${paths.meta}: malformed consistency record (expected \`${basename(source)}: <40-hex>\` and \`${basename(paths.zh)}: <40-hex>\`)`)
    continue
  }

  // Check blob hashes
  let consistent = true
  const sourceCurrent = gitBlobHash(sourceContent)
  const zhCurrent = gitBlobHash(zhContent)
  if (record.sourceHash !== sourceCurrent) {
    errors.push(`${source}: out of sync — content no longer matches the recorded hash in ${paths.meta}`)
    consistent = false
  }
  if (record.zhHash !== zhCurrent) {
    errors.push(`${paths.zh}: out of sync — content no longer matches the recorded hash in ${paths.meta}`)
    consistent = false
  }
  if (!consistent) {
    state.set(source, 'out-of-sync')
    continue
  }

  // Check language switchers
  const sourceText = sourceContent.toString('utf8')
  const zhText = zhContent.toString('utf8')
  if (!hasLanguageSwitcher(zhText, basename(source))) {
    errors.push(`${paths.zh}: missing language switcher — no link back to ${basename(source)}`)
  }
  if (!hasLanguageSwitcher(sourceText, basename(paths.zh))) {
    errors.push(`${source}: missing language switcher — no link to ${basename(paths.zh)}`)
  }

  // Check structural signature
  const sourceStruct = parseMarkdownStructure(sourceText)
  const zhStruct = parseMarkdownStructure(zhText)
  const sourceSig = structureSignature(sourceStruct)
  const zhSig = structureSignature(zhStruct)
  if (sourceSig !== zhSig) {
    errors.push(`${source} ↔ ${paths.zh}: Markdown structure differs — headings, code fences, tables, or lists do not match`)
  }

  if (!state.has(source)) state.set(source, 'ok')
}

// Complete state for --list
for (const source of sources) {
  if (!state.has(source)) state.set(source, 'missing')
}

if (request.mode === 'list') {
  const order = { 'out-of-sync': 0, missing: 1, ok: 2 } as const
  const rows = [...state.entries()].sort((a, b) => order[a[1]] - order[b[1]] || a[0].localeCompare(b[0]))
  for (const [file, status] of rows) {
    console.log(`${status.padEnd(11)} ${file}${status === 'missing' ? '  (required)' : ''}`)
  }
  const counts = { ok: 0, 'out-of-sync': 0, missing: 0 }
  for (const status of state.values()) counts[status]++
  console.log(`verify-translation-pairing: ${counts.ok} ok, ${counts['out-of-sync']} out-of-sync, ${counts.missing} missing (of ${state.size} in scope)`)
  process.exit(0)
}

if (errors.length === 0) {
  console.log(`verify-translation-pairing: ${checkAnchors.length} pair(s) checked, all consistent.`)
  process.exit(0)
}

console.error('verify-translation-pairing: bilingual pairing rules violated:')
for (const message of errors) console.error(`  ${message}`)
process.exit(1)
