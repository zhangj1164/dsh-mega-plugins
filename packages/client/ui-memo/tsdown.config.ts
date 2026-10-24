import { clientBundle } from '../../../scripts/tsdown.client.ts'

/**
 * Build for the memo client UI package.
 *
 * The shared preset owns the browser half's interop contract — the
 * `window.__ModuleLoader__.load` wrapper, its registration id (the package
 * name), the module-table externals and the sourcemap — so this file only names
 * what this package emits: `lib/index.js` and `lib/invariant.js` for the node
 * half, plus `lib/client.js` and `lib/client.d.ts` for the browser face.
 */
export default clientBundle(
  '@zhangj1164/dsh-client-ui-memo',
  ['src/index.ts', 'src/invariant.ts'],
)
