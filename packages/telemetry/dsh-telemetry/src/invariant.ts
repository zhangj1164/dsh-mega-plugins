/** Package-owned invariant companion. @module dsh-telemetry/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = 'dsh-telemetry'

/** Cordis companion plugin name. */
export const name = 'telemetry-invariant'
/** Services required before the companion can reserve and check package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the private typed writer owns all event mutations, the
 * domain schema validates rows on reopen, and no second authority exists.
 */
const install: InvariantInstaller = Object.assign(() => {}, { inject: ['telemetry'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
