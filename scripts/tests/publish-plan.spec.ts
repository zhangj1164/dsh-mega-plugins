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
  waitForDistTag,
  waitForVersion,
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
        dist: {
          attestations: {
            url: 'https://registry.npmjs.org/-/npm/v1/attestations/x',
            provenance: { predicateType: 'https://slsa.dev/provenance/v1' },
          },
        },
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

  it('reads the attestation from the field npm actually writes it to', () => {
    const result = verifyPublished({
      manifest: manifest({
        dist: {
          attestations: {
            url: 'https://registry.npmjs.org/-/npm/v1/attestations/@zhangj1164%2Fdsh-memo@0.7.5',
            provenance: { predicateType: 'https://slsa.dev/provenance/v1' },
          },
        },
      }),
      version: '0.7.5',
      distTags: { latest: '0.7.5' },
      distTag: 'latest',
    })
    expect(result.problems).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.provenance).toBe(
      'https://registry.npmjs.org/-/npm/v1/attestations/@zhangj1164%2Fdsh-memo@0.7.5',
    )
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

describe('waitForVersion', () => {
  it('returns the first readable version without waiting', async () => {
    const slept: number[] = []
    const result = await waitForVersion({
      name: '@zhangj1164/dsh-memo',
      version: '0.7.5',
      registry: 'https://registry.npmjs.org/',
      attempts: 3,
      intervalMs: 1_000,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => manifest() }),
      sleep: async (milliseconds) => {
        slept.push(milliseconds)
      },
    })
    expect(result).toEqual(manifest())
    expect(slept).toEqual([])
  })

  it('retries the 404 a registry replica answers right after a publish', async () => {
    const slept: number[] = []
    let reads = 0
    const result = await waitForVersion({
      name: '@zhangj1164/dsh-memo',
      version: '0.7.5',
      registry: 'https://registry.npmjs.org/',
      attempts: 5,
      intervalMs: 2_000,
      fetchImpl: async () => {
        reads += 1
        return reads < 3
          ? { ok: false, status: 404, json: async () => ({}) }
          : { ok: true, status: 200, json: async () => manifest() }
      },
      sleep: async (milliseconds) => {
        slept.push(milliseconds)
      },
    })
    expect(result).toEqual(manifest())
    expect(reads).toBe(3)
    expect(slept).toEqual([2_000, 2_000])
  })

  it('reports absence only after the whole budget is spent', async () => {
    const slept: number[] = []
    const result = await waitForVersion({
      name: '@zhangj1164/dsh-memo',
      version: '0.7.5',
      registry: 'https://registry.npmjs.org/',
      attempts: 3,
      intervalMs: 500,
      fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }),
      sleep: async (milliseconds) => {
        slept.push(milliseconds)
      },
    })
    expect(result).toBeNull()
    expect(slept).toEqual([500, 500])
  })
})

describe('waitForDistTag', () => {
  it('waits until the dist-tag names the released version', async () => {
    const reads = [{ latest: '0.7.4' }, { latest: '0.7.5' }]
    let index = 0
    const result = await waitForDistTag({
      name: '@zhangj1164/dsh-memo',
      version: '0.7.5',
      distTag: 'latest',
      registry: 'https://registry.npmjs.org/',
      attempts: 4,
      intervalMs: 1_000,
      fetchImpl: async () => {
        const read = reads[Math.min(index, reads.length - 1)]
        index += 1
        return { ok: true, status: 200, json: async () => read }
      },
      sleep: async () => {},
    })
    expect(result).toEqual({ latest: '0.7.5' })
    expect(index).toBe(2)
  })

  it('returns the last document read when the tag never names the version', async () => {
    const result = await waitForDistTag({
      name: '@zhangj1164/dsh-memo',
      version: '0.7.5',
      distTag: 'latest',
      registry: 'https://registry.npmjs.org/',
      attempts: 2,
      intervalMs: 1,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ latest: '0.7.4' }),
      }),
      sleep: async () => {},
    })
    expect(result).toEqual({ latest: '0.7.4' })
  })
})
