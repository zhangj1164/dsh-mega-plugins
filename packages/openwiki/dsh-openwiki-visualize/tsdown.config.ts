import ts from 'typescript'
import { clientBundle } from '../../../scripts/tsdown.client.ts'

/*
 * `@Remote` is a standard TypeScript decorator, and rolldown does not lower
 * decorator syntax — without this transform the emitted `.js` keeps raw `@`
 * syntax that Node.js cannot parse. Mirrors the transform hook in the DSH
 * framework's `typertPlugin`, and matches `dsh-memo`'s node-half build.
 */
/* jscpd:ignore-start */
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
/* jscpd:ignore-end */

/**
 * Build for the OpenWiki preview plugin: the host half (`lib/index.js`, the
 * Remote service), the pure environment logic (`lib/environment.js`), the
 * invariant companion, and the browser half (`lib/client.js`) the shared preset
 * wraps for the shell's module loader. The decorator lowering is a node-half
 * concern, so it is supplied through the preset's `lib` override.
 */
export default clientBundle(
  '@zhangj1164/dsh-openwiki-visualize',
  ['src/index.ts', 'src/environment.ts', 'src/invariant.ts'],
  { lib: { plugins: [lowerDecorators()] } },
)
