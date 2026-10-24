import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The Remote protocol binds arguments **by name**: the client sends
 * `{ args: { request } }`, so every exported method must declare a parameter
 * called exactly `request`.
 *
 * This is not a style rule. `listArchivedQuarters` was once declared with no
 * parameter at all, and the call was rejected before the method body ran — the
 * host archived 13 quarters while the client's read of them returned nothing, so
 * a whole feature looked like it did nothing. Nothing in the suite noticed,
 * because the client tests answer through a fake RPC and the host tests call the
 * method directly: the seam between them is exactly where the bug lived.
 *
 * The check reads the source because the wire name comes from the declaration.
 */
describe('Remote method declarations', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../src/index.ts', import.meta.url)),
    'utf8',
  )

  /** Every `@Remote('name')` and the method signature that follows it. */
  function declarations(): { name: string; signature: string }[] {
    const found: { name: string; signature: string }[] = []
    const pattern = /@Remote\('([^']+)'\)\s*\n\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/gu
    for (const match of source.matchAll(pattern)) {
      found.push({ name: match[1]!, signature: (match[3] ?? '').trim() })
    }
    return found
  }

  it('finds the Remote methods it is meant to be checking', () => {
    // Guard against the pattern silently matching nothing after a refactor,
    // which would turn this whole file into a no-op that always passes.
    const found = declarations()
    expect(found.length).toBeGreaterThan(10)
    expect(found.map(entry => entry.name)).toContain('listArchivedQuarters')
  })

  it('declares a `request` parameter on every Remote method', () => {
    const wrong = declarations()
      .filter(entry => !/^request\s*[?:]/.test(entry.signature))
      .map(entry => `${entry.name}(${entry.signature})`)
    expect(wrong).toEqual([])
  })

  it('never declares more than the one request parameter', () => {
    // A second parameter would need its own wire name the client does not send.
    const wrong = declarations()
      .filter(entry => entry.signature.split(',').length > 1)
      .map(entry => `${entry.name}(${entry.signature})`)
    expect(wrong).toEqual([])
  })
})
