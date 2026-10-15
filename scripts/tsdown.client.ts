/**
 * Shared tsdown preset for a package's browser client half (`dsh.client`).
 *
 * Ported from the DeepSeek Harness workspace preset
 * (`packages/client/tsdown.client.ts` in the harness source) and reduced to the
 * interop contract this repository needs. The artifact is a closure factory: the
 * bundle calls `window.__ModuleLoader__.load({ id, factory })` and resolves its
 * externals through the injected `require`, which the shell answers from its
 * module table (cordis DI entities — no globals, no import map).
 *
 * Three facts decide whether such a bundle boots, and this file is where each
 * one has a single source:
 *
 * 1. **The registration id is the package name.** The host composes the boot
 *    graph from each row's manifest (`this.table.set(packageName, …)`), and the
 *    browser refuses a bundle whose registration id differs from the row it was
 *    fetched for. The id is therefore an argument here (matching the harness
 *    API) and is checked against the package manifest before any config is
 *    emitted.
 * 2. **A require must be answerable.** Only the platform baseline, a row this
 *    package injects, or a specifier the package declares in
 *    `dsh.client.external` can be answered at runtime; everything else has to
 *    be inlined by the bundler.
 * 3. **Another plugin's browser half must never be inlined.** Its services,
 *    singletons and Remote protocols would exist twice; the purity plugin below
 *    turns that into a build error instead of a silent second copy.
 *
 * Dropped relative to the harness preset: the `DSH_BUILD_FACE` host/client
 * passes, the tsc `lib/types` staging and sourcemap chaining, the lightningcss
 * CSS virtual modules, the `staticLinked`/`clientLibrary` static assembly
 * channel, the harness-specific `sourcemapPathTransform`, and the
 * `DSH_CLIENT_*` build-environment defines. This repository publishes a single
 * browser half per package, styles it from TypeScript, and builds with plain
 * `tsdown` per package.
 *
 * @module scripts/tsdown.client
 */
import { existsSync, globSync, readFileSync } from 'node:fs'
import { createRequire, isBuiltin } from 'node:module'
import { dirname, join, resolve as resolvePath } from 'node:path'
import type { UserConfig } from 'tsdown'

/**
 * Module-table seed words the shell installs as platform singletons.
 *
 * Mirrors `PLATFORM_MODULES` in the harness source
 * (`packages/client/web/src/platform.ts`) at DSH 0.1.5-rc.1, which is the
 * release this repository's packages declare as their peer range. A shell
 * upgrade that adds or removes a seed word has to be reflected here: a word the
 * shell no longer seeds becomes an unresolvable `require`, and a shell word
 * missing from this list would be inlined into every bundle.
 */
export const PLATFORM_MODULES: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

/** The `dsh.client` declaration, as the preset and the gate read it. */
export interface DshClientDeclaration {
  /** Where the client half runs; only `web` is composed by the shell. */
  readonly platform?: unknown
  /** Package rows whose factories must arrive before this row materializes. */
  readonly inject?: unknown
  /** Exact non-inject module requests this bundle resolves from the table. */
  readonly external?: unknown
}

/** One workspace package manifest, as far as the preset reads it. */
export interface PackageManifest {
  /** Package name; the client bundle's registration id. */
  readonly name?: string
  /** Sections a real install materializes on disk next to the built package. */
  readonly dependencies?: Record<string, string>
  readonly peerDependencies?: Record<string, string>
  readonly optionalDependencies?: Record<string, string>
  readonly exports?: unknown
  readonly dsh?: { readonly client?: DshClientDeclaration }
}

/** One located workspace package: its directory and parsed manifest. */
export interface WorkspacePackage {
  /** Package name, as spelled in the manifest. */
  readonly id: string
  /** Absolute package directory. */
  readonly dir: string
  /** The parsed manifest. */
  readonly manifest: PackageManifest
}

/** Escape hatches mirroring the harness preset's options. */
export interface ClientBundleOptions {
  /**
   * Overrides merged over the emitted node-half config, spread last.
   *
   * A package that needs a build-time transform its node half does not share
   * (for example the standard-decorator lowering the Remote service packages
   * use) supplies it here, as a plugin on its own `tsdown.config.ts`.
   */
  readonly lib?: UserConfig
}

/** Client half entry, relative to the package directory. */
const CLIENT_ENTRY = 'src/client/index.ts'

/** Client bundle file name, pinned so it sits next to the node half. */
const CLIENT_FILENAME = 'client.js'

/** Build target shared by all three emitted configs. */
const TARGET = 'es2024'

/**
 * Emit the tsdown configs for one `dsh.client` package: the node half, the
 * browser client bundle, and the client face's declarations.
 *
 * @param id - plugin id, which must equal the package's manifest `name`; it is
 * stamped into the `__ModuleLoader__.load` handoff.
 * @param libEntry - node-half entries, spelled at the call site so each
 * package's own `tsdown.config.ts` names what it emits.
 * @param options - node-half overrides.
 * @returns the configs, in emission order (node half first, so its `clean`
 * runs before the other two write into the same `lib/`).
 * @throws {Error} when no workspace manifest declares `id`, or when the manifest
 * that declares it carries a different name.
 */
