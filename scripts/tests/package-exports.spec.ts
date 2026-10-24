/**
 * Tests for the package-export gate.
 *
 * The gate exists to catch a specific, shipped defect: `exports` entries that
 * name a build path the tsdown layout never produces. `import type` still
 * type-checks against such a map, so the breakage stays hidden until a
 * consumer imports the subpath at runtime.
 *
 * These tests pin the resolution rules only. The workspace-wide assertion
 * lives in the gate itself, because it reads `lib/`, which is build output and
 * absent from a clean checkout; a unit test asserting it would fail on any
 * machine that had not built yet.
 */
import { describe, expect, it } from 'vitest'
import { checkPackage } from '../verify-package-exports.ts'

/** Build a candidate whose declarations point at `target`. */
function candidate(exportsField: unknown, extra: Record<string, unknown> = {}) {
  return {
    dir: process.cwd(),
    manifest: { name: 'fixture', exports: exportsField, ...extra },
  } as unknown as Parameters<typeof checkPackage>[0]
}

describe('checkPackage', () => {
  it('accepts export targets that exist', () => {
    expect(checkPackage(candidate({
      '.': { types: './package.json', default: './package.json' },
    }))).toEqual([])
  })

  it('rejects a missing runtime target', () => {
    const violations = checkPackage(candidate({
      './client': { default: './lib/does-not-exist.js' },
    }))
    expect(violations).toHaveLength(1)
    expect(violations[0]!.detail).toContain('runtime target ./lib/does-not-exist.js does not exist')
  })

  it('rejects the nested layout the flat tsdown output never produces', () => {
    // The exact shape that shipped: `lib/types/client.js` when tsdown emits
    // `lib/client.js`.
    const violations = checkPackage(candidate({
      './client': { types: './lib/types/client.d.ts', default: './lib/types/client.js' },
    }))
    expect(violations).toHaveLength(2)
    expect(violations[0]!.detail).toContain('types target ./lib/types/client.d.ts')
    expect(violations[1]!.detail).toContain('runtime target ./lib/types/client.js')
  })

  it('rejects a missing types target for a host package', () => {
    const violations = checkPackage(candidate({
      '.': { types: './lib/types/index.d.ts', default: './package.json' },
    }))
    expect(violations).toHaveLength(1)
    expect(violations[0]!.detail).toContain('types target ./lib/types/index.d.ts does not exist')
  })

  it('reports the subpath of the offending declaration', () => {
    const violations = checkPackage(candidate({
      '.': { default: './package.json' },
      './types': { default: './lib/types.js' },
    }))
    expect(violations).toHaveLength(1)
    expect(violations[0]!.detail).toContain('exports["./types"]')
  })

  it('rejects an absent client declaration even when the package ships a client face', () => {
    // A bundled browser face still owes its consumers declarations: the shape
    // that shipped was `./client` naming a `lib/client.d.ts` no build emitted.
    const violations = checkPackage(candidate(
      { './client': { types: './lib/client.d.ts', default: './package.json' } },
      { dsh: { client: { platform: 'web' } } },
    ))
    expect(violations).toHaveLength(1)
    expect(violations[0]!.detail).toContain('types target ./lib/client.d.ts does not exist')
  })

  it('rejects a missing client runtime target for a client-face package', () => {
    const violations = checkPackage(candidate(
      { './client': { types: './lib/client.d.ts', default: './lib/client.js' } },
      { dsh: { client: { platform: 'web' } } },
    ))
    expect(violations).toHaveLength(2)
    expect(violations[0]!.detail).toContain('types target')
    expect(violations[1]!.detail).toContain('runtime target')
  })

  it('rejects a missing root types field for a client-face package', () => {
    const violations = checkPackage(candidate({}, {
      types: './lib/client.d.ts',
      dsh: { client: { platform: 'web' } },
    }))
    expect(violations).toHaveLength(1)
    expect(violations[0]!.detail).toBe('types target ./lib/client.d.ts does not exist')
  })

  it('treats a bare string export as a runtime target', () => {
    const violations = checkPackage(candidate({
      './package.json': './package.json',
      './missing': './lib/missing.js',
    }))
    expect(violations).toHaveLength(1)
    expect(violations[0]!.detail).toContain('./lib/missing.js')
  })

  it('checks the root main and types fields', () => {
    const violations = checkPackage(candidate({}, {
      main: './lib/index.js',
      types: './lib/types/index.d.ts',
    }))
    expect(violations.map(violation => violation.detail)).toEqual([
      'main target ./lib/index.js does not exist',
      'types target ./lib/types/index.d.ts does not exist',
    ])
  })
})
