import { createRequire } from 'node:module'
import { defineConfig } from 'vitest/config'
import { standardDecorators } from './scripts/vitest-decorators.ts'

// Client UI tests render with jsdom, and the shell bundles React 18. The tests
// must therefore resolve the same React and ReactDOM the components use at
// runtime: a workspace-hoisted ReactDOM 19 alongside React 18 throws
// "Incompatible React versions" before a single assertion runs. Pin the test
// loader to the memo client's own ReactDOM so a hoist cannot break the suite.
const memoRequire = createRequire(new URL('./packages/client/ui-memo/package.json', import.meta.url))

/**
 * Workspace packages are aliased to their TypeScript sources.
 *
 * Their published `./client` faces are type-only projections (`export type *`),
 * so resolving them at runtime yields an empty module — a client test would
 * import nothing and fail with an unrelated error. Tests run against source,
 * which is also what keeps a broken build from silently changing test meaning.
 */
const workspaceSources: Record<string, string> = {
  'dsh-memo/client': './packages/memo/dsh-memo/src/client.ts',
  'dsh-memo/types': './packages/memo/dsh-memo/src/types.ts',
  'dsh-memo': './packages/memo/dsh-memo/src/index.ts',
  'dsh-github-issue/client': './packages/github-issue/dsh-github-issue/src/client.ts',
  'dsh-github-issue/types': './packages/github-issue/dsh-github-issue/src/types.ts',
  'dsh-github-issue': './packages/github-issue/dsh-github-issue/src/index.ts',
  'dsh-telemetry/types': './packages/telemetry/dsh-telemetry/src/types.ts',
  'dsh-telemetry': './packages/telemetry/dsh-telemetry/src/index.ts',
}

export default defineConfig({
  plugins: [standardDecorators()],
  // Exact patterns: a plain `dsh-memo` entry would also swallow
  // `dsh-memo/client` and `dsh-memo/types`, because Vite's object form matches
  // a package prefix before trying the more specific key.
  resolve: {
    alias: [
      ...Object.entries(workspaceSources).map(([specifier, path]) => ({
        find: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'u'),
        replacement: new URL(path, import.meta.url).pathname,
      })),
      { find: /^react-dom\/client$/u, replacement: memoRequire.resolve('react-dom/client') },
      { find: /^react-dom$/u, replacement: memoRequire.resolve('react-dom') },
      // `react` and `react/jsx-runtime` must be the same copy as each other and
      // as the one ReactDOM renders with, or hooks throw "Invalid hook call"
      // for what looks like an unrelated reason.
      { find: /^react\/jsx-runtime$/u, replacement: memoRequire.resolve('react/jsx-runtime') },
      { find: /^react\/jsx-dev-runtime$/u, replacement: memoRequire.resolve('react/jsx-dev-runtime') },
      { find: /^react$/u, replacement: memoRequire.resolve('react') },
    ],
  },
  test: {
    include: ['packages/*/*/tests/**/*.spec.{ts,tsx}'],
  },
})
