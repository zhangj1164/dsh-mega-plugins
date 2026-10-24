import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import OpenWikiVisualizeService from '../src/index.ts'

/**
 * The subprocess stand-in.
 *
 * `vi.mock` is hoisted above the imports, so the shared state it closes over has
 * to be built with `vi.hoisted`: a plain module constant would still be in its
 * temporal dead zone when the factory runs.
 *
 * The fake child keeps the handler maps next to the recorded call, which is what
 * lets a test drive stdout, an exit, or a spawn error by index — the service
 * attaches its listeners synchronously after `spawn` returns, so a response
 * scheduled on a later tick always finds them.
 */
const harness = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void

  /** One recorded spawn with the handler maps needed to drive it. */
  interface Recorded {
    readonly command: string
    readonly args: readonly string[]
    readonly child: Record<string, unknown>
    readonly out: Map<string, Handler[]>
    readonly err: Map<string, Handler[]>
    readonly events: Map<string, Handler[]>
  }

  const calls: Recorded[] = []
  let responder: ((command: string, args: readonly string[], child: Record<string, unknown>) => void) | undefined

  /** Fire every handler registered for one event. */
  function fire(target: Map<string, Handler[]>, event: string, ...args: unknown[]): void {
    for (const handler of [...(target.get(event) ?? [])]) handler(...args)
  }

  /** A writable stdio stream. */
  function stream(target: Map<string, Handler[]>): unknown {
    return {
      on(event: string, handler: Handler) { target.set(event, [...(target.get(event) ?? []), handler]) },
      off(event: string, handler: Handler) { target.set(event, (target.get(event) ?? []).filter(item => item !== handler)) },
    }
  }

  return {
    calls,
    /** Install the answer one spawn gets. */
    respond(fn: (command: string, args: readonly string[], child: Record<string, unknown>) => void): void {
      responder = fn
    },
    /**
     * The `node:child_process.spawn` replacement.
     *
     * The plugin spawns two ways: directly as `(command, args, options)`, and on
     * Windows through the command processor as `(line, options)` because Node
     * cannot run a `.cmd` shim itself. Both shapes are accepted here, and the
     * shell form is split back into argv so an assertion can still talk about
     * the arguments rather than about the line.
     */
    spawn(command: string, argsOrOptions?: unknown, maybeOptions?: unknown): unknown {
      const tokens = command.split(' ')
      const direct = Array.isArray(argsOrOptions)
      const base = direct ? command : (tokens[0] ?? command)
      const argv = direct ? (argsOrOptions as string[]) : tokens.slice(1)
      const out = new Map<string, Handler[]>()
      const err = new Map<string, Handler[]>()
      const events = new Map<string, Handler[]>()
      const child: Record<string, unknown> = {
        pid: 4242,
        exitCode: null,
        killed: false,
        stdout: stream(out),
        stderr: stream(err),
        on(event: string, handler: Handler) { events.set(event, [...(events.get(event) ?? []), handler]) },
        once(event: string, handler: Handler) { events.set(event, [...(events.get(event) ?? []), handler]) },
        off(event: string, handler: Handler) { events.set(event, (events.get(event) ?? []).filter(item => item !== handler)) },
        kill() {
          child['killed'] = true
          child['exitCode'] = 0
          fire(events, 'exit', 0)
        },
      }
      void maybeOptions
      calls.push({ command: base, args: argv, child, out, err, events })
      setTimeout(() => { responder?.(base, argv, child) }, 0)
      return child
    },
    /** The index of the most recent spawn. */
    last(): number {
      return calls.length - 1
    },
    /** Emit stdout for one recorded spawn. */
    emitStdout(index: number, text: string): void {
      const call = calls[index]
      if (call === undefined) throw new Error(`no spawn at index ${index}`)
      fire(call.out, 'data', Buffer.from(text))
    },
    /** Exit one recorded spawn. */
    exit(index: number, code: number): void {
      const call = calls[index]
      if (call === undefined) throw new Error(`no spawn at index ${index}`)
      call.child['exitCode'] = code
      fire(call.events, 'exit', code)
    },
    /** Fail one recorded spawn as an unstartable executable. */
    fail(index: number, error: Error): void {
      const call = calls[index]
      if (call === undefined) throw new Error(`no spawn at index ${index}`)
      fire(call.events, 'error', error)
    },
    /** Forget every recorded spawn and the installed answer. */
    reset(): void {
      calls.length = 0
      responder = undefined
    },
  }
})

