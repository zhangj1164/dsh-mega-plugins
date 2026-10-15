/**
 * Reject a built client bundle whose browser boot would fail.
 *
 * Two facts decide whether a `dsh.client` bundle boots, and both live in the
 * build output rather than in a declaration:
 *
 * 1. **Its registration id must equal the package name.** The host composes the
 *    boot graph from each row's manifest, so the row id is the package name, and
 *    the browser refuses a bundle that registers under anything else
 *    (`bundle <url> loaded without registering "<id>"`). A hand-written banner
 *    literal silently drifts from the manifest the moment a package is renamed —
 *    which is exactly how this repository shipped a memo UI that could not mount.
 * 2. **Every `require` must be answerable.** The module table answers the
 *    platform baseline, a row the package injects, and the requests the package
 *    declares in `dsh.client.external`; a require outside that set throws at the
 *    moment the factory materializes.
 *
 * The gate reads `lib/`, so it must run after the build. It also checks that
 * each declared row actually is one: a name in `inject`/`external` that resolves
 * to no package, or to a package declaring no client half, is a declaration the
 * shell cannot satisfy.
 *
 * @module scripts/verify-client-bundle-id
 */
import { existsSync, globSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import {
  PLATFORM_MODULES,
  clientFaceTarget,
  moduleTableWords,
  packageNameOf,
  type DshClientDeclaration,
  type PackageManifest,
} from './tsdown.client.ts'

const root = resolve(import.meta.dirname, '..')

/** One failed assertion about a built client bundle. */
export interface Violation {
  /** Package the assertion belongs to. */
  package: string
  /** What is wrong, in one line. */
  detail: string
}

/** `window.__ModuleLoader__.load({ id: … })` as the bundle writes it. */
const REGISTRATION = /__ModuleLoader__\s*\.\s*load\(\s*\{\s*id\s*:\s*(["'])(?<id>[^"']*)\1/

/** A `require("…")` call with a literal specifier. */
const LITERAL_REQUIRE = /\brequire\(\s*(["'])(?<specifier>[^"']+)\1\s*\)/g

/** Any `require(` call, literal or not. */
const REQUIRE_CALL = /\brequire\(/g

/**
 * Read the id a bundle registers, if it registers one at all.
 * @param source - bundle source.
 * @returns the registered id, or undefined when the bundle carries no handoff.
 */
export function registrationId(source: string): string | undefined {
  return REGISTRATION.exec(source)?.groups?.id
}

/**
 * Collect every literal `require` specifier in a bundle.
 * @param source - bundle source.
 * @returns the specifiers, in bundle order.
 */
export function literalRequires(source: string): string[] {
  return [...source.matchAll(LITERAL_REQUIRE)].map(match => match.groups?.specifier ?? '')
}

/**
 * Whether a bundle calls `require` with anything other than a literal.
 * @param source - bundle source.
 * @returns true when at least one call has a non-literal argument.
 */
export function hasNonLiteralRequire(source: string): boolean {
  const calls = [...source.matchAll(REQUIRE_CALL)].length
  return calls > literalRequires(source).length
}

/**
 * Check one built bundle against the module table its manifest declares.
 * @param candidate - package name, bundle source, expected id, answerable words.
 * @returns every violation found.
 */
export function checkClientBundle(candidate: {
  readonly package: string
  readonly source: string
  readonly expectedId: string
  readonly words: ReadonlySet<string>
}): Violation[] {
  const { package: name, source, expectedId, words } = candidate
  const violations: Violation[] = []

  const registered = registrationId(source)
  if (registered === undefined) {
    violations.push({
      package: name,
      detail: 'the bundle registers no id through window.__ModuleLoader__.load',
    })
  } else if (registered !== expectedId) {
    violations.push({
      package: name,
      detail: `the bundle registers "${registered}" but the boot graph row is "${expectedId}" (the registration id is the package name)`,
    })
  }

  for (const specifier of literalRequires(source)) {
    if (words.has(specifier)) continue
    violations.push({
      package: name,
      detail: `the bundle requires "${specifier}", which is neither a platform module nor declared in dsh.client.external`,
    })
  }

  if (hasNonLiteralRequire(source)) {
    violations.push({
      package: name,
      detail: 'the bundle contains a require() call with a non-literal argument, which the module table cannot answer',
    })
  }

  return violations
}

/**
 * Check that every row a manifest declares is one the shell can serve.
 *
 * A row is served when it is a platform baseline word or resolves from this
 * package to a manifest declaring a client half. A subpath is judged by its
 * owning package, because the browser normalizes `<pkg>/client` onto `<pkg>`.
 *
 * @param name - package name, for the diagnostic.
 * @param dir - package directory, the resolution base.
 * @param declaration - the package's `dsh.client` declaration.
 * @returns every violation found.
 */
export function checkDeclaredRows(
  name: string,
  dir: string,
  declaration: DshClientDeclaration,
): Violation[] {
  const violations: Violation[] = []
  const baseline = new Set<string>(PLATFORM_MODULES)
  const declared = [
    ...stringArray('dsh.client.inject', declaration.inject).map(row => ['dsh.client.inject', row] as const),
    ...stringArray('dsh.client.external', declaration.external).map(row => ['dsh.client.external', row] as const),
  ]

  for (const [field, word] of declared) {
    if (baseline.has(word)) continue
    const owner = packageNameOf(word)
    if (owner === undefined) {
      violations.push({ package: name, detail: `${field} "${word}" is not a bare package specifier` })
      continue
    }
    const manifest = resolvePackageManifest(owner, dir)
    if (manifest === undefined) {
      violations.push({
        package: name,
        detail: `${field} "${word}" does not resolve to an installed package declaring a client half`,
      })
      continue
    }
    if (manifest.dsh?.client === undefined) {
      violations.push({
        package: name,
        detail: `${field} "${word}" names ${owner}, which declares no dsh.client, so the module table cannot serve it`,
      })
    }
  }

  return violations
}

/** Locate an installed package's manifest from a directory inside the workspace. */
function resolvePackageManifest(owner: string, dir: string): PackageManifest | undefined {
  try {
    const path = createRequire(join(dir, 'package.json')).resolve(`${owner}/package.json`)
    return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
  } catch {
    return undefined
  }
}

/** Read an optional string array, treating a malformed field as no declaration. */
function stringArray(field: string, value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) return []
  return value as readonly string[]
}

/**
 * Check every workspace package that declares a browser client half.
 * @param repoRoot - repository root to scan; overridable for tests.
 * @returns every violation, in package order.
 */
export function checkAll(repoRoot: string = root): Violation[] {
  const violations: Violation[] = []
  for (const relative of globSync('packages/*/*/package.json', { cwd: repoRoot }).sort()) {
    const dir = dirname(join(repoRoot, relative))
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PackageManifest
    const declaration = manifest.dsh?.client
    if (declaration?.platform !== 'web') continue
    const name = manifest.name ?? relative

    const target = clientFaceTarget(manifest)
    if (target === undefined) {
      violations.push({ package: name, detail: 'declares a web client half but exports no "./client" face' })
      continue
    }
    const bundle = resolve(dir, target)
    if (!existsSync(bundle)) {
      violations.push({ package: name, detail: `the built client bundle ${target} is missing; run the build` })
      continue
    }

    violations.push(...checkClientBundle({
      package: name,
      source: readFileSync(bundle, 'utf8'),
      expectedId: name,
      words: moduleTableWords(declaration),
    }))
    violations.push(...checkDeclaredRows(name, dir, declaration))
  }
  return violations
}

/**
 * Report the workspace-wide result.
 * @returns the process exit code.
 */
function main(): number {
  const violations = checkAll()
  if (violations.length === 0) {
    console.log('verify-client-bundle-id: every built client bundle registers its package name and requires only module-table words.')
    return 0
  }

  console.error('verify-client-bundle-id: client bundles that cannot boot:')
  for (const violation of violations) console.error(`  ${violation.package}: ${violation.detail}`)
  console.error(`\n${violations.length} violation(s).`)
  return 1
}

if (import.meta.main) {
  process.exitCode = main()
}
