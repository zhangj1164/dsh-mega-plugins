/**
 * Root vitest configuration for the dsh-mega-plugins monorepo.
 *
 * Follows the official DSH pattern: a single root-level vitest.config.ts
 * discovers all package tests via a glob include pattern. No per-package
 * vitest.config.ts is needed — the shared decorator-transform plugin is a
 * no-op for files without decorator syntax, so it applies safely to every
 * package.
 *
 * Run from the repo root:
 *   vitest run                    run all tests
 *   vitest run --watch            watch mode
 *   vitest run packages/memo      run tests in one package
 *
 * @module vitest.config
 */

import { defineConfig } from 'vitest/config'
import { standardDecorators } from './scripts/vitest-decorators.ts'

export default defineConfig({
  plugins: [standardDecorators()],
  test: {
    include: ['packages/*/*/tests/**/*.spec.{ts,tsx}'],
  },
})
