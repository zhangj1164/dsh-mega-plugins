import { defineConfig } from 'tsdown'

/**
 * Self-contained build: transpiles src/ into lib/ without project references
 * or type checking. This runs both as `pnpm run build` and as the git-install
 * `prepare` script, so it must not assume a sibling monorepo checkout.
 */
export default defineConfig({
  entry: ['src/index.ts', 'src/invariant.ts', 'src/types.ts', 'src/client.ts', 'src/spec.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: true,
  clean: true,
  fixedExtension: false,
})
