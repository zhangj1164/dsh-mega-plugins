/**
 * Reject two DSH bundles that would insert the same composition entry id.
 *
 * A deployment composes its plugin tree from `dsh.profile.bundles`, an explicit
 * ordered list with no transitive resolution: each bundle's `cordis.patch.yml`
 * is applied in turn over the entry list. A bundle layer cannot remove or
 * override an insert from an earlier layer, so when two enabled bundles insert
 * the same id the loader has no way to reconcile them and rejects the
 * duplicate outright. The deployment then fails to start, and nothing in the
 * bundle's own repository or tests showed the conflict.
 *
 * This gate refuses to publish that configuration. It reads every workspace
 * package that declares `dsh.bundle`, extracts the entry ids its patch inserts,
 * and fails when two different bundles insert the same id — or when a single
 * patch inserts one id twice.
 *
 * The gate's limit is deliberate and worth stating: it can only see the bundles
 * this repository ships. A deployment that enables two mutually exclusive
 * patch layers through its own profile is outside the repository, and no gate
 * here can observe it. That case stays a documented constraint.
 *
 * The patch files are parsed by a targeted scan rather than a YAML parser: the
 * insert shape is fixed and the scan needs no dependency the workspace does not
 * already own.
 */
import { existsSync, globSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

/** One bundle that contributes a patch layer. */
export interface Bundle {
  /** Package name from its manifest. */
  package: string
  /** Package directory, absolute. */
  dir: string
  /** Absolute path of the patch file the bundle declares. */
  patchPath: string
  /** Entry ids the patch inserts, in file order. */
  ids: string[]
  /** Verbatim patch contents, for the documented-exclusion check. */
  raw: string
}

/** One collision the gate refuses to ship. */
export interface Collision {
  /** The entry id inserted more than once. */
  id: string
  /** Human-readable description of where the repeats are. */
  detail: string
}

interface PackageManifest {
  name?: string
  dsh?: { bundle?: { patch?: unknown } }
}

/**
 * Find every workspace package that declares a bundle patch.
 * @returns candidates with their package directory and patch target.
 */
function candidates(): { package: string, dir: string, patch: string }[] {
  const found: { package: string, dir: string, patch: string }[] = []
  for (const relative of globSync('packages/*/*/package.json', { cwd: root }).sort()) {
    const path = join(root, relative)
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
    const patch = manifest.dsh?.bundle?.patch
    if (typeof patch !== 'string') continue
    found.push({ package: manifest.name ?? relative, dir: dirname(path), patch })
  }
  return found
}

/**
 * Strip a YAML comment from one line.
 *
 * A `#` inside a quoted scalar is data, not a comment, so quoting is honored.
 * @param line - raw line.
 * @returns the line without its trailing comment.
 */
function stripComment(line: string): string {
  let quote: string | undefined
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (quote !== undefined) {
      if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '#') return line.slice(0, index)
  }
  return line
}

/**
 * Extract the entry ids one patch inserts.
 * @param text - patch file contents.
 * @param source - label used in error messages.
 * @returns the ids in file order.
 */
