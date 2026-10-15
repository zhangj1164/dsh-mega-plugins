/**
 * Reject a workspace package that can leak a `workspace:` range to a consumer.
 *
 * A pnpm workspace declares cross-package ranges as `workspace:^` / `workspace:*`.
 * `pnpm publish` substitutes the referenced package's real version at pack time,
 * in `dependencies`, `devDependencies` and `peerDependencies` alike, but another
 * packer copies the protocol through verbatim: the registry manifest then ships
 * `"@scope/dep": "workspace:^"`, every npm consumer fails with
 * `EUNSUPPORTEDPROTOCOL: Unsupported URL Type "workspace:"`, and a
 * workspace-local install cannot show the defect because pnpm only warns about
 * the protocol. `@zhangj1164/dsh-memo@0.1.0` reached the catalog exactly that
 * way.
 *
 * `scripts/publish-guard.mjs` is the interlock: it refuses to publish a manifest
 * that declares a `workspace:` range unless the packer is pnpm. It protects
 * nothing until a package actually runs it, and the wiring is per-package
 * boilerplate that a new package — or a package that adopts a workspace range
 * later — silently omits. This gate closes that gap statically: any package
 * carrying a `workspace:` range must run the guard as `prepublishOnly`, and the
 * path it names must resolve to the repository's guard.
 *
 * The gate reads manifests only. It cannot observe a publish that bypasses
 * `prepublishOnly`, so it verifies the wiring rather than the publish itself;
 * the guard is what stops the publish.
 */
import { existsSync, globSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

/** Repo-relative path of the publish interlock every guarded package must run. */
const GUARD_PATH = 'scripts/publish-guard.mjs'

/** Dependency fields whose ranges a packer rewrites or a consumer reads. */
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
]

/** One workspace package and the publish wiring its manifest declares. */
export interface PackagePublishState {
  /** Package name from its manifest. */
  package: string
  /** Package directory, absolute. */
  dir: string
  /** Every `workspace:` range the manifest declares, as `field: name@range`. */
  workspaceRanges: string[]
  /** The `prepublishOnly` command, or undefined when the manifest declares none. */
  prepublishOnly: string | undefined
}

/** One reason the gate refuses to ship the current wiring. */
export interface Violation {
  /** Package the violation belongs to. */
  package: string
  /** Sentence naming the defect and its consequence. */
  detail: string
}

interface PackageManifest {
  name?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

/**
 * Whether one range can only be expressed inside the pnpm workspace.
 * @param range - a dependency range from the manifest.
 * @returns true for the `workspace:` protocol.
 */
export function isWorkspaceRange(range: unknown): boolean {
  return typeof range === 'string' && range.startsWith('workspace:')
}

/**
 * Collect every `workspace:` range a manifest declares.
 * @param manifest - the parsed package manifest.
 * @returns one `field: name@range` description per workspace range.
 */
export function collectWorkspaceRanges(manifest: PackageManifest): string[] {
  const found: string[] = []
  for (const field of DEPENDENCY_FIELDS) {
    const dependencies = manifest[field] ?? {}
    for (const [name, range] of Object.entries(dependencies)) {
      if (isWorkspaceRange(range)) found.push(`${field}: ${name}@${range}`)
    }
  }
  return found
}

/**
 * Read every workspace package with its current publish wiring.
 * @returns the packages, sorted by name.
 */
export function readPackagePublishStates(): PackagePublishState[] {
  return globSync('packages/*/*/package.json', { cwd: root })
    .map((relative) => {
      const path = join(root, relative)
      const manifest = JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
      return {
        package: manifest.name ?? relative,
        dir: dirname(path),
        workspaceRanges: collectWorkspaceRanges(manifest),
        prepublishOnly: manifest.scripts?.prepublishOnly,
      }
    })
    .sort((left, right) => left.package.localeCompare(right.package))
}

/**
 * Resolve the guard a `prepublishOnly` command names, as the publish shell would.
 *
 * The command is split on whitespace and the first token that ends in the
 * guard's file name is resolved against the package directory. Resolving rather
 * than string-matching is the point: a `../../../` depth that lands outside the
 * repository, or on a file that does not exist, is exactly the mistake a
 * maintainer makes when copying the wiring into a package at a new depth.
 * @param command - the `prepublishOnly` command.
 * @param dir - the package directory the command runs in.
 * @returns the absolute guard path, or undefined when the command names none.
 */
export function resolveGuardedPath(command: string | undefined, dir: string): string | undefined {
  if (command === undefined) return undefined
  const token = command.split(/\s+/u).find(part => part.endsWith(GUARD_PATH))
  return token === undefined ? undefined : resolve(dir, token)
}

/**
 * Report every package whose workspace ranges are not protected by the guard.
 * @param packages - package publish states to inspect.
 * @returns the violations, in package order.
 */
export function findViolations(packages: readonly PackagePublishState[]): Violation[] {
  const violations: Violation[] = []
  const expected = join(root, GUARD_PATH)

  for (const pkg of packages) {
    const guarded = resolveGuardedPath(pkg.prepublishOnly, pkg.dir)

    if (pkg.workspaceRanges.length > 0 && guarded === undefined) {
      violations.push({
        package: pkg.package,
        detail: `declares ${pkg.workspaceRanges.length} workspace: range(s) but does not run ${GUARD_PATH} as prepublishOnly, so a publish under any packer other than pnpm ships those ranges verbatim`,
      })
      continue
    }
    if (guarded === undefined) continue

    if (guarded !== expected) {
      violations.push({
        package: pkg.package,
        detail: `prepublishOnly resolves ${GUARD_PATH} to ${guarded}, which is not the repository's guard at ${expected}`,
      })
      continue
    }
    if (!existsSync(guarded)) {
      violations.push({
        package: pkg.package,
        detail: `prepublishOnly names ${GUARD_PATH}, which does not exist at ${guarded}`,
      })
    }
  }

  return violations
}

function main(): number {
  const packages = readPackagePublishStates()
  const violations = findViolations(packages)
  const guarded = packages.filter(pkg => resolveGuardedPath(pkg.prepublishOnly, pkg.dir) !== undefined)

  if (violations.length === 0) {
    console.log(`verify-publish-guard: ${guarded.length} of ${packages.length} package(s) run ${GUARD_PATH}; no unprotected workspace: range.`)
    const summary = packages
      .map(pkg => `${pkg.package} [${pkg.workspaceRanges.length} workspace: range(s)${resolveGuardedPath(pkg.prepublishOnly, pkg.dir) === undefined ? ', unguarded' : ', guarded'}]`)
      .join('; ')
    console.log(`  ${summary}`)
    return 0
  }

  console.error('verify-publish-guard: packages that can leak a workspace: range to a consumer:')
  for (const violation of violations) console.error(`  ${violation.package}: ${violation.detail}`)
  console.error(`\n${violations.length} unprotected package(s).`)
  console.error(`Wire the interlock in each package's manifest: "prepublishOnly": "node ../../../${GUARD_PATH}".`)
  return 1
}

if (import.meta.main) {
  process.exitCode = main()
}
