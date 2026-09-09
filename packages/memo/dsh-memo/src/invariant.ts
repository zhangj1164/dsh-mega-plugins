/** Package-owned invariant companion. @module dsh-memo/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = 'dsh-memo'

/** Cordis companion plugin name. */
export const name = 'memo-invariant'
/** Services required before the companion can reserve and check package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the private typed writer owns all week mutations, the
 * domain schema validates weeks on reopen, and no second authority exists.
 */
const install: InvariantInstaller = Object.assign(() => {}, { inject: ['memo'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
