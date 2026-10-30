import { clientBundle } from '../../../scripts/tsdown.client.ts'

/**
 * Build for the memo settings package.
 *
 * The shared preset owns the browser half's interop contract — the
 * `window.__ModuleLoader__.load` wrapper, its registration id (the package
 * name), the module-table externals and the sourcemap — so this file only names
 * what this package emits: `lib/index.js` for the node half, plus `lib/client.js`
 * and `lib/client.d.ts` for the browser face.
 *
 * `@deepseek-ai/dsh-client-ui-settings` is a type-only import (the slot
 * contract and the `configForms` face), so it stays out of the bundle without a
 * `dsh.client.external` row: the purity plugin only sees value imports.
 */
export default clientBundle(
  '@zhangj1164/dsh-client-ui-memo-settings',
  ['src/index.ts'],
)