export function clientBundle(
  id: string,
  libEntry: readonly string[],
  options: ClientBundleOptions = {},
): UserConfig[] {
  const located = workspacePackage(id)
  const words = moduleTableWords(located.manifest.dsh?.client)
  const isProductionDependency = (specifier: string): boolean =>
    matchesSpecifier(productionExternals(located.manifest), specifier)
  const isTableWord = (specifier: string): boolean => words.has(specifier)

  const node: UserConfig = {
    name: id,
    entry: [...libEntry],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: TARGET,
    fixedExtension: false,
    dts: true,
    clean: true,
    deps: {
      // The node half runs from a real install: a production dependency is on
      // disk there and stays an import, everything else inlines. Stating both
      // halves takes the artifact off tsdown's getProductionDeps fallback, where
      // moving a dependency between npm sections silently re-bundles it.
      neverBundle: isProductionDependency,
      alwaysBundle: (specifier: string) => !isBuiltin(specifier) && !isProductionDependency(specifier),
    },
    ...options.lib,
  }

  const client: UserConfig = {
    name: `${id}/client`,
    entry: { client: CLIENT_ENTRY },
    // The browser bundle lands next to the node half in the single `lib/`
    // artifact directory; `entryFileNames` pins it to exactly lib/client.js.
    // `clean` must stay off — the node half already cleaned this directory.
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    target: TARGET,
    fixedExtension: false,
    // Types ship from the declarations pass below; a bundled CJS browser face
    // would otherwise wrap the banner/footer into the declaration output.
    dts: false,
    clean: false,
    // Plugin code is fetched outside the shell's module graph, so its own bundle
    // must carry the TS mapping browser profiling tools read.
    sourcemap: true,
    deps: {
      neverBundle: isTableWord,
      // Anything the module table cannot answer has to inline: a require the
      // table misses is a guaranteed runtime throw.
      alwaysBundle: (specifier: string) => !isTableWord(specifier),
    },
    // Browser bundles inline node-idiom dependencies that read
    // process.env.NODE_ENV, and zustand-style libraries also probe
    // import.meta.env.MODE — a CJS output cannot carry an empty import.meta.
    // The bare key is required alongside the precise one because the truthiness
    // probe would otherwise survive as an empty import.meta.
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    plugins: [clientPurityPlugin(id, words)],
    outputOptions: {
      entryFileNames: CLIENT_FILENAME,
      sourcemapExcludeSources: false,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }

  // The bundled browser face is CJS wrapped for the shell's module loader, for
  // which rolldown emits no declaration chunk; this declarations-only pass
  // produces the `./client` types face.
  const declarations: UserConfig = {
    name: `${id}/client-types`,
    entry: { client: CLIENT_ENTRY },
    outDir: 'lib',
    format: ['esm'],
    platform: 'browser',
    target: TARGET,
    fixedExtension: false,
    dts: { emitDtsOnly: true },
    clean: false,
    sourcemap: false,
    minify: false,
    deps: {
      neverBundle: isTableWord,
      alwaysBundle: (specifier: string) => !isTableWord(specifier),
    },
  }

  return [node, client, declarations]
}

/**
 * Every module-table word one package can resolve at runtime: the platform
 * baseline plus the rows it injects and the requests it declares.
 *
 * Both spellings of a row are words: the browser normalizes `<pkg>/client` onto
 * `<pkg>` before lookup, so a bundle may require either form.
 *
 * @param declaration - the package's `dsh.client` declaration, if any.
 * @returns the answerable specifiers.
 * @throws {Error} when `inject` or `external` is present but is not a string array.
 */
export function moduleTableWords(declaration: DshClientDeclaration | undefined): ReadonlySet<string> {
  const words = new Set<string>(PLATFORM_MODULES)
  for (const row of optionalStringArray('dsh.client.inject', declaration?.inject)) addRow(words, row)
  for (const request of optionalStringArray('dsh.client.external', declaration?.external)) addRow(words, request)
  return words
}

/**
 * Locate one workspace package by name.
 *
 * Located by name rather than by working directory, because a config is only
 * ever evaluated to describe the package whose manifest carries that name. The
 * search starts at `process.cwd()`, so a package-local `tsdown` run finds the
 * repository it belongs to rather than a hardcoded path.
 *
 * @param id - package name, as spelled at the preset call site.
 * @param from - directory to search upward from.
 * @returns the package directory and parsed manifest.
 * @throws {Error} when no workspace manifest declares that name.
 */
export function workspacePackage(id: string, from: string = process.cwd()): WorkspacePackage {
  const root = workspaceRoot(from)
  for (const relative of globSync('packages/*/*/package.json', { cwd: root }).sort()) {
    const dir = dirname(resolvePath(root, relative))
    const manifest = JSON.parse(readFileSync(resolvePath(dir, 'package.json'), 'utf8')) as PackageManifest
    if (manifest.name !== id) continue
    return { id, dir, manifest }
  }
  throw new Error(`tsdown: no packages/*/*/package.json under ${root} declares the name ${id}`)
}

/**
 * Read the `./client` export target of a manifest.
 * @param manifest - the package manifest.
 * @returns the target as written, or undefined when no `./client` face is declared.
 */
export function clientFaceTarget(manifest: PackageManifest): string | undefined {
  const exportsField = manifest.exports
  if (exportsField === null || typeof exportsField !== 'object') return undefined
  const face = (exportsField as Record<string, unknown>)['./client']
  if (typeof face === 'string') return face
  if (face === null || typeof face !== 'object') return undefined
  const target = (face as Record<string, unknown>).default
  return typeof target === 'string' ? target : undefined
}

/**
 * Whether one installed package declares a client half of its own.
 *
 * Resolution runs from the importing module, so it follows the same
 * node_modules layout rolldown would use. An unresolvable or manifest-less
 * package answers false, leaving the decision to rolldown (which fails loudly on
 * a value import it cannot resolve).
 *
 * @param specifier - a bare import specifier.
 * @param importer - absolute path of the importing module, when known.
 * @returns true when the named package declares `dsh.client`.
 */
export function declaresClientHalf(specifier: string, importer: string | undefined): boolean {
  const owner = packageNameOf(specifier)
  if (owner === undefined || importer === undefined) return false
  const manifest = resolveManifest(owner, importer)
  return manifest?.dsh?.client !== undefined
}

/**
 * Resolve a bare specifier's own package directory.
 * @param specifier - a bare import specifier.
 * @param from - directory to resolve from.
 * @returns the package name, or undefined for a relative or absolute specifier.
 */
export function packageNameOf(specifier: string): string | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('\0')) return undefined
  const segments = specifier.split('/')
  if (specifier.startsWith('@')) return segments.length < 2 ? undefined : `${segments[0]}/${segments[1]}`
  return segments[0] === '' ? undefined : segments[0]
}

