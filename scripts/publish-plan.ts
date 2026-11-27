/**
 * Resolve, gate, and verify one package release for the per-package publish workflows.
 *
 * A tag push names a version twice: once in the tag, once in `package.json`. The
 * two can disagree, the tag can point at a commit that never reached `main`, and
 * the version can already be on the registry — three silent failures that a
 * publish step alone cannot tell apart from success. `plan` answers those
 * questions before anything is packed and writes the answers as step outputs;
 * `verify` re-reads the registry copy afterwards, because a successful `pnpm
 * publish` says what npm accepted, not what a consumer will install.
 *
 * Both modes read the environment rather than argv, so a workflow that calls
 * them stays a list of names and values. The pure decisions are exported for
 * `scripts/tests/publish-plan.spec.ts`.
 */
import { appendFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Registry used when neither the environment nor npm config names another. */
const DEFAULT_REGISTRY = 'https://registry.npmjs.org/'

/** Fields whose ranges a published manifest must not express as `workspace:`. */
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const

/** Versions a tag may name: release or prerelease, no build metadata. */
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u

/** The fields `plan` and `verify` read from one package manifest. */
export interface Manifest {
  name?: string
  version?: string
  private?: boolean
  dist?: {
    attestations?: { url?: string; provenance?: { predicateType?: string } }
  }
  [field: string]: unknown
}

/** Inputs to the pure release decision. */
export interface PlanInput {
  manifest: Manifest
  tag: string
  tagPrefix: string
  published: boolean
  dispatch: boolean
}

/** The decision a workflow acts on. */
export interface PlanResult {
  version: string
  tag: string
  skip: boolean
  reason: string
}

/** Inputs to the pure registry-copy check. */
export interface VerifyInput {
  manifest: Manifest | null
  version: string
  distTags: Record<string, string> | null
  distTag: string
}

/** Problems fail the workflow; warnings are reported and allowed. */
export interface VerifyResult {
  problems: string[]
  warnings: string[]
  provenance: string | null
}

/** The shape of `fetch` this module needs, so tests can inject a stub. */
export type FetchLike = (
  url: string,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

/**
 * Read the version a tag names, or null when the tag uses another prefix or no version.
 * @param tag - the full tag name, for example `memo-v0.7.5`.
 * @param prefix - the package's tag prefix, for example `memo-v`.
 * @returns the version portion when it is valid semver, otherwise null.
 */
export function tagVersion(tag: string, prefix: string): string | null {
  if (!tag.startsWith(prefix)) return null
  const version = tag.slice(prefix.length)
  return SEMVER.test(version) ? version : null
}

/**
 * Decide whether this run may publish, may only verify, or must stop.
 * @param input - manifest facts, the tag, and whether the version is already published.
 * @returns the version and tag another step should use, plus whether publishing is skipped.
 * @throws when the tag, the manifest, or the registry state make a publish unsafe.
 */
export function planPublish(input: PlanInput): PlanResult {
  const { manifest } = input
  if (!manifest.name) throw new Error('package.json declares no name')
  if (!manifest.version) throw new Error(`${manifest.name}: package.json declares no version`)
  if (manifest.private === true) {
    throw new Error(`${manifest.name} is marked private; a publish workflow must not ship it`)
  }

  const fromTag = tagVersion(input.tag, input.tagPrefix)
  if (fromTag === null) {
    throw new Error(
      `tag ${input.tag} does not match the ${input.tagPrefix}<version> pattern this package publishes from; a tag push must name the release tag, and a manual dispatch must run from that tag rather than from a branch`,
    )
  }
  if (fromTag !== manifest.version) {
    throw new Error(
      `tag ${input.tag} names ${fromTag}, but ${manifest.name} declares ${manifest.version}; bump the version and re-tag`,
    )
  }

  if (input.published) {
    if (!input.dispatch) {
      throw new Error(
        `${manifest.name}@${manifest.version} is already on the registry. A tag push must publish a new version: bump it, commit to main, and push a new tag. To re-check an existing release, dispatch this workflow from that tag instead.`,
      )
    }
    return {
      version: manifest.version,
      tag: input.tag,
      skip: true,
      reason: 'already published; a manual dispatch verifies the registry copy without publishing again',
    }
  }

  return {
    version: manifest.version,
    tag: input.tag,
    skip: false,
    reason: 'version is not on the registry',
  }
}

/**
 * Collect every `workspace:` range a manifest still declares.
 * @param manifest - a manifest read from the registry or from disk.
 * @returns one `field: name@range` description per workspace range.
 */
export function workspaceRanges(manifest: Manifest): string[] {
  const found: string[] = []
  for (const field of DEPENDENCY_FIELDS) {
    const dependencies = manifest[field]
    if (dependencies === null || typeof dependencies !== 'object') continue
    for (const [name, range] of Object.entries(dependencies as Record<string, unknown>)) {
      if (typeof range === 'string' && range.startsWith('workspace:')) {
        found.push(`${field}: ${name}@${range}`)
      }
    }
  }
  return found
}

/**
 * Read the provenance attestation URL from a registry version manifest.
 *
 * npm puts the attestation URL at `dist.attestations.url` and the predicate type
 * under it at `dist.attestations.provenance.predicateType`, so a reader that
 * looks for a URL inside `provenance` finds nothing and reports a signed
 * release as unsigned.
 * @param manifest - a manifest read from the registry.
 * @returns the attestation URL when npm reports one, otherwise null.
 */
export function provenanceUrl(manifest: Manifest): string | null {
  const url = manifest.dist?.attestations?.url
  return typeof url === 'string' && url !== '' ? url : null
}

/**
 * Check what the registry now serves against what the tag promised.
 * @param input - the registry version manifest, the expected version, and dist-tags.
 * @returns problems that must fail the workflow, plus allowed warnings.
 */
export function verifyPublished(input: VerifyInput): VerifyResult {
  const problems: string[] = []
  const warnings: string[] = []

  if (!input.manifest) {
    problems.push(`${input.version} is not on the registry at all`)
    return { problems, warnings, provenance: null }
  }

  if (input.manifest.version !== input.version) {
    problems.push(
      `registry reports version ${String(input.manifest.version)}, expected ${input.version}`,
    )
  }

  for (const range of workspaceRanges(input.manifest)) {
    problems.push(`published manifest still declares a workspace: range (${range})`)
  }

  const tagged = input.distTags?.[input.distTag]
  if (tagged === undefined) {
    problems.push(`registry has no "${input.distTag}" dist-tag`)
  } else if (tagged !== input.version) {
    problems.push(`dist-tag "${input.distTag}" points at ${tagged}, expected ${input.version}`)
  }

  const provenance = provenanceUrl(input.manifest)
  if (provenance === null) {
    warnings.push(
      'the registry copy carries no provenance attestation; the publish is accepted, but consumers cannot verify where the tarball was built',
    )
  }

  return { problems, warnings, provenance }
}

/**
 * Normalize a registry URL to end with one slash.
 * @param base - a registry URL from npm config or the default.
 * @returns the same URL with exactly one trailing slash.
 */
export function normalizeRegistry(base: string): string {
  return base.endsWith('/') ? base : `${base}/`
}

/**
 * Resolve the registry from npm's environment, matching npm and pnpm's own lookup.
 * @param env - the process environment.
 * @returns the configured registry, normalized.
 */
export function registryFromEnv(env: Record<string, string | undefined>): string {
  const raw = env.NPM_CONFIG_REGISTRY ?? env.npm_config_registry ?? DEFAULT_REGISTRY
  return normalizeRegistry(raw)
}

/**
 * Build the registry URL for one package version.
 * @param name - the package name.
 * @param version - the exact version.
 * @param registry - the registry base URL.
 * @returns the version document URL.
 */
export function versionUrl(name: string, version: string, registry: string): string {
  return `${normalizeRegistry(registry)}${name.replace('/', '%2F')}/${version}`
}

/**
 * Build the registry URL for one package's dist-tags.
 * @param name - the package name.
 * @param registry - the registry base URL.
 * @returns the dist-tags document URL.
 */
export function distTagsUrl(name: string, registry: string): string {
  return `${normalizeRegistry(registry)}-/package/${name.replace('/', '%2F')}/dist-tags`
}

/**
 * GET a JSON document, treating 404 as absence rather than failure.
 * @param url - the document URL.
 * @param fetchImpl - the fetch implementation, injectable for tests.
 * @returns the parsed document, or null when the registry answered 404.
 */
async function getJson(url: string, fetchImpl: FetchLike = fetch): Promise<unknown | null> {
  const response = await fetchImpl(url)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`GET ${url} failed with HTTP ${response.status}`)
  return response.json()
}

/**
 * Whether one exact version is already on the registry.
 * @param name - the package name.
 * @param version - the exact version.
 * @param registry - the registry base URL.
 * @param fetchImpl - the fetch implementation, injectable for tests.
 * @returns true when the version document exists.
 */
export async function isPublished(
  name: string,
  version: string,
  registry: string,
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  return (await getJson(versionUrl(name, version, registry), fetchImpl)) !== null
}

/** How many times `verify` re-reads the registry before calling a version absent. */
export const VERIFY_ATTEMPTS = 12

/** Milliseconds between registry reads, so the default budget is about a minute. */
export const VERIFY_INTERVAL_MS = 5_000

/** Retry budget and injectable I/O shared by the two registry waiters. */
export interface RetryInput {
  attempts?: number
  intervalMs?: number
  fetchImpl?: FetchLike
  sleep?: (milliseconds: number) => Promise<void>
}

/** Inputs to the retrying version read `verify` uses. */
export interface WaitForVersionInput extends RetryInput {
  name: string
  version: string
  registry: string
}

/** Inputs to the retrying dist-tag read `verify` uses. */
export interface WaitForDistTagInput extends RetryInput {
  name: string
  version: string
  distTag: string
  registry: string
}

/**
 * Wait between two registry reads.
 * @param milliseconds - how long to wait.
 */
async function pause(milliseconds: number): Promise<void> {
  await new Promise<void>((done) => {
    setTimeout(done, milliseconds)
  })
}

/**
 * Read a version document until the registry serves it.
 *
 * A publish that just returned success is not yet readable on every registry
 * replica: the first read after `pnpm publish` exits can answer 404 for a few
 * seconds. Treating that 404 as "absent" failed a release that had shipped, so
 * the read retries before the absence is believed.
 * @param input - package, version, registry, and the retry budget.
 * @returns the version manifest, or null when the budget runs out.
 */
export async function waitForVersion(input: WaitForVersionInput): Promise<Manifest | null> {
  const attempts = input.attempts ?? VERIFY_ATTEMPTS
  const intervalMs = input.intervalMs ?? VERIFY_INTERVAL_MS
  const fetchImpl = input.fetchImpl ?? fetch
  const sleep = input.sleep ?? pause

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const manifest = (await getJson(
      versionUrl(input.name, input.version, input.registry),
      fetchImpl,
    )) as Manifest | null
    if (manifest !== null) return manifest
    if (attempt < attempts) {
      console.log(
        `::notice::${input.name}@${input.version} is not readable from the registry yet; retrying in ${String(intervalMs / 1000)}s (attempt ${String(attempt + 1)} of ${String(attempts)})`,
      )
      await sleep(intervalMs)
    }
  }
  return null
}

