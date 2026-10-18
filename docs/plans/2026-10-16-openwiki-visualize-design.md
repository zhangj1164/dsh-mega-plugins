# dsh-openwiki-visualize — design

Date: 2026-10-16

## Problem

A DSH Web workspace usually maps to one project. When that project has an initialized openwiki, the user wants to read it without leaving DSH Web. `openwiki visualize` already runs a perfect local reader, but it only opens a standalone browser tab; DSH Web cannot show it.

The goal is one installable DSH plugin, `@zhangj1164/dsh-openwiki-visualize`, that detects an openwiki in the selected workspace, starts the official visualizer, and renders it in the DSH Web right sidebar — with environment checks and self-update.

## Verified facts this design rests on

Everything below was confirmed against installed artifacts, not documentation.

**openwiki 0.7.2** is the highest published version (npm `dist-tags.latest` = `0.7.2`; the registry lists 30 versions ending at `0.7.2`). The user's requirement of a dependency "higher than 0.7.2" cannot resolve today, so the gate is a **minimum of 0.7.2**, configurable.

`openwiki visualize [path] [--port <port>] [--no-open] [--export <dir>]` serves the wiki. Default port 4321, incrementing up to 20 times on `EADDRINUSE`. Host is hard-coded to `127.0.0.1`; there is no `--host` flag. Live reload is **SSE** on `/events`. Routes are exact matches (`/`, `/index.html`, `/client.js`, `/client-lib.js`, `/styles.css`, `/api/graph`, `/events`), so **there is no base path and a query string 404s**. The wiki directory must exist or the command throws with `Run \`openwiki --init\` first`.

The served page carries CSP `default-src 'none'; script-src 'self' https://cdn.jsdelivr.net; …` with **no `frame-ancestors` and no `X-Frame-Options`**, so cross-origin iframing of `http://127.0.0.1:<port>/` is permitted. The page loads force-graph, marked, dompurify, mermaid and Google Fonts from CDNs, so the **browser needs internet** or it renders unstyled.

On disk, a wiki is a directory of `.md` files. `dist/visualize/graph.js` parses YAML frontmatter for `type`, `title`, `description`, `tags`; `index.md` is a section index; `INSTRUCTIONS.md` and `log.md` are excluded as scaffolding.

DSH ships the right-sidebar tab system as public client services: `ctx.sidebarRight` (`ISidebarRight.openTab`, `openResource`, `focus`, `isExpanded`, `mounted`) and `ctx.sidebarRightTabs` (`SidebarRightTabRegistry.register`). A tab type is registered in two stages — a static definition on `sidebarRightTabs`, then a keyed `sidebar.right.pane.tab` body whose key is the definition's `id` (not its `kind`). `SidebarRightTabParamsMap` is an augmentable interface, so a new kind can declare typed params.

`@deepseek-ai/dsh-client-ui-sidebar-browser` exists and declares kind `browser` with params `{ url?: string }`, but the web bundle disables it by policy: `disabled: !!js "ctx.get('profileContext')?.name !== 'desktop'"` under the comment "Web profiles opt in; Desktop retains sandboxed HTTP(S) Browser tabs." This design does not depend on it.

`dsh-openwiki` v2.0.5 is already installed and active in the `web` profile and does **not** use `visualize`; it ships its own markdown renderer. This plugin is preview-only and coexists with it.

## Decisions taken

| Decision | Choice | Why |
| --- | --- | --- |
| Preview surface | Our own tab type registered through `ctx.sidebarRightTabs`, body in `sidebar.right.pane.tab` | Documented public API, no third-party dependency, no override of DSH's web opt-in policy, works today |
| openwiki gate | Minimum `>= 0.7.2`, configurable | The stated `> 0.7.2` is unsatisfiable; `0.7.2` is latest |
| Scope | Preview only, coexist with `dsh-openwiki` | No duplicate generation UI or tools |
| Entry point | `conversation.session.header.utilities`, `order` below `-10` | `open-in-app` holds `order: -10` there, so a lower order renders immediately to its left |

Requirement 8 asked for a bundled `dsh-browser` dependency. The research in [browser-plugin-analysis.md](../browser-plugin-analysis.md) found no viable one: `dsh-better-sidebar` requires DSH `^0.2.0-rc.2` while this deployment runs `0.1.5-rc.1`, and `dsh-preview-plugin` is git-only, unpublished, and single-maintainer. The browser capability is met instead by the sandboxed iframe in our own pane plus the shipped right-sidebar infrastructure, which needs no third-party package. This is the one requirement reinterpreted, and it is flagged here deliberately.

## Architecture

One package, mirroring the `dsh-openwiki` reference shape rather than the two-package `memo`/`ui-memo` split, because there is exactly one bundle and one entry id to own:

```
packages/openwiki/dsh-openwiki-visualize/
  package.json          dsh.bundle -> cordis.patch.yml, dsh.client -> { platform: web, inject: [...] }
  cordis.patch.yml      inserts the host row and the browser row
  tsdown.config.ts      clientBundle('@zhangj1164/dsh-openwiki-visualize', [...])
  src/index.ts          host half: TypertRemoteService
  src/environment.ts    pure: version compare, wiki detection, port parse
  src/invariant.ts      cross-package invariant guard
  src/client/index.ts   browser half: tab type, pane, header button, settings
  tests/*.spec.ts
  README.md / README.zh.md / README.i18n.yaml
```

