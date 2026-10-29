/**
 * Memo settings page, browser half.
 *
 * The page is one `settings.section` entry: the Settings shell renders it in
 * the panel content column and supplies the navigation row from the
 * registration's own `id`/`order`/`label`, so adding this page never edits the
 * settings shell.
 *
 * Two facts decide the shape below. The page is registered only while the Host
 * serves the `memo` namespace (`configForms.whileServed`), so a deployment
 * without memo shows no trace of it — the alternative, registering eagerly,
 * would render a permanently empty page. And the model carries no memo value of
 * its own: it stages a draft over the Host form, which is what makes the write
 * a live config change instead of a restart.
 *
 * The entry id is spelled here rather than imported: a browser package must not
 * depend on a Host package, and the id is the memo bundle's published Loader
 * row (`memo`), not a private module path.
 *
 * @module @zhangj1164/dsh-client-ui-memo-settings/client
 */

import type * as React from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { MemoSettingsDraft, type MemoSettingsValues } from './form.ts'
import { MemoSettingsSection, type MemoSettingsSectionProps } from './MemoSettingsSection.tsx'
import { en, zh, type MemoKey } from './locales.ts'
import { CSS_TEXT } from './styles.ts'

/**
 * The slot service face this page uses, spelled structurally.
 *
 * `@deepseek-ai/dsh-client-ui-slots` is a shell-seeded platform module the
 * workspace does not install, so the `ctx.slots` augmentation is absent here
 * for the same reason it is absent in every other browser package of this
 * repository. Naming only the two members this page calls keeps the surface
 * honest without shadowing the shell's own declarations.
 */
interface SlotsFace {
  /**
   * Run `callback` once the slot key is declared.
   * @param key - the slot key to wait for.
   * @param callback - the registration to perform.
   * @returns the disposer ending the injection.
   */
  inject(key: string, callback: () => () => void): () => void
  /**
   * Add one contribution.
   * @param options - the section's nav identity and injection face.
   * @param component - the section component.
   * @returns the disposer removing the contribution.
   */
  register(
    options: {
      /** Slot key. */
      readonly name: 'settings.section'
      /** Section key; drives navigation identity and `only` filtering. */
      readonly id: string
      /** Navigation position. */
      readonly order: number
      /** Registrant-localized navigation label. */
      readonly label: () => string
      /** Dictionary namespace the shell reads the section's copy from. */
      readonly locale: string
      /** Builds the props the section receives besides its owner props. */
      readonly inject: () => unknown
    },
    component: (props: MemoSettingsSectionProps) => React.ReactElement,
  ): () => void
}

/** Dictionary namespace owned by this plugin. */
const NS = 'memo.settings'

/** Settings-navigation id of this page. */
export const MEMO_SETTINGS_SECTION_ID = 'memo'

/** Navigation position: after the shipped sections (`plugins` is 15). */
export const MEMO_SETTINGS_SECTION_ORDER = 20

/**
 * The Loader entry id whose configuration this page edits.
 *
 * This is the `memo` Host row's `options.id`, which `@deepseek-ai/dsh-settings`
 * uses as the form namespace.
 */
export const MEMO_SETTINGS_NAMESPACE = 'memo'

/** Required services: slot registration, locale, and the settings form service. */
export const inject = ['slots', 'locale', 'configForms']

/**
 * Register the memo settings page.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // Styles use DSH alias tokens, so they follow the active theme automatically.
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.dshPlugin = NS
    style.textContent = CSS_TEXT
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'ui-memo-settings: styles')

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-memo-settings: dictionaries')

  const t = (key: MemoKey): string => ctx.locale.bind(NS)(key)
  // The shell's slots service, reached the same way every browser package here
  // reaches it. The cast is only for the missing module augmentation described
  // on `SlotsFace`; `inject` guarantees the service exists.
  const slots = (ctx as unknown as { slots?: SlotsFace }).slots
  if (slots === undefined) {
    console.error('[ui-memo-settings] slots service not available')
    return
  }
  const form = ctx.configForms.get<MemoSettingsValues>(MEMO_SETTINGS_NAMESPACE)
  const draft = new MemoSettingsDraft(form)
  ctx.effect(() => () => { draft.dispose() }, 'ui-memo-settings: draft')

  /**
   * The injected face. `hooks` entries become `use<Name>` props on the page, so
   * the draft's own store drives its re-renders; the actions stay plain
   * functions so a click never has to go through the store.
   */
  const face = () => ({
    hooks: { memoSettings: draft },
    edit: (field: Parameters<MemoSettingsDraft['edit']>[0], text: string) => { draft.edit(field, text) },
    resetField: (field: Parameters<MemoSettingsDraft['resetField']>[0]) => { draft.resetField(field) },
    save: () => { void draft.save() },
    discard: () => { draft.discard() },
  })

  ctx.effect(() => ctx.configForms.whileServed([MEMO_SETTINGS_NAMESPACE], () => slots.inject(
    'settings.section',
    () => slots.register({
      name: 'settings.section',
      id: MEMO_SETTINGS_SECTION_ID,
      order: MEMO_SETTINGS_SECTION_ORDER,
      label: () => t('nav'),
      locale: NS,
      inject: face,
    }, MemoSettingsSection),
  )), 'ui-memo-settings: page')
}
