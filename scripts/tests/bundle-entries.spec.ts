/**
 * Tests for the bundle-entry gate.
 *
 * The gate exists to catch a deployment-breaking configuration this repository
 * can create: two bundles that insert the same composition entry id, which the
 * loader rejects outright and no bundle layer can reconcile. Every entry id in
 * this repository has exactly one owning bundle, so the workspace-wide
 * assertion expects no overlap at all; the exclusion check is retained and
 * tested so a deliberate overlap stays expressible.
 *
 * These tests pin the parsing and collision rules only. The workspace-wide
 * assertion lives in the gate itself.
 */
import { describe, expect, it } from 'vitest'
import { findCollisions, findUninstallableRows, mentionsExclusion, parseInsertIds, parseInsertRows } from '../verify-bundle-entries.ts'

/** Build a bundle fixture from a patch body. */
function bundle(pkg: string, patch: string) {
  const rows = parseInsertRows(patch, pkg)
  return {
    package: pkg,
    dir: process.cwd(),
    patchPath: `${pkg}/cordis.patch.yml`,
    rows,
    ids: rows.map(row => row.id),
    raw: patch,
  }
}

describe('parseInsertIds', () => {
  it('reads ids from an inline `- insert:` sequence', () => {
    const patch = [
      '- insert:',
      '    - id: telemetry',
      '      name: dsh-telemetry',
    ].join('\n')
    expect(parseInsertIds(patch, 'fixture')).toEqual(['telemetry'])
  })

  it('reads ids from a nested insert sequence at any consistent indent', () => {
    const fourSpace = ['- insert:', '    - id: telemetry', '      name: dsh-telemetry'].join('\n')
    const zeroSpace = ['- insert:', '  - id: telemetry', '    name: dsh-telemetry'].join('\n')
    expect(parseInsertIds(fourSpace, 'fixture')).toEqual(['telemetry'])
    expect(parseInsertIds(zeroSpace, 'fixture')).toEqual(['telemetry'])
  })

  it('reads every id of a multi-entry insert', () => {
    const patch = [
      '- insert:',
      '    - id: github-issue',
      '      name: dsh-github-issue',
      '    - id: memo',
      '      name: dsh-memo',
      '    - id: ui-memo',
      '      name: dsh-client-ui-memo',
    ].join('\n')
    expect(parseInsertIds(patch, 'fixture')).toEqual(['github-issue', 'memo', 'ui-memo'])
  })

  it('ignores ids that appear before any insert key', () => {
    const patch = ['id: not-an-entry', '- id: also-not-an-entry'].join('\n')
    expect(() => parseInsertIds(patch, 'fixture')).toThrow(/inserts no entry id/u)
  })

  it('ignores a commented-out entry', () => {
    const patch = ['- insert:', '    - id: telemetry', '    # - id: commented-out'].join('\n')
    expect(parseInsertIds(patch, 'fixture')).toEqual(['telemetry'])
  })

  it('reads an id whose value contains a hash', () => {
    const patch = ['- insert:', '    - id: "telemetry#v2"'].join('\n')
    expect(parseInsertIds(patch, 'fixture')).toEqual(['telemetry#v2'])
  })

  it('rejects a patch that inserts nothing', () => {
    expect(() => parseInsertIds('# only a comment\n', 'fixture')).toThrow(
      /fixture declares a bundle patch but inserts no entry id/u,
    )
  })
})

describe('parseInsertRows', () => {
  it('reads the package each row names', () => {
    const patch = [
      '- insert:',
      '    - id: memo',
      '      name: "@zhangj1164/dsh-memo"',
      '      config:',
      '        repoUrl: https://example.test/repo',
      '    - id: ui-memo',
      "      name: '@zhangj1164/dsh-client-ui-memo'",
    ].join('\n')
    expect(parseInsertRows(patch, 'fixture')).toEqual([
      { id: 'memo', name: '@zhangj1164/dsh-memo' },
      { id: 'ui-memo', name: '@zhangj1164/dsh-client-ui-memo' },
    ])
  })

  it('leaves a row nameless when the patch names no package', () => {
    const patch = ['- insert:', '    - id: telemetry', '      config:', '        name: not-a-row-name'].join('\n')
    expect(parseInsertRows(patch, 'fixture')).toEqual([{ id: 'telemetry' }])
  })

  it('ignores a commented-out row', () => {
    const patch = ['- insert:', '    - id: telemetry', '      name: dsh-telemetry', '    # - id: memo'].join('\n')
    expect(parseInsertRows(patch, 'fixture')).toEqual([{ id: 'telemetry', name: 'dsh-telemetry' }])
  })
})

