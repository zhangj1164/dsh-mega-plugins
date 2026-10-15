/**
 * Refuse a publish that would ship `workspace:` ranges to the registry.
 *
 * A pnpm workspace writes cross-package ranges as `workspace:^` / `workspace:*`.
 * Only `pnpm publish` substitutes the referenced package's real version at pack
 * time, in `dependencies`, `devDependencies` and `peerDependencies` alike. npm
 * copies the protocol through verbatim, so the registry manifest ships
 * `"@scope/dep": "workspace:^"` — a range no npm install can resolve
 * (`EUNSUPPORTEDPROTOCOL: Unsupported URL Type "workspace:"`). pnpm merely warns
 * about the protocol, so a workspace-local install proves nothing about the
 * published package and the defect stays invisible until an npm consumer tries
 * to install it. `@zhangj1164/dsh-memo@0.1.0` reached the catalog exactly that
 * way.
 *
 * This script does not re-implement the rewrite. It checks the one fact that
 * decides whether the rewrite happens — which packer is running — and stops the
 * publish when the packer cannot do it. Every package that declares a
 * `workspace:` range runs it as `prepublishOnly`, which npm and pnpm both run
 * before packing on `publish`; neither runs it on a git install, so the
 * git-install path is unaffected. `pnpm run verify-publish-guard` asserts that
 * wiring for every workspace package.
 *
 * The guard fails closed. A packer it cannot identify is treated as unsafe
 * rather than as pnpm, because the cost of a wrong "allow" is a manifest no npm
 * user can install, while the cost of a wrong "refuse" is one explicit command.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Dependency fields whose ranges the packer rewrites at pack time. */
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
]

/**
 * Whether one range can only be expressed inside the pnpm workspace.
 * @param range - a dependency range from the manifest.
 * @returns true for the `workspace:` protocol.
 */
function isWorkspaceRange(range) {
  return typeof range === 'string' && range.startsWith('workspace:')
}

/**
 * Collect every `workspace:` range a manifest declares.
 * @param manifest - the parsed package manifest.
 * @returns one `field: name@range` description per workspace range.
 */
function collectWorkspaceRanges(manifest) {
  const found = []
  for (const field of DEPENDENCY_FIELDS) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      if (isWorkspaceRange(range)) found.push(`${field}: ${name}@${range}`)
    }
  }
  return found
}

/**
 * Decide whether the current packer may publish this package.
 * @returns the process exit code.
 */
function main() {
  const manifestPath = resolve(process.cwd(), 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const ranges = collectWorkspaceRanges(manifest)

  if (ranges.length === 0) {
    console.log(`publish-guard: ${manifest.name} declares no workspace: range; any packer is safe.`)
    return 0
  }

  const userAgent = process.env.npm_config_user_agent ?? ''
  const packer = userAgent.split('/')[0]

  if (packer === 'pnpm') {
    console.log(`publish-guard: pnpm rewrites ${ranges.length} workspace: range(s) in ${manifest.name}.`)
    for (const range of ranges) console.log(`  ${range}`)
    return 0
  }

  const observed = packer === '' ? 'no packer in $npm_config_user_agent' : `packer ${JSON.stringify(packer)}`
  console.error(`publish-guard: refusing to publish ${manifest.name} (${observed}).`)
  console.error('')
  console.error(`This manifest declares ${ranges.length} workspace: range(s):`)
  for (const range of ranges) console.error(`  ${range}`)
  console.error('')
  console.error('Only pnpm publish substitutes the referenced version for those ranges. Another packer')
  console.error('writes the protocol through verbatim, and the registry copy then fails for every npm')
  console.error('consumer with EUNSUPPORTEDPROTOCOL: Unsupported URL Type "workspace:".')
  console.error('')
  console.error('Publish with pnpm from an up-to-date main, then verify the registry copy:')
  console.error(`  pnpm publish --filter ${manifest.name}`)
  console.error(`  npm view ${manifest.name}@<version> peerDependencies   # must show no workspace: range`)
  return 1
}

process.exitCode = main()
