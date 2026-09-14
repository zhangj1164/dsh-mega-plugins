import { defineConfig } from 'tsdown'
import ts from 'typescript'

/**
 * Self-contained build for the memo client UI package.
 *
 * Produces three outputs:
 * 1. Node half: `lib/index.js` and `lib/invariant.js` (ESM + .d.ts)
 * 2. Client half: `lib/client.js` (CJS wrapped in window.__ModuleLoader__.load)
 * 3. Client types: `lib/client.d.ts`, the `./client` face's declarations —
 *    rolldown emits no declaration chunk for a bundled CJS browser face, so
 *    this is a separate declarations-only pass.
 *
 * Mirrors the DSH framework's `clientBundle` output format so the browser
 * module loader can fetch and execute the client bundle.
 */

const DECORATOR_SYNTAX = /^\s*@[A-Za-z_$][\w$]*/m

function lowerDecorators() {
  return {
    name: 'lower-decorators',
    transform(code: string, id: string) {
      const file = id.split('?', 1)[0] ?? id
      if (!/\.[cm]?tsx?$/.test(file) || !DECORATOR_SYNTAX.test(code)) return
      const result = ts.transpileModule(code, {
        fileName: file,
        compilerOptions: {
          target: ts.ScriptTarget.ES2024,
          module: ts.ModuleKind.ESNext,
          ...(file.endsWith('x') ? { jsx: ts.JsxEmit.ReactJSX } : {}),
          sourceMap: true,
        },
      })
      return {
        code: result.outputText.replace(/\n?\/\/# sourceMappingURL=.*$/u, '\n'),
        map: result.sourceMapText,
      }
    },
  }
}

/** Browser module-table specifiers that stay external (provided by the shell). */
const CLIENT_EXTERNALS = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client',
])

const isClientExternal = (specifier: string): boolean => {
  for (const ext of CLIENT_EXTERNALS) {
    if (specifier === ext || specifier.startsWith(ext + '/')) return true
  }
  return false
}

export default defineConfig([
  // Node half: ESM + .d.ts
  {
    entry: ['src/index.ts', 'src/invariant.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    dts: true,
    clean: true,
    fixedExtension: false,
    plugins: [lowerDecorators()],
  },
  // Client half: CJS wrapped in window.__ModuleLoader__.load(...)
  {
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    target: 'es2024',
    dts: false,
    clean: false,
    fixedExtension: false,
    sourcemap: true,
    deps: {
      neverBundle: isClientExternal,
      alwaysBundle: (specifier: string) => !isClientExternal(specifier),
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: "dsh-client-ui-memo", factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
  // Client declarations: ESM `.d.ts` only. The browser half above is a CJS
  // bundle wrapped for the shell's module loader, for which rolldown emits no
  // declaration chunk; this pass produces the `./client` types face.
  {
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'browser',
    target: 'es2024',
    dts: { emitDtsOnly: true },
    clean: false,
    fixedExtension: false,
    sourcemap: false,
    minify: false,
    deps: {
      neverBundle: isClientExternal,
      alwaysBundle: (specifier: string) => !isClientExternal(specifier),
    },
  },
])
