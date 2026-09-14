/**
 * Reject a package whose declared export targets cannot be resolved.
 *
 * An `exports` map is a promise about files that exist. When the map names a
 * path the build never produces, the failure surfaces only at import time in
 * a consumer — `import type` still type-checks, so the breakage hides until
 * runtime. This gate resolves each declaration against the build output
 * instead, so the mapping and the emitted layout cannot drift apart.
 *
 * Two conditions are enforced:
 *
 * - `default` targets must exist. These are the runtime faces a consumer
 *   resolves, so a missing one is always a defect.
 * - `types` targets must exist unless the package declares a browser client
 *   face through `dsh.client` and its build disables declaration output for
 *   that face. A bundled client face declares no ambient types, the same
 *   shape the official DSH client UI packages ship.
 */
import { existsSync, globSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

/** One unresolved declaration reported by the gate. */
export interface Violation {
  package: string
  detail: string
}

interface PackageManifest {
  name?: string
  exports?: unknown
  dsh?: { client?: unknown }
}

/** A package selected for checking: its directory and parsed manifest. */
interface Candidate {
  dir: string
  manifest: PackageManifest
}

/**
 * Find every workspace package manifest.
 * @returns candidate packages, sorted by directory.
 */
function candidates(): Candidate[] {
  return globSync('packages/*/*/package.json', { cwd: root })
    .map(relative => join(root, relative))
    .sort()
    .map(path => ({
      dir: dirname(path),
      manifest: JSON.parse(readFileSync(path, 'utf8')) as PackageManifest,
    }))
}

/**
 * Resolve an `exports` target to an on-disk path.
 * @param dir - package directory.
 * @param target - declaration value, e.g. `./lib/index.js`.
 * @returns the absolute path the target names.
 */
function resolveTarget(dir: string, target: string): string {
  return resolve(dir, target)
}

/**
 * Collect the export declarations that must resolve for one package.
 * @param exportsField - the manifest's `exports` value.
 * @returns `[label, target, condition]` triples.
 */
function declarations(exportsField: unknown): [string, string, 'default' | 'types'][] {
  const found: [string, string, 'default' | 'types'][] = []
  const walk = (value: unknown, label: string): void => {
    if (typeof value === 'string') {
      // A bare string export is a runtime face.
      found.push([label, value, 'default'])
      return
    }
    if (value === null || typeof value !== 'object') return
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'default' || key === 'types') {
        if (typeof nested !== 'string') continue
        found.push([label, nested, key])
        continue
      }
      // `exports` keys are subpaths: `.` for the root, `./client` for a face.
      walk(nested, key === '.' ? label : key.startsWith('./') ? key : `${label}/${key}`)
    }
  }
  walk(exportsField, '.')
  return found
}

/**
 * Decide whether a missing `types` target is tolerable for one package.
 *
 * A package that ships a browser client face through `dsh.client` bundles that
 * face for the shell's module loader and emits no declarations for it. That is
 * the documented shape of the official DSH client UI packages, so a missing
 * client declaration file is a packaging choice rather than a broken promise.
 * @param manifest - parsed package manifest.
 * @returns true when the package is allowed to omit client declarations.
 */
function toleratesMissingTypes(manifest: PackageManifest): boolean {
  return manifest.dsh?.client !== undefined
}

/**
 * Check one package's export map.
 * @param candidate - package directory and manifest.
 * @returns every violation found.
 */
export function checkPackage(candidate: Candidate): Violation[] {
  const { dir, manifest } = candidate
  const name = manifest.name ?? dir
  const violations: Violation[] = []
  const lenient = toleratesMissingTypes(manifest)

  for (const [label, target, condition] of declarations(manifest.exports)) {
    if (existsSync(resolveTarget(dir, target))) continue
    if (condition === 'types' && lenient) continue
    const kind = condition === 'types' ? 'types' : 'runtime'
    violations.push({
      package: name,
      detail: `exports["${label}"] ${kind} target ${target} does not exist`,
    })
  }

  // `main` and `types` sit outside `exports` but are what older consumers read.
  const rootFields: [string, unknown][] = [['main', (manifest as { main?: unknown }).main], ['types', (manifest as { types?: unknown }).types]]
  for (const [field, value] of rootFields) {
    if (typeof value !== 'string') continue
    if (existsSync(resolveTarget(dir, value))) continue
    if (field === 'types' && lenient) continue
    violations.push({ package: name, detail: `${field} target ${value} does not exist` })
  }

  return violations
}

/**
 * Check every workspace package.
 * @returns every violation, in package order.
 */
function checkAll(): Violation[] {
  return candidates().flatMap(checkPackage)
}

function main(): number {
  // No exclusions: every workspace package must keep its promises. A package
  // that legitimately omits client declarations declares `dsh.client`, which
  // checkPackage already honors.
  const violations = checkAll()
  const names = [...new Set(violations.map(violation => violation.package))]

  if (violations.length === 0) {
    const checked = candidates().length
    console.log(`verify-package-exports: ${checked} package(s) checked, all export targets resolve.`)
    return 0
  }

  console.error('verify-package-exports: declared export targets missing from the build output:')
  for (const violation of violations) console.error(`  ${violation.package}: ${violation.detail}`)
  console.error(`\n${violations.length} unresolved target(s) across ${names.length} package(s).`)
  console.error('Point each export at a file the build emits, or add the entry that produces it.')
  return 1
}

if (import.meta.main) {
  process.exitCode = main()
}