vi.mock('node:child_process', () => ({ spawn: harness.spawn }))

/** The openwiki startup banner, exactly as the CLI prints it. */
const OPENWIKI_BANNER = [
  '  ___                  __        ___ _    _',
  '│ >_ OpenWiki v0.7.2 agent docs for codebases │',
].join('\n')

/** The visualizer's startup banner, with the colour codes it really emits. */
const VISUALIZE_BANNER = '\n  OpenWiki visualizer\n  wiki:  {wiki}\n  open:  \u001b[36mhttp://127.0.0.1:4321\u001b[0m\n'

const roots: string[] = []

/** Create a workspace holding an openwiki directory. */
async function makeWorkspace(files: readonly string[] = ['index.md', 'guide.md']): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-openwiki-test-'))
  roots.push(root)
  if (files.length === 0) return root
  const wiki = join(root, 'openwiki')
  await mkdir(wiki, { recursive: true })
  for (const name of files) await writeFile(join(wiki, name), `# ${name}\n`, 'utf8')
  return root
}

/** Mount the service on a real Cordis context. */
async function mount(config: Record<string, unknown> = {}): Promise<{
  ctx: Context
  service: OpenWikiVisualizeService
}> {
  const ctx = new Context()
  await ctx.plugin(OpenWikiVisualizeService, { updateCheckOnStart: false, ...config })
  return { ctx, service: ctx.get('openwikiVisualize') as OpenWikiVisualizeService }
}

/** Answer both the graph probe and the registry from one stubbed fetch. */
function stubNet(options: { graphOk?: boolean; latest?: string } = {}): void {
  vi.stubGlobal('fetch', async (input: string) => {
    if (input.includes('/api/graph')) {
      const ok = options.graphOk ?? true
      return { ok, status: ok ? 200 : 503 } as Response
    }
    return {
      ok: true,
      status: 200,
      async json() { return { 'dist-tags': { latest: options.latest ?? '0.1.0' } } },
    } as unknown as Response
  })
}

/** Answer a version probe: openwiki from its banner, DSH from `--version`. */
function respondWithVersions(openwikiVersion = '0.7.2'): void {
  harness.respond((command) => {
    const index = harness.last()
    if (command === 'openwiki') {
      harness.emitStdout(index, OPENWIKI_BANNER.replace('0.7.2', openwikiVersion))
      harness.exit(index, 0)
      return
    }
    harness.emitStdout(index, '0.2.1-rc.2\n')
    harness.exit(index, 0)
  })
}

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  harness.reset()
  while (roots.length > 0) {
    const root = roots.pop()
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  }
})

describe('OpenWikiVisualizeService environment', () => {
  it('reports the openwiki and DSH versions when both satisfy their floors', async () => {
    respondWithVersions()
    const { ctx, service } = await mount()
    const result = await service.environment()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.ok).toBe(true)
    expect(result.value.openwiki.found).toBe(true)
    expect(result.value.openwiki.version).toBe('0.7.2')
    expect(result.value.openwiki.meetsMinimum).toBe(true)
    expect(result.value.dsh.meetsMinimum).toBe(true)
    await ctx.fiber.dispose()
  })

  it('fails the gate when openwiki is older than the configured floor', async () => {
    respondWithVersions('0.6.0')
    const { ctx, service } = await mount()
    const result = await service.environment()
    if (!result.ok) return
    expect(result.value.openwiki.meetsMinimum).toBe(false)
    expect(result.value.openwiki.minimumVersion).toBe('0.7.2')
    expect(result.value.ok).toBe(false)
    await ctx.fiber.dispose()
  })

  it('honours a raised floor from configuration', async () => {
    respondWithVersions('0.7.2')
    const { ctx, service } = await mount({ minOpenwikiVersion: '0.8.0' })
    const result = await service.environment()
    if (!result.ok) return
    expect(result.value.openwiki.meetsMinimum).toBe(false)
    await ctx.fiber.dispose()
  })

  it('reports a missing openwiki as a finding, not a thrown error', async () => {
    harness.respond(() => {
      harness.fail(harness.last(), Object.assign(new Error('spawn openwiki ENOENT'), { code: 'ENOENT' }))
    })
    const { ctx, service } = await mount()
    const result = await service.environment()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.openwiki.found).toBe(false)
    expect(result.value.openwiki.failure?.code).toBe('openwiki-not-installed')
    expect(result.value.ok).toBe(false)
    await ctx.fiber.dispose()
  })
})

