# @zhangj1164/dsh-openwiki-visualize

English | [中文](README.zh.md)

OpenWiki preview for DSH Web: it finds the OpenWiki in the selected workspace, serves it with the official `openwiki visualize` reader on loopback, and embeds it in the right Sidebar, with openwiki and DSH environment checks and plugin self-update.

## What it does

| Capability | How |
|---|---|
| Detects an OpenWiki | Reads the workspace's `openwiki/` directory and classifies it by the same markers the reader itself uses. |
| Serves it | Spawns `openwiki visualize <wiki> --port <p> --no-open` and reads the port the CLI actually bound. |
| Embeds it | Registers its own right-Sidebar tab type whose body is a sandboxed iframe pointed at the loopback URL. |
| Checks the environment | Reports the openwiki version, the DSH release, and whether each meets its configured floor. |
| Reports and updates itself | Shows its own version, checks the registry once at start, and can install the latest release on request. |

## Requirements

| Requirement | Why |
|---|---|
| openwiki >= 0.7.2 | The visualizer's fixed routes and its lack of framing restrictions are what this plugin embeds. |
| DSH >= 0.2.1-rc.2 | The right-Sidebar tab registry and its two-stage tab-type contract. |
| A workspace whose project has an initialized OpenWiki | There is nothing to serve otherwise, so run `openwiki --init` in the project first. |
| Browser internet access while previewing | The reader loads force-graph, marked, DOMPurify, Mermaid, and Google Fonts from CDNs. |

## Install

```sh
dsh plugin --profile web add @zhangj1164/dsh-openwiki-visualize
```

One row is inserted, because this package owns both halves: the host service is the plugin body, and the browser half is discovered from the same manifest's `dsh.client` declaration.

## Configuration

Every value below is a `Config` field with a schema default, so a deployment overrides only what it needs in its own `cordis.patch.yml`.

| Field | Default | Meaning |
|---|---|---|
| `minOpenwikiVersion` | `0.7.2` | Lowest openwiki the preview will drive. |
| `minDshVersion` | `0.2.1-rc.2` | Lowest DSH release whose tab registry this targets. |
| `wikiDirName` | `openwiki` | Wiki directory, relative to the workspace. |
| `defaultPort` | `4321` | Preferred port; the CLI increments past a busy one. |
| `portAttempts` | `20` | Ports to consider, matching the CLI's own budget. |
| `registryUrl` | `https://registry.npmjs.org` | Where the update check asks. |
| `packageName` | this package | The package the update check and action address. |
| `openwikiCommand` | `openwiki` | The CLI that is probed and spawned. |
| `dshCommand` | `dsh` | Used only by the update action. |
| `profileName` | `$DSH_PROFILE` or `web` | Profile the update action installs into. |
| `dshVersionPackages` | `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app` | Manifests consulted for the running DSH release. |
| `updateCheckOnStart` | `true` | Whether to check the registry as the plugin starts. |
| `spawnTimeoutMs` | `15000` | How long any one child process may take. |
| `registryTimeoutMs` | `8000` | How long the registry request may take. |
| `defaultWorkspacePath` | empty | Workspace used when a caller names none. |

## How the preview is embedded

The pane is an iframe pointed straight at `http://127.0.0.1:<port>`. That needs no proxy because the openwiki server sends neither `X-Frame-Options` nor a `frame-ancestors` directive, so a cross-origin embed is permitted; its remaining CSP directives then govern the framed document rather than the host page.

### The tab type

A right-Sidebar tab type is registered in two stages. The static definition goes on `ctx.sidebarRightTabs` with the package name as its `id`, because the registry requires an id unique across every registration, and that id is also the key the body registers under: a `kind` can be taken over by another implementation, while an `id` cannot.

### The entry button

The button lives in `conversation.session.header.utilities` at order `-20`. `open-in-app` holds `-10` in that list, so this entry renders immediately to its left, beside the control that opens the workspace locally. The button disables itself, with the reason in its tooltip, when the workspace has no OpenWiki or the installation is below the floor, so it never opens an empty pane.

## The Host Remote

The browser half reaches the host only through these methods, under the `openwikiVisualize` namespace.

| Method | Returns |
|---|---|
| `environment` | The openwiki and DSH versions, and whether each passes its floor. |
| `workspace` | Whether the workspace has a wiki, its path, its strongest marker, and its page count. |
| `status` | Whether the visualizer is serving, and where. |
| `start` | Starts the visualizer and returns the port it bound. |
| `stop` | Reaps the child. |
| `version` | This plugin's version and its update posture. |
| `checkUpdate` | A live registry check. |
| `update` | Runs the profile install command and reports whether a reload is needed. |

## Self-update

Checking and installing are separate steps on purpose. The check runs once as the plugin starts and may be automatic, but it never installs anything. Installing rewrites the profile's dependencies, so it happens only when it is asked for, and it reports the exact command it ran so the same step can be repeated by hand.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| The entry button is disabled and says there is no OpenWiki | The workspace's project has no initialized wiki. Run `openwiki --init` at the project root. |
| It says openwiki is below the minimum | The installed CLI is older than `minOpenwikiVersion`. Upgrade it, or lower the floor for this deployment. |
| The pane stays empty and offers Retry | The visualizer did not come up; the failure text names the command and the timeout that produced it. |
| The pane loads but renders unstyled | The reader's CDN assets were unreachable. The frame is fine, but the page needs internet. |
| The tab cannot be opened at all | The profile composes no right Sidebar, so there is no tab registry to register into. The host log says so. |

## Development

```sh
pnpm run build && pnpm run test && pnpm run gates
```

The pure decisions — version comparison, banner parsing, port candidates, and wiki classification — live in `src/environment.ts` and are tested without a machine that happens to have openwiki installed. The host service is tested against a stubbed subprocess and registry, and the browser half against a fake client context.

The verified openwiki surface this plugin builds on, and the browser-plugin survey that preceded it, are recorded in [the OpenWiki visualizer reference](../../../docs/openwiki-visualize-reference.md) and [the browser plugin analysis](../../../docs/browser-plugin-analysis.md).

## License

MIT.
