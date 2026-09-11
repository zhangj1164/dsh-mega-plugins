import { defineConfig } from 'tsdown'
import ts from 'typescript'

/**
 * The `lowerDecorators` plugin uses `ts.transpileModule` to lower standard
 * TypeScript decorators (e.g. `@Remote`) before rolldown bundles them —
 * without this the emitted `.js` retains raw `@` syntax that Node.js cannot
 * parse. Mirrors the transform hook in the DSH framework's `typertPlugin`.
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

export default defineConfig({
  entry: ['src/index.ts', 'src/invariant.ts', 'src/types.ts', 'src/client.ts', 'src/spec.ts', 'src/llm-text.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: true,
  clean: true,
  fixedExtension: false,
  plugins: [lowerDecorators()],
})
