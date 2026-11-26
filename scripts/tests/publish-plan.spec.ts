/**
 * Tests for the release plan and registry-copy checks the publish workflows run.
 *
 * The workflows trust these decisions to stop a tag push before it reaches the
 * registry, so the tests pin the three refusals that matter: a tag naming
 * another version, a tag whose version already shipped, and a published
 * manifest that kept a `workspace:` range. The registry itself is never
 * contacted; fetches are injected.
 */
import { describe, expect, it } from 'vitest'
import {
  distTagsUrl,
  planPublish,
  tagVersion,
  verifyPublished,
  versionUrl,
  workspaceRanges,
} from '../publish-plan.ts'

/** A manifest matching the tag used by the publish workflows. */
function manifest(overrides: Record<string, unknown> = {}) {
  return { name: '@zhangj1164/dsh-memo', version: '0.7.5', ...overrides }
}

describe('tagVersion', () => {
  it('reads the version a package tag names', () => {
    expect(tagVersion('memo-v0.7.5', 'memo-v')).toBe('0.7.5')
    expect(tagVersion('memo-v0.7.5-rc.1', 'memo-v')).toBe('0.7.5-rc.1')
  })

  it('rejects a tag for another package', () => {
    expect(tagVersion('ui-memo-v0.7.5', 'memo-v')).toBeNull()
  })

  it('rejects an incomplete or decorated version', () => {
    expect(tagVersion('memo-v0.7', 'memo-v')).toBeNull()
    expect(tagVersion('memo-v0.7.5+build', 'memo-v')).toBeNull()
    expect(tagVersion('memo-v', 'memo-v')).toBeNull()
  })
})

describe('planPublish', () => {
  it('allows a tag whose version is new', () => {
    const plan = planPublish({
      manifest: manifest(),
      tag: 'memo-v0.7.5',
      tagPrefix: 'memo-v',
      published: false,
      dispatch: false,
    })
    expect(plan).toMatchObject({ version: '0.7.5', tag: 'memo-v0.7.5', skip: false })
  })

  it('refuses a tag that names another version', () => {
    expect(() =>
      planPublish({
        manifest: manifest({ version: '0.7.6' }),
        tag: 'memo-v0.7.5',
        tagPrefix: 'memo-v',
        published: false,
        dispatch: false,
      }),
    ).toThrow(/names 0\.7\.5, but @zhangj1164\/dsh-memo declares 0\.7\.6/u)
  })

  it('refuses a tag push for a version already on the registry', () => {
    expect(() =>
      planPublish({
        manifest: manifest(),
        tag: 'memo-v0.7.5',
        tagPrefix: 'memo-v',
        published: true,
        dispatch: false,
      }),
    ).toThrow(/already on the registry/u)
  })

  it('lets a manual dispatch re-verify an existing release without publishing', () => {
    const plan = planPublish({
      manifest: manifest(),
      tag: 'memo-v0.7.5',
      tagPrefix: 'memo-v',
      published: true,
      dispatch: true,
    })
    expect(plan.skip).toBe(true)
  })

  it('refuses a private package and a tag from another prefix', () => {
    expect(() =>
      planPublish({
        manifest: manifest({ private: true }),
        tag: 'memo-v0.7.5',
        tagPrefix: 'memo-v',
        published: false,
        dispatch: false,
      }),
    ).toThrow(/marked private/u)

    expect(() =>
      planPublish({
        manifest: manifest(),
        tag: 'ui-memo-v0.7.5',
        tagPrefix: 'memo-v',
        published: false,
        dispatch: false,
      }),
    ).toThrow(/does not match/u)
  })
})

describe('workspaceRanges', () => {
  it('finds the protocol in every dependency field', () => {
    const ranges = workspaceRanges(
      manifest({
        dependencies: { '@zhangj1164/dsh-client-ui-memo': '^0.7.0' },
        peerDependencies: { '@zhangj1164/dsh-telemetry': 'workspace:^' },
        devDependencies: { '@zhangj1164/dsh-github-issue': 'workspace:*' },
        optionalDependencies: { '@zhangj1164/dsh-memo': 'workspace:^' },
      }),
    )
    expect(ranges).toEqual([
      'devDependencies: @zhangj1164/dsh-github-issue@workspace:*',
      'peerDependencies: @zhangj1164/dsh-telemetry@workspace:^',
      'optionalDependencies: @zhangj1164/dsh-memo@workspace:^',
    ])
  })

  it('ignores ordinary ranges and non-object fields', () => {
    expect(
      workspaceRanges(manifest({ dependencies: { zod: '^4.6.7' }, peerDependencies: null })),
    ).toEqual([])
  })
})

describe('verifyPublished', () => {
  it('accepts a registry copy the tag promised', () => {
    const result = verifyPublished({
      manifest: manifest({
        dist: { attestations: { provenance: { url: 'https://registry.npmjs.org/-/npm/v1/attestations/x' } } },
      }),
      version: '0.7.5',
      distTags: { latest: '0.7.5' },
      distTag: 'latest',
    })
    expect(result.problems).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.provenance).toContain('attestations')
  })

  it('fails when the version never reached the registry', () => {
    const result = verifyPublished({
      manifest: null,
      version: '0.7.5',
      distTags: null,
      distTag: 'latest',
    })
    expect(result.problems).toEqual(['0.7.5 is not on the registry at all'])
  })

  it('fails on a version mismatch, a workspace range, and a moved dist-tag', () => {
    const result = verifyPublished({
      manifest: manifest({
        version: '0.7.4',
        peerDependencies: { '@zhangj1164/dsh-telemetry': 'workspace:^' },
      }),
      version: '0.7.5',
      distTags: { latest: '0.7.4' },
      distTag: 'latest',
    })
    expect(result.problems).toEqual([
      'registry reports version 0.7.4, expected 0.7.5',
      'published manifest still declares a workspace: range (peerDependencies: @zhangj1164/dsh-telemetry@workspace:^)',
      'dist-tag "latest" points at 0.7.4, expected 0.7.5',
    ])
  })

  it('warns but does not fail when provenance is absent', () => {
    const result = verifyPublished({
      manifest: manifest(),
      version: '0.7.5',
      distTags: { latest: '0.7.5' },
      distTag: 'latest',
    })
    expect(result.problems).toEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toMatch(/no provenance attestation/u)
  })
})

describe('registry URLs', () => {
  it('encodes the scope separator and normalizes the registry', () => {
    expect(versionUrl('@zhangj1164/dsh-memo', '0.7.5', 'https://registry.npmjs.org')).toBe(
      'https://registry.npmjs.org/@zhangj1164%2Fdsh-memo/0.7.5',
    )
    expect(distTagsUrl('@zhangj1164/dsh-memo', 'https://registry.npmjs.org/')).toBe(
      'https://registry.npmjs.org/-/package/@zhangj1164%2Fdsh-memo/dist-tags',
    )
  })
})
