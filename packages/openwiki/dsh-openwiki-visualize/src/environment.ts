/**
 * Pure environment logic for the OpenWiki preview plugin.
 *
 * Everything here is a total function over its arguments: no filesystem, no
 * child process, no network, no clock, no globals. The host service holds the
 * effects; this module holds the decisions, which is what makes the version
 * gate, the banner parsing, and the wiki detection testable without a machine
 * that happens to have openwiki installed.
 *
 * The parsing rules are not invented. `openwiki visualize` is a plain Node
 * process that announces itself on stdout and it binds only loopback, so the
 * two facts this plugin must recover from it — its version and the port it
 * actually bound — are recovered from the shapes the 0.7.2 CLI really emits,
 * recorded in `docs/openwiki-visualize-reference.md`.
 *
 * @module @zhangj1164/dsh-openwiki-visualize/environment
 */

/**
 * A semantic version, split so comparison never has to touch strings.
 *
 * `prerelease` is empty for a release version, which is what makes
 * `0.1.5-rc.1 < 0.1.5` fall out of the comparison rather than needing a special
 * case at every call site.
 */
export interface ParsedVersion {
  /** Major component. */
  readonly major: number
  /** Minor component. */
  readonly minor: number
  /** Patch component. */
  readonly patch: number
  /** Dot-separated prerelease identifiers, empty for a release version. */
  readonly prerelease: readonly string[]
}

/**
 * Which marker identified a directory as an openwiki.
 *
 * Ordered strongest to weakest. A `.page-manifest.json` is written by generation
 * itself, an `index.md` is the section index the reader relies on, and any other
 * markdown page is the weakest evidence a wiki is there.
 */
export type WikiMarker = 'manifest' | 'index' | 'markdown'

/** The result of classifying one directory's entries. */
export interface WikiDetection {
  /** Whether the entries look like an initialized openwiki. */
  readonly hasWiki: boolean
  /** The strongest marker found, present only when {@link hasWiki}. */
  readonly marker?: WikiMarker
}

/**
 * Files openwiki writes as generation scaffolding rather than wiki content.
 *
 * Mirrors the exclusions the visualizer's own graph builder applies, so this
 * plugin's page count agrees with the reader's node count instead of reporting
 * a directory of two scaffolding files as a wiki.
 */
export const OPENWIKI_SCAFFOLD_FILES: readonly string[] = Object.freeze(['INSTRUCTIONS.md', 'log.md'])

/** The strongest marker file first; see {@link WikiMarker}. */
export const OPENWIKI_MARKERS: readonly string[] = Object.freeze(['.page-manifest.json', 'index.md'])

/** Lowest port `openwiki visualize` accepts, from the CLI's own validation. */
export const MINIMUM_PORT = 1024

/** Highest port `openwiki visualize` accepts. */
export const MAXIMUM_PORT = 65535

/** Matches the leading `v?major.minor.patch[-prerelease]` of a version string. */
const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/u

/** Matches the version in the CLI's startup banner, e.g. `OpenWiki v0.7.2`. */
const BANNER_VERSION_PATTERN = /OpenWiki\s+v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/iu

/** Matches the loopback URL the visualizer prints in its banner. */
const LOOPBACK_URL_PATTERN = /http:\/\/127\.0\.0\.1:(\d{1,5})/u

/** Matches ANSI SGR sequences, which the CLI's banner is full of. */
const ANSI_PATTERN = /\u001b\[[0-9;]*m/gu

/** True for a numeric prerelease identifier. */
const NUMERIC_IDENTIFIER = /^\d+$/u

/**
 * Parse a version string into its components.
 * @param raw - a version, with or without a leading `v`.
 * @returns the parsed version, or `undefined` when the string is not one.
 */
export function parseVersion(raw: string): ParsedVersion | undefined {
  const match = VERSION_PATTERN.exec(raw.trim())
  if (match === null) return undefined
  const prerelease = match[4]
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: prerelease === undefined ? [] : prerelease.split('.'),
  }
}

/**
 * Strip ANSI SGR sequences from a string.
 * @param text - text that may carry terminal colour codes.
 * @returns the same text with colour codes removed.
 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '')
}

/**
 * Compare two versions the way the semantic-versioning rules order them.
 *
 * A release version outranks its own prereleases, numeric identifiers compare
 * numerically, and a longer prerelease outranks a shorter one that is its
 * prefix — so `0.1.5-rc.1 < 0.1.5-rc.2 < 0.1.5`.
 *
 * @param a - left version.
 * @param b - right version.
 * @returns `-1`, `0`, or `1`; `undefined` when either version is unparsable,
 * because an unparsable version must not be silently ordered.
 */
export function compareVersions(a: string, b: string): number | undefined {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (left === undefined || right === undefined) return undefined

  for (const [mine, theirs] of [
    [left.major, right.major],
    [left.minor, right.minor],
    [left.patch, right.patch],
  ] as const) {
    if (mine !== theirs) return mine < theirs ? -1 : 1
  }
  return comparePrerelease(left.prerelease, right.prerelease)
}