The package must sit at `packages/<group>/<name>/` because `scripts/tsdown.client.ts` locates it with the glob `packages/*/*/package.json`.

### Host half

A `TypertRemoteService` subclass exposing an `openwikiVisualize` Remote namespace, mirroring `dsh-memo`'s pattern so the browser reaches it through `ctx.remote.openwikiVisualize.*`.

| Remote method | Returns |
| --- | --- |
| `environment()` | openwiki presence, version, resolved path, minimum met; DSH version; Node version |
| `workspace(scope)` | whether the workspace has a wiki, its path, page count |
| `status()` | running, port, url, wiki path, pid, started at |
| `start(scope, opts?)` | binds a port, spawns the visualizer, resolves the real port |
| `stop()` | terminates the child and reports the outcome |
| `version()` | current plugin version, latest, update available, checked at |
| `checkUpdate()` | a live registry query, same shape |
| `update()` | the profile install command's outcome |

Process handling: spawn `openwiki visualize <wikiPath> --port <preferred> --no-open`, then read the bound port from the child's `open:` banner line, falling back to probing `/api/graph` across the candidate range when stdout is not a TTY. The child is registered in `ctx.effect` so plugin teardown and DSH shutdown both kill it; a crashed child is reported through `status()` rather than thrown at the caller.

The update action runs the profile's plugin install command as a child process, only after an explicit confirmation from the UI, and reports that a reload is required.

### Browser half

```ts
ctx.sidebarRightTabs.register({
  id: PACKAGE_NAME,          // body key is the id, not the kind
  kind: TAB_KIND,            // 'openwiki'
  multiple: false,
  title: () => ctx.locale.bind(NS)('tab.title'),
})
ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
  name: 'sidebar.right.pane.tab', key: PACKAGE_NAME,
}, OpenWikiPane))
ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
  name: 'conversation.session.header.utilities',
  id: PACKAGE_NAME, order: ENTRY_ORDER, locale: NS,
}, OpenWikiEntryButton))
```

The kind declares no `patterns`, so it is a page type opened by kind, and its params are declared by augmenting `SidebarRightTabParamsMap`:

```ts
declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    openwiki: { readonly port?: number }
  }
}
```

The header button resolves the workspace, starts the visualizer when a wiki exists and nothing is running, then calls `ctx.sidebarRight.openTab(TAB_KIND, { params: { port } })`. With no wiki in the workspace it renders disabled with a localized reason, so the affordance never opens an empty pane.

The pane renders a sandboxed iframe to `http://127.0.0.1:<port>/` plus a slim toolbar: status, the plugin version, an update-available affordance, a reload control, and an "open externally" link. Because the page needs CDN assets, a failed load surfaces a localized hint about connectivity instead of a blank frame.

A `settings.section` page carries the configuration summary and the manual version/update controls, so requirement 3's version display and update flow exist in both places.

## Configuration

Every deployment-variable value is a validated `Config` field, per the repository's no-hardcoding rule; protocol constants stay as named constants.

| Field | Default |
| --- | --- |
| `minOpenwikiVersion` | `0.7.2` |
| `minDshVersion` | `0.1.5-rc.1` |
| `wikiDirName` | `openwiki` |
| `defaultPort` | `4321` |
| `portAttempts` | `20` |
| `registryUrl` | `https://registry.npmjs.org` |
| `packageName` | this package's own name |
| `updateCheckOnStart` | `true` |
| `updateCheckIntervalMs` | a sensible interval |
| `autoOpenOnStart` | `false` |
| `spawnTimeoutMs` | generous |

## Errors and edge cases

- openwiki absent → `environment()` reports it; the button explains how to install it.
- openwiki below the minimum → reported with both versions; preview is refused.
- No wiki in the workspace → button disabled with a reason naming `openwiki --init`.
- Port range exhausted → the start reports the failure; the pane stays closed.
- Child exits unexpectedly → `status()` reports it; the pane offers a retry.
- No internet → the iframe loads but the CDN-backed renderer fails; the pane says so.
- Plugin teardown, DSH restart, and a second start attempt are all idempotent.

## Testing

Pure logic (`environment.ts`: version comparison including prerelease ordering, wiki detection, banner and port parsing) is unit-tested directly. The host service is tested against a fake subprocess and a fake registry client, so no real process or network is needed. The browser half is tested in jsdom against a fake RPC, following `ui-memo`'s `tests/fake-rpc.ts` approach, covering: registration into both seats at the expected order, the disabled-without-wiki posture, and the open-tab call carrying the resolved port.

`pnpm run gates` must be green before a pull request, and the change must be verified in the running DSH Web after rebuilding, since it is user-visible.

## Delivery

Per the repository's mandatory workflow: sync `main`, cut `feat/openwiki-visualize` off it, implement with tests and bilingual READMEs, run `pnpm run gates`, verify in the running web profile, then open a pull request that references an issue and carries one `kind/*` and one `area/*` label.

## Open items

- The exact `cordis.patch.yml` row arrangement for a package that carries both halves will be confirmed against the `dsh-web-app` browser roster while implementing.
- A live smoke test of the visualizer against a real wiki is still owed; the reference doc's server findings are source-verified, not yet observed on a running server.