describe('OpenWikiVisualizeService workspace', () => {
  it('finds a wiki and counts content pages, not scaffolding', async () => {
    const root = await makeWorkspace(['index.md', 'guide.md', 'INSTRUCTIONS.md', 'log.md'])
    const { ctx, service } = await mount()
    const result = await service.workspace({ path: root })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.hasWiki).toBe(true)
    expect(result.value.marker).toBe('index')
    expect(result.value.pageCount).toBe(2)
    await ctx.fiber.dispose()
  })

  it('counts pages in nested sections, as the reader does', async () => {
    const root = await makeWorkspace(['index.md'])
    await mkdir(join(root, 'openwiki', 'api'), { recursive: true })
    await writeFile(join(root, 'openwiki', 'api', 'routes.md'), '# routes\n', 'utf8')
    const { ctx, service } = await mount()
    const result = await service.workspace({ path: root })
    if (result.ok) expect(result.value.pageCount).toBe(2)
    await ctx.fiber.dispose()
  })

  it('reports no wiki for a workspace without one', async () => {
    const root = await makeWorkspace([])
    const { ctx, service } = await mount()
    const result = await service.workspace({ path: root })
    if (result.ok) expect(result.value.hasWiki).toBe(false)
    await ctx.fiber.dispose()
  })

  it('refuses a scaffolding-only directory left by an interrupted init', async () => {
    const root = await makeWorkspace(['INSTRUCTIONS.md'])
    const { ctx, service } = await mount()
    const result = await service.workspace({ path: root })
    if (result.ok) expect(result.value.hasWiki).toBe(false)
    await ctx.fiber.dispose()
  })
})

describe('OpenWikiVisualizeService start and stop', () => {
  it('serves the wiki on the port the CLI announces', async () => {
    const root = await makeWorkspace()
    stubNet()
    harness.respond((_command, _args, _child) => {
      harness.emitStdout(harness.last(), VISUALIZE_BANNER.replace('{wiki}', root))
    })
    const { ctx, service } = await mount()

    const result = await service.start({ path: root })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.running).toBe(true)
      expect(result.value.port).toBe(4321)
      expect(result.value.url).toBe('http://127.0.0.1:4321')
    }
    // `--no-open` is required: the pane embeds the reader, and letting the CLI
    // also launch a system browser would open an unasked-for second window.
    expect(harness.calls[0]?.args).toContain('--no-open')
    await ctx.fiber.dispose()
  })

  it('reports where the server actually bound, not what it was asked for', async () => {
    const root = await makeWorkspace()
    stubNet()
    harness.respond(() => {
      harness.emitStdout(harness.last(), VISUALIZE_BANNER.replace('4321', '4325'))
    })
    const { ctx, service } = await mount({ defaultPort: 4321 })
    const result = await service.start({ path: root })
    if (result.ok) {
      expect(result.value.port).toBe(4325)
      expect(result.value.url).toBe('http://127.0.0.1:4325')
    }
    await ctx.fiber.dispose()
  })

  it('refuses to start when the workspace has no wiki', async () => {
    const root = await makeWorkspace([])
    const { ctx, service } = await mount()
    const result = await service.start({ path: root })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('wiki-missing')
    await ctx.fiber.dispose()
  })

  it('reports a stopped server once the child is reaped', async () => {
    const root = await makeWorkspace()
    stubNet()
    harness.respond(() => {
      harness.emitStdout(harness.last(), VISUALIZE_BANNER.replace('{wiki}', root))
    })
    const { ctx, service } = await mount()
    await service.start({ path: root })
    const stopped = await service.stop()
    expect(stopped.ok).toBe(true)
    if (stopped.ok) expect(stopped.value.running).toBe(false)
    await ctx.fiber.dispose()
  })

  it('is idempotent for the wiki already being served', async () => {
    const root = await makeWorkspace()
    stubNet()
    harness.respond(() => {
      harness.emitStdout(harness.last(), VISUALIZE_BANNER.replace('{wiki}', root))
    })
    const { ctx, service } = await mount()
    await service.start({ path: root })
    await service.start({ path: root })
    expect(harness.calls).toHaveLength(1)
    await ctx.fiber.dispose()
  })
})

