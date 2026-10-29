/**
 * Package-owned invariant companion for `@zhangj1164/dsh-openwiki-visualize`.
 * @module @zhangj1164/dsh-openwiki-visualize/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@zhangj1164/dsh-openwiki-visualize'

/** Cordis companion plugin name. */
export const name = 'openwiki-visualize-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the host service owns one visualizer child and the
 * browser half owns one tab type and two slot registrations, all of which the
 * plugin's own effect disposers release.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
