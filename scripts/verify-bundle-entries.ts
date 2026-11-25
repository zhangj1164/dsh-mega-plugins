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
 * The same scan answers a second question: does the inserting bundle actually
 * ship the package its row names? A profile installs a bundle's `dependencies`
 * and generated profiles set `autoInstallPeers: false`, so a row naming a peer
 * can never be imported — the loader reports `ERR_MODULE_NOT_FOUND`, the entry
 * stays inactive, and the panel it would have rendered never appears. This
 * repository shipped exactly that: the memo bundle inserted a `ui-memo` row for
 * a package it declared only as a peer, so installing the memo service alone
 * left the sidebar without a memo entry.
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
  /** Entry rows the patch inserts, in file order. */
  rows: InsertRow[]
  /** Entry ids the patch inserts, in file order. */
  ids: string[]
  /** Verbatim patch contents, for the documented-exclusion check. */
  raw: string
}

/** One composition entry a patch inserts. */
export interface InsertRow {
  /** Entry id the patch inserts. */
  id: string
  /** Package the row composes, when the patch names one. */
  name?: string
}

/** One package this workspace publishes. */
export interface WorkspacePackage {
  /** Package name from its manifest. */
  name: string
  /** Package directory, absolute. */
  dir: string
  /** Runtime dependencies, package name to declared range. */
  dependencies: Record<string, string>
}