export function parseInsertIds(text: string, source: string): string[] {
  const ids: string[] = []
  // `^\s*` deliberately matches a tab: the patch shape is fixed and this is a
  // scan, not a YAML parser.
  const linePattern = /^[ \t]*(?:-[ \t]+)?insert:[ \t]*$/u
  const idPattern = /^[ \t]*-[ \t]+id:[ \t]*(\S.*?)[ \t]*$/u

  let inInsert = false
  for (const raw of text.split(/\r?\n/u)) {
    const line = stripComment(raw).replace(/\s+$/u, '')
    if (line.trim() === '') continue

    if (linePattern.test(line)) {
      inInsert = true
      continue
    }
    if (!inInsert) continue
    const match = idPattern.exec(line)
    if (match?.[1] !== undefined) {
      ids.push(match[1].replace(/^["']|["']$/gu, ''))
    }
  }

  if (ids.length === 0) {
    throw new Error(`verify-bundle-entries: ${source} declares a bundle patch but inserts no entry id.`)
  }
  return ids
}

/**
 * Report every entry id inserted more than once, and whether the patches record
 * the mutual exclusion that makes the overlap safe.
 *
 * Two bundles inserting one id is a real property of this repository rather
 * than a mistake: `dsh-memo` carries the `github-issue` row so a deployment
 * that only wanted the memo suite does not have to enable two bundles, and
 * `dsh-github-issue` inserts the same row for a deployment that wanted the
 * service alone. Both patch files state outright that the two must not be
 * enabled together. The gate therefore does not forbid the overlap — it
 * forbids an *undocumented* one. A new bundle that quietly inserts an id an
 * existing bundle owns fails here, and so does a repeat inside one patch.
 * @param bundles - bundles to inspect.
 * @returns every collision found, in bundle order.
 */
export function findCollisions(bundles: readonly Bundle[]): Collision[] {
  const collisions: Collision[] = []

  for (const bundle of bundles) {
    const seen = new Map<string, number>()
    for (const id of bundle.ids) seen.set(id, (seen.get(id) ?? 0) + 1)
    for (const [id, count] of seen) {
      if (count > 1) {
        collisions.push({
          id,
          detail: `${bundle.package} inserts ${JSON.stringify(id)} ${count} times in one patch`,
        })
      }
    }
  }

  const owners = new Map<string, Bundle[]>()
  for (const bundle of bundles) {
    for (const id of new Set(bundle.ids)) {
      owners.set(id, [...(owners.get(id) ?? []), bundle])
    }
  }
  for (const [id, sharing] of owners) {
    if (sharing.length < 2) continue
    const names = sharing.map(bundle => JSON.stringify(bundle.package)).join(' and ')
    const undocumented = sharing.filter(bundle => !mentionsExclusion(bundle.raw, id))
    if (undocumented.length > 0) {
      collisions.push({
        id,
        detail: `${names} both insert ${JSON.stringify(id)}, but ${undocumented.map(bundle => JSON.stringify(bundle.package)).join(' and ')} does not record it as mutually exclusive`,
      })
      continue
    }
    console.log(`verify-bundle-entries: ${names} share ${JSON.stringify(id)}; both patches record the exclusion.`)
  }

  return collisions
}

/**
 * Whether a patch's own prose records that the entry id is mutually exclusive
 * with another bundle's.
 *
 * Two facts must both appear, so a patch that only mentions a neighbouring
 * bundle by name does not satisfy the check:
 *
 * - the marker `not both`, which is what makes the statement an exclusion
 *   rather than a description; and
 * - the colliding id itself, not embedded in a longer id. Prose puts ordinary
 *   punctuation right after an id (`github-issue;`), so the boundary is stated
 *   negatively: neither neighbour may be a word character or a hyphen. That
 *   accepts punctuation while rejecting `github-issue-x`.
 * @param raw - verbatim patch contents.
 * @param id - the entry id shared with another bundle.
 * @returns true when the patch records the exclusion.
 */
export function mentionsExclusion(raw: string, id: string): boolean {
  if (!raw.toLowerCase().includes('not both')) return false
  const isIdCharacter = (char: string): boolean => /[A-Za-z0-9_-]/u.test(char)
  let from = 0
  for (;;) {
    const at = raw.indexOf(id, from)
    if (at === -1) return false
    const before = at === 0 ? '' : raw[at - 1]!
    const afterIndex = at + id.length
    const after = afterIndex >= raw.length ? '' : raw[afterIndex]!
    if (!isIdCharacter(before) && !isIdCharacter(after)) return true
    from = at + 1
  }
}

/**
 * Read every bundle patch from the workspace.
 * @returns bundles with their parsed entry ids, sorted by package name.
 */
export function readBundles(): Bundle[] {
  return candidates()
    .map((candidate) => {
      const patchPath = resolve(candidate.dir, candidate.patch)
      if (!existsSync(patchPath)) {
        throw new Error(`verify-bundle-entries: ${candidate.package} declares a patch at ${candidate.patch} that does not exist.`)
      }
      const relative = patchPath.slice(root.length + 1).replace(/\\/gu, '/')
      const raw = readFileSync(patchPath, 'utf8')
      return {
        package: candidate.package,
        dir: candidate.dir,
        patchPath,
        ids: parseInsertIds(raw, relative),
        raw,
      }
    })
    .sort((left, right) => left.package.localeCompare(right.package))
}

function main(): number {
  const bundles = readBundles()
  const collisions = findCollisions(bundles)

  if (collisions.length === 0) {
    const summary = bundles.map(bundle => `${bundle.package} [${bundle.ids.join(', ')}]`).join('; ')
    console.log(`verify-bundle-entries: ${bundles.length} bundle patch(es), no duplicate entry id.`)
    console.log(`  ${summary}`)
    return 0
  }

  console.error('verify-bundle-entries: bundles that would collide in one composition:')
  for (const collision of collisions) console.error(`  ${collision.detail}`)
  console.error(`\n${collisions.length} colliding entry id(s).`)
  console.error('The loader rejects a duplicate entry id, and a bundle layer cannot remove an earlier insert.')
  console.error('Give each bundle its own ids, or make the colliding bundles mutually exclusive by construction.')
  return 1
}

if (import.meta.main) {
  process.exitCode = main()
}
