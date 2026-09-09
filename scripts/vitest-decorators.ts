/**
 * Shared Vite plugin: transform standard TypeScript decorators before Vite's
 * default parser. Required by packages that use `@Remote` decorators on
 * `TypertRemoteService` subclasses (github-issue, memo).
 *
 * The transform is a no-op for files without decorator syntax, so it is safe
 * to include in any package's vitest config — only files that actually contain
 * `@Identifier` syntax are transpiled.
 *
 * @module scripts/vitest-decorators
 */

import { type PluginOption } from 'vite'
import ts from 'typescript'

const decoratorSyntax = /^\s*@[A-Za-z_$][\w$]*/m

/**
 * Vite pre-transform plugin that strips standard TypeScript decorators via
 * `ts.transpileModule` before Vite's parser sees them. Files without decorator
 * syntax pass through unchanged.
 * @returns the Vite plugin.
 */
export function standardDecorators(): PluginOption {
  return {
    name: 'dsh-standard-decorators',
    enforce: 'pre',
    transform(code: string, id: string) {
      const file = id.split('?', 1)[0]!
      if (!/\.[cm]?tsx?$/.test(file) || !decoratorSyntax.test(code)) return
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