/**
 * Read dist-tags until `distTag` names the released version.
 *
 * The version document and the dist-tags document propagate independently, so
 * a version can be readable while `latest` still points at the previous release.
 * @param input - package, version, dist-tag, registry, and the retry budget.
 * @returns the last dist-tags document read, which the caller reports even when it never matched.
 */
export async function waitForDistTag(
  input: WaitForDistTagInput,
): Promise<Record<string, string> | null> {
  const attempts = input.attempts ?? VERIFY_ATTEMPTS
  const intervalMs = input.intervalMs ?? VERIFY_INTERVAL_MS
  const fetchImpl = input.fetchImpl ?? fetch
  const sleep = input.sleep ?? pause
  let read: Record<string, string> | null = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    read = (await getJson(distTagsUrl(input.name, input.registry), fetchImpl)) as Record<
      string,
      string
    > | null
    if (read?.[input.distTag] === input.version) return read
    if (attempt < attempts) {
      console.log(
        `::notice::the "${input.distTag}" dist-tag does not name ${input.version} yet; retrying in ${String(intervalMs / 1000)}s (attempt ${String(attempt + 1)} of ${String(attempts)})`,
      )
      await sleep(intervalMs)
    }
  }
  return read
}

/**
 * Require one environment variable.
 * @param env - the process environment.
 * @param name - the variable name.
 * @returns the non-empty value.
 */
