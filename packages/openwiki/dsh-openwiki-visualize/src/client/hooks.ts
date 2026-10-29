/**
 * React binding for the preview controller.
 * @module @zhangj1164/dsh-openwiki-visualize/client/hooks
 */

import * as React from 'react'
import type { OpenWikiClient, OpenWikiViewState } from './controller.ts'

/**
 * Subscribe a component to the controller's published state.
 * @param client - the shared controller.
 * @returns the current state, re-rendering the component on every publish.
 */
export function useOpenWikiState(client: OpenWikiClient): OpenWikiViewState {
  const [state, setState] = React.useState<OpenWikiViewState>(() => client.getSnapshot())
  React.useEffect(
    () => client.subscribe(() => { setState(client.getSnapshot()) }),
    [client],
  )
  return state
}