describe('findUninstallableRows', () => {
  const workspace = [
    { name: 'host', dir: 'host', dependencies: { panel: '^0.7.0', proto: 'workspace:^' } },
    { name: 'panel', dir: 'panel', dependencies: {} },
    { name: 'peerly', dir: 'peerly', dependencies: {} },
    { name: 'proto', dir: 'proto', dependencies: {} },
  ]
  const patch = (id: string, name: string) => `- insert:\n    - id: ${id}\n      name: ${name}`

  it('accepts a row whose package the bundle depends on with a plain range', () => {
    expect(findUninstallableRows([bundle('host', patch('panel', 'panel'))], workspace)).toEqual([])
  })

  it('accepts a row composing the bundle itself', () => {
    expect(findUninstallableRows([bundle('host', patch('host', 'host'))], workspace)).toEqual([])
  })

  it('rejects a row whose package is not declared at all', () => {
    const rows = findUninstallableRows([bundle('host', patch('peerly', 'peerly'))], workspace)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.name).toBe('peerly')
    expect(rows[0]!.detail).toContain('its manifest does not depend on it')
  })

  it('rejects a workspace: range, which a git install cannot resolve', () => {
    const rows = findUninstallableRows([bundle('host', patch('proto', 'proto'))], workspace)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.detail).toContain('ERR_PNPM_WORKSPACE_PKG_NOT_FOUND')
  })

  it('leaves a package outside the workspace alone', () => {
    expect(findUninstallableRows([bundle('host', patch('external', '@acme/panel'))], workspace)).toEqual([])
  })
})

describe('mentionsExclusion', () => {
  it('requires both the id and the exclusivity marker', () => {
    expect(mentionsExclusion('# this inserts github-issue; use not both\n', 'github-issue')).toBe(true)
    expect(mentionsExclusion('# this inserts github-issue\n', 'github-issue')).toBe(false)
    expect(mentionsExclusion('# use not both\n', 'github-issue')).toBe(false)
  })

  it('does not accept a phrase that merely contains the words in another order', () => {
    // The wording that motivated the marker: "do not enable both" has no
    // `not both` substring, so it never satisfied the check.
    expect(mentionsExclusion('# do not enable both; github-issue here\n', 'github-issue')).toBe(false)
  })

  it('does not let a near-miss id satisfy the check', () => {
    expect(mentionsExclusion('# use not both; this inserts github-issue-x\n', 'github-issue')).toBe(false)
  })
})

describe('findCollisions', () => {
  it('accepts distinct bundles', () => {
    expect(findCollisions([
      bundle('a', '- insert:\n    - id: alpha'),
      bundle('b', '- insert:\n    - id: beta'),
    ])).toEqual([])
  })

  it('accepts a shared id when both patches record the exclusion', () => {
    const patch = (name: string) => `# inserts github-issue; use not both\n- insert:\n    - id: github-issue\n      name: ${name}`
    expect(findCollisions([
      bundle('a', patch('a')),
      bundle('b', patch('b')),
    ])).toEqual([])
  })

  it('rejects a shared id one patch never documents', () => {
    const documented = '# inserts github-issue; use not both\n- insert:\n    - id: github-issue'
    const silent = '- insert:\n    - id: github-issue'
    const collisions = findCollisions([bundle('a', documented), bundle('b', silent)])
    expect(collisions).toHaveLength(1)
    expect(collisions[0]!.id).toBe('github-issue')
    expect(collisions[0]!.detail).toContain('"b" does not record it as mutually exclusive')
  })

  it('rejects a shared id neither patch documents', () => {
    const collisions = findCollisions([
      bundle('a', '- insert:\n    - id: gamma'),
      bundle('b', '- insert:\n    - id: gamma'),
    ])
    expect(collisions).toHaveLength(1)
    expect(collisions[0]!.detail).toContain('"a" and "b" both insert "gamma"')
    expect(collisions[0]!.detail).toContain('does not record it as mutually exclusive')
  })

  it('rejects one patch inserting the same id twice', () => {
    const collisions = findCollisions([
      bundle('a', '- insert:\n    - id: alpha\n    - id: alpha'),
    ])
    expect(collisions).toHaveLength(1)
    expect(collisions[0]!.detail).toContain('inserts "alpha" 2 times in one patch')
  })
})