/** Add a declared row and the sibling spelling the browser also answers. */
function addRow(words: Set<string>, row: string): void {
  words.add(row)
  if (row.endsWith('/client')) words.add(row.slice(0, -'/client'.length))
  else words.add(`${row}/client`)
}

/**
 * Validate an optional string-array field of a `dsh.client` declaration.
 * @param field - field name, as it appears in the diagnostic.
 * @param value - the raw field value.
 * @returns the validated entries, empty when the field is absent.
 * @throws {Error} when the value is present but is not an array of strings.
 */
function optionalStringArray(field: string, value: unknown): readonly string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`tsdown: dsh.client ${field} must be a string array`)
  }
  return value as readonly string[]
}

/** Walk up from `from` to the directory that owns the workspace. */
function workspaceRoot(from: string): string {
  let dir = resolvePath(from)
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`tsdown: no pnpm-workspace.yaml above ${from}`)
    dir = parent
  }
}

/**
 * External patterns for one package's node half: its own production sections.
 * @param manifest - the package manifest.
 * @returns one `^name(/|$)` pattern per production dependency, name-sorted.
 */
function productionExternals(manifest: PackageManifest): readonly RegExp[] {
  const names = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ])
  return [...names].sort().map(name => new RegExp(`^${escapeSpecifier(name)}(/|$)`))
}

/** Whether an import specifier is the package a pattern names, or one of its subpaths. */
function matchesSpecifier(patterns: readonly RegExp[], specifier: string): boolean {
  return patterns.some(pattern => pattern.test(specifier))
}

/** Escape a package name for literal use inside a RegExp source. */
function escapeSpecifier(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Find one package's manifest through the importing module's resolution. */
function resolveManifest(owner: string, importer: string): PackageManifest | undefined {
  const from = importer.split('?')[0] ?? importer
  try {
    const path = createRequire(from).resolve(`${owner}/package.json`)
    return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
  } catch {
    return undefined
  }
}

/**
 * Build-time mirror of the runtime module table: a requested word stays
 * external, another plugin's browser half is a build error, everything else
 * inlines.
 * @param id - the package being bundled, for the diagnostic.
 * @param words - the package's answerable specifiers.
 * @returns the rolldown plugin.
 */
function clientPurityPlugin(id: string, words: ReadonlySet<string>) {
  return {
    name: 'dsh-client-bundle-purity',
    resolveId(source: string, importer: string | undefined) {
      if (!source.startsWith('@deepseek-ai/') && !source.startsWith('@zhangj1164/')) return null
      if (words.has(source)) return null // requested module-table row: external wins
      if (!declaresClientHalf(source, importer)) return null // wire layer or library: inline
      throw new Error(
        `client bundle purity: "${source}" is another plugin's browser half, and ${id} does not request it — `
        + `declare it in ${id}'s dsh.client.external, or collaborate through cordis services `
        + '(type-only imports are erased and never reach this gate)',
      )
    },
  }
}