function requireEnv(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]
  if (value === undefined || value === '') throw new Error(`${name} is not set`)
  return value
}

/**
 * Append step outputs, or echo them when the workflow did not provide a file.
 * @param outputs - key/value pairs the workflow reads as `steps.<id>.outputs.<key>`.
 */
function writeOutputs(outputs: Record<string, string>): void {
  const lines = `${Object.entries(outputs)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`
  const file = process.env.GITHUB_OUTPUT
  if (file === undefined || file === '') {
    process.stdout.write(lines)
    return
  }
  appendFileSync(file, lines)
}

/**
 * Append a job summary, or print it when the workflow did not provide a file.
 * @param markdown - the summary body.
 */
function writeSummary(markdown: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY
  if (file === undefined || file === '') {
    process.stdout.write(`${markdown}\n`)
    return
  }
  appendFileSync(file, `${markdown}\n`)
}

/**
 * Run the `plan` mode: decide what this run may do and publish the decision as outputs.
 * @returns nothing; failures set the process exit code through the caller.
 */
async function runPlan(): Promise<void> {
  const env = process.env
  const packageDir = requireEnv(env, 'PACKAGE_DIR')
  const tag = requireEnv(env, 'TAG')
  const tagPrefix = requireEnv(env, 'TAG_PREFIX')
  const manifest = JSON.parse(readFileSync(resolve(packageDir, 'package.json'), 'utf8')) as Manifest

  if (!manifest.name || !manifest.version) {
    throw new Error(`${packageDir}/package.json declares no name or version`)
  }

  const registry = registryFromEnv(env)
  const published = await isPublished(manifest.name, manifest.version, registry)

  const namedTag = env.TAG_INPUT ?? ''
  if (namedTag !== '' && !published) {
    throw new Error(
      `tag ${namedTag} names ${manifest.version}, which is not on the registry: a manual dispatch only re-checks a published release, so push the tag to publish it`,
    )
  }

  const plan = planPublish({
    manifest,
    tag,
    tagPrefix,
    published,
    dispatch: env.GITHUB_EVENT_NAME === 'workflow_dispatch',
  })

  writeOutputs({ version: plan.version, tag: plan.tag, skip: String(plan.skip) })
  writeSummary(
    [
      `### ${manifest.name}@${plan.version}`,
      '',
      '| Field | Value |',
      '| --- | --- |',
      `| Tag | \`${plan.tag}\` |`,
      `| Registry | ${registry} |`,
      `| Already on the registry | ${published ? 'yes' : 'no'} |`,
      `| Action | ${plan.skip ? 'skip publishing, verify only' : 'publish'} |`,
      '',
      plan.reason === '' ? '' : `${plan.reason}.`,
    ].join('\n'),
  )
}