describe('OpenWikiVisualizeService version and update', () => {
  it('reports the installed version and an available update', async () => {
    stubNet({ latest: '99.0.0' })
    const { ctx, service } = await mount()
    const result = await service.checkUpdate()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.current).toMatch(/^\d+\.\d+\.\d+/u)
    expect(result.value.latest).toBe('99.0.0')
    expect(result.value.updateAvailable).toBe(true)
    await ctx.fiber.dispose()
  })

  it('does not call an equal version an update', async () => {
    // The plugin's own manifest version is what the registry reports here, so
    // nothing is due and the pane must not offer an update.
    stubNet({ latest: '0.2.0' })
    const { ctx, service } = await mount()
    const result = await service.checkUpdate()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.current).toBe('0.2.0')
      expect(result.value.updateAvailable).toBe(false)
    }
    await ctx.fiber.dispose()
  })

  it('keeps an unreachable registry as data rather than throwing', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    const { ctx, service } = await mount()
    const result = await service.checkUpdate()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.failure?.code).toBe('registry-unreachable')
    expect(result.value.updateAvailable).toBe(false)
    await ctx.fiber.dispose()
  })

  it('answers a cached version request without a second registry call', async () => {
    let requests = 0
    vi.stubGlobal('fetch', async () => {
      requests += 1
      return { ok: true, status: 200, async json() { return { 'dist-tags': { latest: '1.2.3' } } } } as unknown as Response
    })
    const { ctx, service } = await mount()
    await service.checkUpdate()
    const cached = await service.version({ cached: true })
    expect(requests).toBe(1)
    if (cached.ok) expect(cached.value.latest).toBe('1.2.3')
    await ctx.fiber.dispose()
  })

  it('checks the registry once when the plugin starts, if configured to', async () => {
    let requests = 0
    vi.stubGlobal('fetch', async () => {
      requests += 1
      return { ok: true, status: 200, async json() { return { 'dist-tags': { latest: '1.0.0' } } } } as unknown as Response
    })
    const { ctx } = await mount({ updateCheckOnStart: true })
    // The check is fire-and-forget so it cannot delay the plugin's mount.
    await vi.waitFor(() => { expect(requests).toBe(1) })
    await ctx.fiber.dispose()
  })

  it('runs the profile install command and asks for a reload', async () => {
    harness.respond(() => {
      const index = harness.last()
      harness.emitStdout(index, 'added\n')
      harness.exit(index, 0)
    })
    const { ctx, service } = await mount({ packageName: '@scope/pkg', profileName: 'web' })
    const result = await service.update()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.updated).toBe(true)
      expect(result.value.reloadRequired).toBe(true)
      expect(result.value.command).toContain('@scope/pkg@latest')
    }
    expect(harness.calls[0]?.args).toEqual(['plugin', '--profile', 'web', 'add', '@scope/pkg@latest'])
    await ctx.fiber.dispose()
  })

  it('reports a failed install without claiming success', async () => {
    harness.respond(() => {
      const index = harness.last()
      harness.emitStdout(index, 'ERR_PNPM\n')
      harness.exit(index, 1)
    })
    const { ctx, service } = await mount()
    const result = await service.update()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.updated).toBe(false)
      expect(result.value.reloadRequired).toBe(false)
    }
    await ctx.fiber.dispose()
  })
})
