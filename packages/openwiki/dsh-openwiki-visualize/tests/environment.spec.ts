import { describe, expect, it } from 'vitest'
import {
  classifyWikiDir,
  compareVersions,
  isPortInRange,
  MAXIMUM_PORT,
  meetsMinimum,
  MINIMUM_PORT,
  parseOpenwikiVersion,
  parseVersion,
  parseVisualizePort,
  portCandidates,
  quoteForWindowsCommandLine,
  stripAnsi,
  visualizeArgs,
} from '../src/environment.ts'

describe('parseVersion', () => {
  it('splits a release version', () => {
    expect(parseVersion('0.7.2')).toEqual({ major: 0, minor: 7, patch: 2, prerelease: [] })
  })

  it('accepts a leading v', () => {
    expect(parseVersion('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] })
  })

  it('keeps prerelease identifiers', () => {
    expect(parseVersion('0.1.5-rc.1')).toEqual({ major: 0, minor: 1, patch: 5, prerelease: ['rc', '1'] })
  })

  it('rejects a non-version', () => {
    expect(parseVersion('not-a-version')).toBeUndefined()
    expect(parseVersion('')).toBeUndefined()
  })
})

describe('compareVersions', () => {
  it('orders by major, minor, then patch', () => {
    expect(compareVersions('1.0.0', '0.9.9')).toBe(1)
    expect(compareVersions('0.2.0', '0.1.9')).toBe(1)
    expect(compareVersions('0.7.2', '0.7.1')).toBe(1)
    expect(compareVersions('0.7.2', '0.7.2')).toBe(0)
  })

  it('ranks a release above its own prereleases', () => {
    expect(compareVersions('0.1.5', '0.1.5-rc.1')).toBe(1)
    expect(compareVersions('0.1.5-rc.1', '0.1.5')).toBe(-1)
  })

  it('orders prerelease identifiers positionally', () => {
    expect(compareVersions('0.1.5-rc.1', '0.1.5-rc.2')).toBe(-1)
    expect(compareVersions('0.1.5-rc.2', '0.1.5-rc.10')).toBe(-1)
    expect(compareVersions('0.1.5-alpha', '0.1.5-beta')).toBe(-1)
  })

  it('ranks a numeric identifier below an alphabetic one', () => {
    expect(compareVersions('0.1.5-1', '0.1.5-alpha')).toBe(-1)
  })

  it('returns undefined rather than guessing for an unparsable version', () => {
    expect(compareVersions('0.7.2', 'unknown')).toBeUndefined()
    expect(compareVersions('bogus', '0.7.2')).toBeUndefined()
  })
})

describe('meetsMinimum', () => {
  it('accepts the minimum itself', () => {
    expect(meetsMinimum('0.7.2', '0.7.2')).toBe(true)
  })

  it('accepts anything above it', () => {
    expect(meetsMinimum('0.8.0', '0.7.2')).toBe(true)
    expect(meetsMinimum('1.0.0', '0.7.2')).toBe(true)
  })

  it('refuses anything below it', () => {
    expect(meetsMinimum('0.7.1', '0.7.2')).toBe(false)
    expect(meetsMinimum('0.7.2-rc.1', '0.7.2')).toBe(false)
  })

  it('fails closed on an unparsable version', () => {
    expect(meetsMinimum('unknown', '0.7.2')).toBe(false)
    expect(meetsMinimum('0.7.2', 'unknown')).toBe(false)
  })
})

describe('stripAnsi', () => {
  it('removes SGR sequences', () => {
    expect(stripAnsi('\u001b[36mhttp://127.0.0.1:4321\u001b[0m')).toBe('http://127.0.0.1:4321')
  })
})

describe('parseOpenwikiVersion', () => {
  it('reads the version out of the CLI banner', () => {
    const banner = [
      '  ___                  __        ___ _    _',
      '│ >_ OpenWiki v0.7.2 agent docs for codebases │',
    ].join('\n')
    expect(parseOpenwikiVersion(banner)).toBe('0.7.2')
  })

  it('reads a prerelease banner', () => {
    expect(parseOpenwikiVersion('OpenWiki v0.8.0-rc.3 agent docs')).toBe('0.8.0-rc.3')
  })

  it('is undefined when there is no banner', () => {
    expect(parseOpenwikiVersion('command not found')).toBeUndefined()
  })
})

describe('parseVisualizePort', () => {
  it('reads the bound port from the banner URL', () => {
    expect(parseVisualizePort('\n  open:  \u001b[36mhttp://127.0.0.1:4321\u001b[0m\n')).toBe(4321)
  })

  it('reads the port the CLI incremented to', () => {
    expect(parseVisualizePort('  open:  http://127.0.0.1:4325')).toBe(4325)
  })

  it('is undefined while no URL has been printed', () => {
    expect(parseVisualizePort('  wiki:  /repo/openwiki\n')).toBeUndefined()
  })

  it('refuses a port outside the CLI range', () => {
    expect(parseVisualizePort('http://127.0.0.1:99999')).toBeUndefined()
  })
})

describe('isPortInRange', () => {
  it('accepts the CLI range', () => {
    expect(isPortInRange(MINIMUM_PORT)).toBe(true)
    expect(isPortInRange(4321)).toBe(true)
    expect(isPortInRange(MAXIMUM_PORT)).toBe(true)
  })

  it('refuses outside it and non-integers', () => {
    expect(isPortInRange(MINIMUM_PORT - 1)).toBe(false)
    expect(isPortInRange(MAXIMUM_PORT + 1)).toBe(false)
    expect(isPortInRange(4321.5)).toBe(false)
  })
})

describe('portCandidates', () => {
  it('starts at the preference and increments', () => {
    expect(portCandidates(4321, 4)).toEqual([4321, 4322, 4323, 4324])
  })

  it('stops at the top of the range', () => {
    expect(portCandidates(MAXIMUM_PORT, 3)).toEqual([MAXIMUM_PORT])
  })

  it('is empty for a non-positive attempt count', () => {
    expect(portCandidates(4321, 0)).toEqual([])
    expect(portCandidates(4321, -1)).toEqual([])
  })
})

describe('visualizeArgs', () => {
  it('always suppresses the CLI\u2019s own browser launch', () => {
    expect(visualizeArgs('/repo/openwiki', 4321))
      .toEqual(['visualize', '/repo/openwiki', '--port', '4321', '--no-open'])
  })
})

describe('classifyWikiDir', () => {
  it('rejects an empty directory', () => {
    expect(classifyWikiDir([])).toEqual({ hasWiki: false })
  })

  it('rejects scaffolding alone, which an interrupted init leaves behind', () => {
    expect(classifyWikiDir(['INSTRUCTIONS.md', 'log.md'])).toEqual({ hasWiki: false })
  })

  it('accepts a section index', () => {
    expect(classifyWikiDir(['index.md'])).toEqual({ hasWiki: true, marker: 'index' })
  })

  it('prefers the generation manifest when present', () => {
    expect(classifyWikiDir(['.page-manifest.json', 'index.md', 'guide.md']))
      .toEqual({ hasWiki: true, marker: 'manifest' })
  })

  it('accepts plain markdown as the weakest evidence', () => {
    expect(classifyWikiDir(['guide.md', 'assets'])).toEqual({ hasWiki: true, marker: 'markdown' })
  })
})

describe('quoteForWindowsCommandLine', () => {
  it('leaves an ordinary flag or path alone', () => {
    expect(quoteForWindowsCommandLine('--no-open')).toBe('--no-open')
    expect(quoteForWindowsCommandLine('/repo/openwiki')).toBe('/repo/openwiki')
    expect(quoteForWindowsCommandLine('4321')).toBe('4321')
  })

  it('quotes a path containing a space, which would otherwise split in two', () => {
    expect(quoteForWindowsCommandLine('C:\\My Projects\\openwiki'))
      .toBe('"C:\\My Projects\\openwiki"')
  })

  it('quotes the shell metacharacters the command processor would act on', () => {
    expect(quoteForWindowsCommandLine('a&b')).toBe('"a&b"')
    expect(quoteForWindowsCommandLine('a|b')).toBe('"a|b"')
    expect(quoteForWindowsCommandLine('a>b')).toBe('"a>b"')
    expect(quoteForWindowsCommandLine('a^b')).toBe('"a^b"')
  })

  it('quotes the characters cmd expands even inside quotes', () => {
    expect(quoteForWindowsCommandLine('%USERPROFILE%')).toBe('"%USERPROFILE%"')
    expect(quoteForWindowsCommandLine('a!b')).toBe('"a!b"')
  })

  it('doubles an embedded quote rather than ending the quoted run', () => {
    expect(quoteForWindowsCommandLine('say "hi"')).toBe('"say ""hi"""')
  })

  it('quotes an empty argument instead of dropping it', () => {
    expect(quoteForWindowsCommandLine('')).toBe('""')
  })
})