/**
 * Run the `verify` mode: compare the registry copy with the tag's promise.
 * @returns nothing; problems set the process exit code.
 */
async function runVerify(): Promise<void> {
  const env = process.env
  const name = requireEnv(env, 'PACKAGE_NAME')
  const version = requireEnv(env, 'VERSION')
  const distTag = env.DIST_TAG ?? 'latest'
  const registry = registryFromEnv(env)

  const manifest = await waitForVersion({ name, version, registry })
  const distTags = manifest === null ? null : await waitForDistTag({ name, version, distTag, registry })
  const result = verifyPublished({ manifest, version, distTags, distTag })

  for (const warning of result.warnings) console.log(`::warning::${warning}`)
  for (const problem of result.problems) console.error(`::error::${problem}`)

  writeSummary(
    [
      `### Registry copy of ${name}@${version}`,
      '',
      '| Check | Result |',
      '| --- | --- |',
      `| Version present | ${manifest === null ? 'no' : 'yes'} |`,
      `| \`workspace:\` ranges | ${result.problems.some(problem => problem.includes('workspace:')) ? 'found' : 'none'} |`,
      `| \`${distTag}\` dist-tag | ${distTags?.[distTag] ?? 'missing'} |`,
      `| Provenance | ${result.provenance ?? 'absent'} |`,
    ].join('\n'),
  )

  if (result.problems.length > 0) process.exitCode = 1
}

/**
 * Dispatch on the mode named by the first argument.
 * @returns nothing.
 */
async function main(): Promise<void> {
  const mode = process.argv[2]
  if (mode === 'plan') return runPlan()
  if (mode === 'verify') return runVerify()
  throw new Error(`unknown mode ${String(mode)}; expected "plan" or "verify"`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`::error::${message}`)
    process.exitCode = 1
  })
}
