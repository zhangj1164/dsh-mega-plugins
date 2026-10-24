/**
 * Tests for the shared client-bundle preset.
 *
 * The preset's job is to keep one fact in one place: the registration id, the
 * manifest that declares it, and the module-table words a bundle may require.
 * The workspace-wide consequence lives in the build and in the
 * `verify-client-bundle-id` gate; these tests pin the resolution rules those two
 * depend on.
 */
import { describe, expect, it } from 'vitest'
import {
  PLATFORM_MODULES,
  clientBundle,
  clientFaceTarget,
  moduleTableWords,
  packageNameOf,
  workspacePackage,
} from '../tsdown.client.ts'

describe('workspacePackage', () => {
  it('locates a workspace package by name', () => {
    const located = workspacePackage('@zhangj1164/dsh-client-ui-memo')
    expect(located.manifest.name).toBe('@zhangj1164/dsh-client-ui-memo')
    expect(located.dir.endsWith('packages\\client\\ui-memo') || located.dir.endsWith('packages/client/ui-memo')).toBe(true)
  })

  it('rejects a name no workspace manifest declares', () => {
    // The failure a stale id produces: the preset call site names a package that
    // does not exist, which must stop the build rather than emit a bundle under
    // an id no boot graph row has.
    expect(() => workspacePackage('@zhangj1164/dsh-client-does-not-exist')).toThrow(/declares the name/)
  })
})

describe('clientBundle', () => {
  it('refuses an id that differs from the package manifest name', () => {
    expect(() => clientBundle('@zhangj1164/dsh-client-ui-memo-stale', ['src/index.ts']))
      .toThrow(/declares the name/)
  })

  it('stamps the package name into the client handoff and pins the artifact', () => {
    const [node, client, declarations] = clientBundle(
      '@zhangj1164/dsh-client-ui-memo',
      ['src/index.ts', 'src/invariant.ts'],
    )
    expect(node?.entry).toEqual(['src/index.ts', 'src/invariant.ts'])
    expect(node?.dts).toBe(true)
    expect(node?.clean).toBe(true)

    const output = client?.outputOptions as Record<string, string> | undefined
    expect(output?.entryFileNames).toBe('client.js')
    expect(output?.banner).toContain('window.__ModuleLoader__.load({ id: "@zhangj1164/dsh-client-ui-memo"')
    expect(client?.format).toEqual(['cjs'])
    // The node half already cleaned lib/, so the later writes must not clean it
    // again — a concurrent clean would delete their own output.
    expect(client?.clean).toBe(false)

    expect(declarations?.dts).toEqual({ emitDtsOnly: true })
    expect(declarations?.clean).toBe(false)
  })

  it('keeps platform modules external and inlines everything else', () => {
    const [, client] = clientBundle('@zhangj1164/dsh-client-ui-memo', ['src/index.ts'])
    const deps = client?.deps as {
      neverBundle: (specifier: string) => boolean
      alwaysBundle: (specifier: string) => boolean
    } | undefined
    expect(deps?.neverBundle('react')).toBe(true)
    expect(deps?.neverBundle('react/jsx-runtime')).toBe(true)
    // `zod` is part of the 0.2.x shell seed table, so it stays external too.
    expect(deps?.neverBundle('zod')).toBe(true)
    // A workspace package with no client half is a wire layer: inlined, which is
    // what its type-only imports already reduce to.
    expect(deps?.neverBundle('@zhangj1164/dsh-memo/client')).toBe(false)
    expect(deps?.alwaysBundle('@zhangj1164/dsh-memo/client')).toBe(true)
  })
})

describe('moduleTableWords', () => {
  it('answers the platform baseline', () => {
    const words = moduleTableWords(undefined)
    for (const word of PLATFORM_MODULES) expect(words.has(word)).toBe(true)
    expect(words.has('zod')).toBe(true)
  })

  it('adds both spellings of every declared row', () => {
    const words = moduleTableWords({
      inject: ['@deepseek-ai/dsh-client-ui-theme'],
      external: ['@deepseek-ai/dsh-client-ui-layout/client'],
    })
    expect(words.has('@deepseek-ai/dsh-client-ui-theme')).toBe(true)
    expect(words.has('@deepseek-ai/dsh-client-ui-theme/client')).toBe(true)
    expect(words.has('@deepseek-ai/dsh-client-ui-layout/client')).toBe(true)
    expect(words.has('@deepseek-ai/dsh-client-ui-layout')).toBe(true)
  })

  it('rejects a malformed declaration instead of silently answering nothing', () => {
    expect(() => moduleTableWords({ inject: [42] })).toThrow(/must be a string array/)
  })
})

describe('clientFaceTarget', () => {
  it('reads the default of the ./client face', () => {
    expect(clientFaceTarget({ exports: { './client': { types: './lib/client.d.ts', default: './lib/client.js' } } }))
      .toBe('./lib/client.js')
  })

  it('accepts a bare string face and reports a missing one', () => {
    expect(clientFaceTarget({ exports: { './client': './lib/client.js' } })).toBe('./lib/client.js')
    expect(clientFaceTarget({ exports: { '.': './lib/index.js' } })).toBeUndefined()
  })
})

describe('packageNameOf', () => {
  it('extracts the owning package of a specifier', () => {
    expect(packageNameOf('@deepseek-ai/dsh-client-ui-slots/client')).toBe('@deepseek-ai/dsh-client-ui-slots')
    expect(packageNameOf('@deepseek-ai/dsh-client-ui-slots')).toBe('@deepseek-ai/dsh-client-ui-slots')
    expect(packageNameOf('react-dom/client')).toBe('react-dom')
    expect(packageNameOf('./logic.ts')).toBeUndefined()
  })
})