/**
 * Whether a found version satisfies a minimum.
 * @param found - the version that is present.
 * @param minimum - the lowest acceptable version.
 * @returns `true` only when `found` is at or above `minimum`; an unparsable
 * either side is `false`, so a gate never passes by accident.
 */
export function meetsMinimum(found: string, minimum: string): boolean {
  const order = compareVersions(found, minimum)
  return order !== undefined && order >= 0
}

/**
 * Recover the openwiki version from the CLI's startup banner.
 * @param output - captured stdout, with or without ANSI codes.
 * @returns the version, or `undefined` when the banner was not present.
 */
export function parseOpenwikiVersion(output: string): string | undefined {
  return BANNER_VERSION_PATTERN.exec(stripAnsi(output))?.[1]
}

/**
 * Recover the bound port from the visualizer's banner.
 *
 * The CLI prints `open:  http://127.0.0.1:<port>` and only ever binds loopback,
 * so this is the authoritative way to learn the port it settled on after
 * incrementing past a busy one.
 *
 * @param output - captured stdout, with or without ANSI codes.
 * @returns the port, or `undefined` when no loopback URL was printed yet.
 */
export function parseVisualizePort(output: string): number | undefined {
  const match = LOOPBACK_URL_PATTERN.exec(stripAnsi(output))
  if (match === null) return undefined
  const port = Number(match[1])
  return isPortInRange(port) ? port : undefined
}

/**
 * Whether a number is a port the openwiki CLI would accept.
 * @param port - the candidate port.
 * @returns `true` when it is an integer within the CLI's accepted range.
 */
export function isPortInRange(port: number): boolean {
  return Number.isInteger(port) && port >= MINIMUM_PORT && port <= MAXIMUM_PORT
}

/**
 * The ports to consider, in order, for one visualizer start.
 *
 * The CLI increments on `EADDRINUSE` for its own attempt budget, so this is the
 * plugin's independent fallback range: when the child dies without printing a
 * banner there is no other way to know which ports it tried.
 *
 * @param preferred - the first port to try.
 * @param attempts - how many candidates to return.
 * @returns the candidate ports, skipping any outside the CLI's range.
 */
export function portCandidates(preferred: number, attempts: number): readonly number[] {
  const wanted = Math.max(0, Math.trunc(attempts))
  const ports: number[] = []
  for (let offset = 0; offset < wanted; offset += 1) {
    const port = preferred + offset
    if (!isPortInRange(port)) break
    ports.push(port)
  }
  return ports
}

/**
 * The argument vector for serving one wiki.
 *
 * `--no-open` is not optional here: the plugin embeds the reader in its own
 * pane, and letting the CLI also launch a system browser would open a second,
 * unasked-for window on every start.
 *
 * @param wikiPath - the wiki directory to serve.
 * @param port - the preferred port.
 * @returns the arguments to pass after the executable.
 */
export function visualizeArgs(wikiPath: string, port: number): readonly string[] {
  return ['visualize', wikiPath, '--port', String(port), '--no-open']
}

/**
 * Decide whether a directory's entries are an initialized openwiki.
 *
 * Scaffolding files do not count as content, so a directory holding only
 * `INSTRUCTIONS.md` — which an interrupted init can leave behind — is correctly
 * reported as having no wiki rather than offering an empty reader.
 *
 * @param entries - the directory's entry names, files and directories alike.
 * @returns whether it is a wiki, and the strongest marker that said so.
 */
export function classifyWikiDir(entries: readonly string[]): WikiDetection {
  const present = new Set(entries)
  const scaffolding = new Set(OPENWIKI_SCAFFOLD_FILES)
  const pages = entries.filter(name => name.endsWith('.md') && !scaffolding.has(name))
  if (pages.length === 0) return { hasWiki: false }
  for (const marker of OPENWIKI_MARKERS) {
    if (!present.has(marker)) continue
    return { hasWiki: true, marker: marker === '.page-manifest.json' ? 'manifest' : 'index' }
  }
  return { hasWiki: true, marker: 'markdown' }
}

/**
 * Compare prerelease identifier lists.
 *
 * Split out because the rules are asymmetric in a way the numeric comparison of
 * major/minor/patch is not: an empty list (a release) outranks every non-empty
 * one, and the comparison is only positional until one list runs out.
 *
 * @param left - left identifiers, empty for a release version.
 * @param right - right identifiers, empty for a release version.
 * @returns `-1`, `0`, or `1`.
 */
function comparePrerelease(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 && right.length === 0) return 0
  if (left.length === 0) return 1
  if (right.length === 0) return -1

  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const mine = left[index]
    const theirs = right[index]
    if (mine === undefined) return -1
    if (theirs === undefined) return 1

    const mineNumeric = NUMERIC_IDENTIFIER.test(mine)
    const theirsNumeric = NUMERIC_IDENTIFIER.test(theirs)
    if (mineNumeric && theirsNumeric) {
      const difference = Number(mine) - Number(theirs)
      if (difference !== 0) return difference < 0 ? -1 : 1
      continue
    }
    if (mineNumeric) return -1
    if (theirsNumeric) return 1
    if (mine !== theirs) return mine < theirs ? -1 : 1
  }
  return 0
}
