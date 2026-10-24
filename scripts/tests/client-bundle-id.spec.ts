/**
 * Tests for the client-bundle boot gate.
 *
 * The gate exists to catch a specific, shipped defect: a bundle whose
 * registration id drifted from the package name after a rename, which the
 * browser reports only as `bundle … loaded without registering` — a message that
 * names neither the package nor the fix. These tests pin the two extraction
 * rules (registration id, require specifiers) and the declared-row check.
 */
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import {
  checkClientBundle,
  checkDeclaredRows,
  hasNonLiteralRequire,
  literalRequires,
  registrationId,
} from '../verify-client-bundle-id.ts'

const ID = '@zhangj1164/dsh-client-ui-memo'

/** A bundle that registers `id` and requires `specifiers`. */
function bundle(id: string, specifiers: readonly string[]): string {
  return [
    `window.__ModuleLoader__.load({ id: "${id}", factory: (require) => {`,
    'var module = { exports: {} }; var exports = module.exports;',
    ...specifiers.map(specifier => `var dep = require("${specifier}");`),
    'return module.exports; } });',
  ].join('\n')
}

describe('registrationId', () => {
  it('reads the id out of the handoff', () => {
    expect(registrationId(bundle(ID, []))).toBe(ID)
  })

  it('reads a single-quoted id and tolerates whitespace', () => {
    expect(registrationId("window.__ModuleLoader__.load( { id : 'x/y' , factory: (r) => {")).toBe('x/y')
  })

  it('reports a bundle that registers nothing', () => {
    expect(registrationId('console.log("no handoff")')).toBeUndefined()
  })
})

describe('literalRequires', () => {
  it('collects specifiers in bundle order without matching the factory parameter', () => {
    expect(literalRequires(bundle(ID, ['react', '@deepseek-ai/dsh-client-store'])))
      .toEqual(['react', '@deepseek-ai/dsh-client-store'])
  })

  it('separates a non-literal call from the literal ones', () => {
    const source = `${bundle(ID, ['react'])}\nvar lazy = require(name);`
    expect(literalRequires(source)).toEqual(['react'])
    expect(hasNonLiteralRequire(source)).toBe(true)
  })
})

describe('checkClientBundle', () => {
  const words = new Set(['react', 'react/jsx-runtime'])

  it('accepts a bundle whose id matches and whose requires are table words', () => {
    expect(checkClientBundle({
      package: ID,
      source: bundle(ID, ['react', 'react/jsx-runtime']),
      expectedId: ID,
      words,
    })).toEqual([])
  })

  it('rejects the shipped regression: a registration id that is not the package name', () => {
    // Exactly what the rename left behind: the unscoped name in the banner.
    const violations = checkClientBundle({
      package: ID,
      source: bundle('dsh-client-ui-memo', ['react']),
      expectedId: ID,
      words,
    })
    expect(violations).toHaveLength(1)
    expect(violations[0]!.detail).toContain('registers "dsh-client-ui-memo"')
    expect(violations[0]!.detail).toContain(`row is "${ID}"`)
  })

  it('rejects a require the module table cannot answer', () => {
    const violations = checkClientBundle({
      package: ID,
      source: bundle(ID, ['react', 'zod']),
      expectedId: ID,
      words,
    })
    expect(violations).toHaveLength(1)
    expect(violations[0]!.detail).toContain('requires "zod"')
  })

  it('rejects a bundle with no handoff at all', () => {
    const violations = checkClientBundle({
      package: ID,
      source: 'console.log("not a plugin bundle")',
      expectedId: ID,
      words,
    })
    expect(violations).toHaveLength(1)
    expect(violations[0]!.detail).toContain('registers no id')
  })
})

describe('checkDeclaredRows', () => {
  const dir = fileURLToPath(new URL('../../packages/client/ui-memo/', import.meta.url))

  it('accepts the rows this repository declares', () => {
    expect(checkDeclaredRows(ID, dir, {
      inject: ['@deepseek-ai/dsh-client-ui-theme', 'react'],
      external: [],
    })).toEqual([])
  })

  it('rejects a row that resolves to no installed package', () => {
    const violations = checkDeclaredRows(ID, dir, { inject: ['@deepseek-ai/dsh-client-ui-nope'] })
    expect(violations).toHaveLength(1)
    expect(violations[0]!.detail).toContain('does not resolve')
  })

  it('rejects a row whose package declares no client half', () => {
    // `@zhangj1164/dsh-memo` is installed but is a wire/type face, not a boot row.
    const violations = checkDeclaredRows(ID, dir, { external: ['@zhangj1164/dsh-memo/client'] })
    expect(violations).toHaveLength(1)
    expect(violations[0]!.detail).toContain('declares no dsh.client')
  })

  it('rejects a declared row that is not a bare package specifier', () => {
    const violations = checkDeclaredRows(ID, dir, { inject: ['./local.ts'] })
    expect(violations).toHaveLength(1)
    expect(violations[0]!.detail).toContain('not a bare package specifier')
  })
})
