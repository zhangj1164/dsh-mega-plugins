/**
 * Memo settings plugin, node half. Pure UI plugin: the empty apply exists so the
 * plugin appears in the host cordis.yml / Loader; the browser half ships via
 * exports["./client"], discovered through the package.json `dsh.client`
 * declaration.
 *
 * @module @zhangj1164/dsh-client-ui-memo-settings
 */

/** Host plugin body — this surface plugin has no host-side behavior. */
export function apply(): void {}