/** One inserted row that no profile could import. */
export interface UninstallableRow {
  /** Bundle that inserts the row. */
  bundle: string
  /** The entry id inserted. */
  id: string
  /** Package the row composes. */
  name: string
  /** Human-readable description of the defect. */
  detail: string
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
  dependencies?: Record<string, string>
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
 * Extract the rows one patch inserts, each with the package it names.
 * @param text - patch file contents.
 * @param source - label used in error messages.
 * @returns the rows in file order.
 */
export function parseInsertRows(text: string, source: string): InsertRow[] {
  const rows: InsertRow[] = []
  // `^\s*` deliberately matches a tab: the patch shape is fixed and this is a
  // scan, not a YAML parser.
  const linePattern = /^[ \t]*(?:-[ \t]+)?insert:[ \t]*$/u
  const idPattern = /^([ \t]*)-[ \t]+id:[ \t]*(\S.*?)[ \t]*$/u
  const namePattern = /^([ \t]*)name:[ \t]*(\S.*?)[ \t]*$/u

  let inInsert = false
  let current: InsertRow | undefined
  let rowIndent = 0
  for (const raw of text.split(/\r?\n/u)) {
    const line = stripComment(raw).replace(/\s+$/u, '')
    if (line.trim() === '') continue

    if (linePattern.test(line)) {
      inInsert = true
      continue
    }
    if (!inInsert) continue

    const idMatch = idPattern.exec(line)
    if (idMatch?.[2] !== undefined) {
      rowIndent = idMatch[1]!.length
      current = { id: unquote(idMatch[2]) }
      rows.push(current)
      continue
    }
    // A row's `name:` is the one aligned with its `id:`; a deeper key belongs
    // to a nested config block and a shallower one to the enclosing object.
    if (current === undefined || current.name !== undefined) continue
    const nameMatch = namePattern.exec(line)
    if (nameMatch?.[2] !== undefined && nameMatch[1]!.length === rowIndent + 2) {
      current.name = unquote(nameMatch[2])
    }
  }

  if (rows.length === 0) {
    throw new Error(`verify-bundle-entries: ${source} declares a bundle patch but inserts no entry id.`)
  }
  return rows
}

/**
 * Extract the entry ids one patch inserts.
 * @param text - patch file contents.
 * @param source - label used in error messages.
 * @returns the ids in file order.
 */
export function parseInsertIds(text: string, source: string): string[] {
  return parseInsertRows(text, source).map(row => row.id)
}

/**
 * Strip the quotes a YAML scalar may carry.
 * @param value - scalar as written.
 * @returns the scalar without surrounding quotes.
 */
function unquote(value: string): string {
  return value.replace(/^["']|["']$/gu, '')
}

/**
 * Report every entry id inserted more than once, and whether the patches record
 * the mutual exclusion that makes the overlap safe.
 *
 * Two bundles inserting one id is not an intended property of this repository:
 * every entry id has exactly one owning bundle, which is what lets any subset
 * of the suite be installed together. The exclusion check is kept as the belt
 * to that braces — a shared id whose patches both record the exclusion is
 * reported rather than failed, so a deliberate overlap can be reintroduced
 * later with its reasoning written down. A repeat inside one patch always
 * fails.
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
 * Report every inserted row that names a workspace package its bundle does not
 * ship.
 *
 * Two rules, both consequences of how a deployment installs a bundle:
 *
 * - The package a row names must be a runtime `dependency` of the inserting
 *   bundle. A profile installs a bundle's dependencies; with
 *   `autoInstallPeers: false` it never installs a peer, so a row naming a peer
 *   resolves to nothing and the entry stays inactive.
 * - That dependency must be a plain range, not `workspace:`. `pnpm publish`
 *   rewrites a `workspace:` range, but a manifest pnpm reads straight out of a
 *   git checkout is never rewritten, and pnpm then refuses the install with
 *   `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`. `linkWorkspacePackages` keeps the local
 *   checkout linked without that protocol.
 *
 * A row naming a package outside this workspace is left alone: the gate cannot
 * see whether that package installs, so it reports only what it can prove.
 * @param bundles - bundles to inspect.
 * @param workspace - every package this workspace publishes.
 * @returns every uninstallable row found, in bundle order.
 */
export function findUninstallableRows(
  bundles: readonly Bundle[],
  workspace: readonly WorkspacePackage[],
): UninstallableRow[] {
  const shipped = new Map(workspace.map(pkg => [pkg.name, pkg]))
  const found: UninstallableRow[] = []

  for (const bundle of bundles) {
    const owner = shipped.get(bundle.package)
    if (owner === undefined) continue
    for (const row of bundle.rows) {
      const target = row.name === undefined ? undefined : shipped.get(row.name)
      // A row composing the bundle's own package needs no dependency edge.
      if (target === undefined || target.name === owner.name) continue

      const range = owner.dependencies[target.name]
      if (range === undefined) {
        found.push({
          bundle: bundle.package,
          id: row.id,
          name: target.name,
          detail: `${owner.name} inserts entry ${JSON.stringify(row.id)} as ${JSON.stringify(target.name)}, but its manifest does not depend on it. A profile installs a bundle's dependencies and never its peers, so the row cannot be imported.`,
        })
        continue
      }
      if (range.startsWith('workspace:')) {
        found.push({
          bundle: bundle.package,
          id: row.id,
          name: target.name,
          detail: `${owner.name} depends on ${JSON.stringify(target.name)} with the range ${JSON.stringify(range)}. A git-installed manifest is never rewritten, so pnpm refuses that install with ERR_PNPM_WORKSPACE_PKG_NOT_FOUND; declare a plain range and let pnpm-workspace.yaml link the checkout.`,
        })
      }
    }
  }

  return found
}

/**
 * Read every package this workspace publishes.
 * @returns packages with their directory and declared runtime dependencies.
 */
export function readWorkspacePackages(): WorkspacePackage[] {
  const found: WorkspacePackage[] = []
  for (const relative of globSync('packages/*/*/package.json', { cwd: root }).sort()) {
    const path = join(root, relative)
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
    if (typeof manifest.name !== 'string') continue
    found.push({
      name: manifest.name,
      dir: dirname(path),
      dependencies: { ...manifest.dependencies },
    })
  }
  return found
}

/**
 * Read every bundle patch from the workspace.
 * @returns bundles with their parsed entry rows, sorted by package name.
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
      const rows = parseInsertRows(raw, relative)
      return {
        package: candidate.package,
        dir: candidate.dir,
        patchPath,
        rows,
        ids: rows.map(row => row.id),
        raw,
      }
    })
    .sort((left, right) => left.package.localeCompare(right.package))
}

function main(): number {
  const bundles = readBundles()
  const collisions = findCollisions(bundles)
  const uninstallable = findUninstallableRows(bundles, readWorkspacePackages())

  if (collisions.length === 0 && uninstallable.length === 0) {
    const summary = bundles
      .map(bundle => `${bundle.package} [${bundle.rows.map(row => (row.name === undefined ? row.id : `${row.id} -> ${row.name}`)).join(', ')}]`)
      .join('; ')
    console.log(`verify-bundle-entries: ${bundles.length} bundle patch(es), every entry id unique and every row installable.`)
    console.log(`  ${summary}`)
    return 0
  }

  if (collisions.length > 0) {
    console.error('verify-bundle-entries: bundles that would collide in one composition:')
    for (const collision of collisions) console.error(`  ${collision.detail}`)
    console.error(`\n${collisions.length} colliding entry id(s).`)
    console.error('The loader rejects a duplicate entry id, and a bundle layer cannot remove an earlier insert.')
    console.error('Give each bundle its own ids, or make the colliding bundles mutually exclusive by construction.')
  }

  if (uninstallable.length > 0) {
    console.error('verify-bundle-entries: rows a profile could never import:')
    for (const row of uninstallable) console.error(`  ${row.detail}`)
    console.error(`\n${uninstallable.length} uninstallable entry row(s).`)
    console.error('Name each row\'s package in the bundle\'s own dependencies, with a plain range.')
  }

  return 1
}

if (import.meta.main) {
  process.exitCode = main()
}
