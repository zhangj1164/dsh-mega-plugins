# dsh-mega-plugins

English | [中文](README.zh.md)

Six DSH plugins developed as a pnpm monorepo: a local-only personal memo suite with AI analysis and its Settings page, and an OpenWiki preview for the Web right Sidebar.

## Packages

- **@zhangj1164/dsh-telemetry** (`packages/telemetry/dsh-telemetry`) — Generic local telemetry tracker over the storage-domain KV backend (req 7).
- **@zhangj1164/dsh-github-issue** (`packages/github-issue/dsh-github-issue`) — GitHub issue generation and optimization service using LLM (req 8, 9, 10, 11).
- **@zhangj1164/dsh-memo** (`packages/memo/dsh-memo`) — Week-keyed personal memo service with AI analysis, report export, and telemetry logging (req 1–6, 8).
- **@zhangj1164/dsh-client-ui-memo** (`packages/client/ui-memo`) — Browser-side UI panel with memo entry, analysis, report download, log analysis, and issue editor (req 1–4, 6, 8, 9, 11).
- **@zhangj1164/dsh-client-ui-memo-settings** (`packages/client/ui-memo-settings`) — Settings page for the memo suite: edits the memo Host's AI route, archived-session summary copy, and GitHub repository from DSH Web, applying each save without a restart.
- **@zhangj1164/dsh-openwiki-visualize** (`packages/openwiki/dsh-openwiki-visualize`) — Detects the OpenWiki in the selected workspace, serves it with `openwiki visualize` on loopback, and embeds the official reader in a self-owned right-Sidebar tab, with openwiki/DSH environment checks and plugin self-update.

## Commands

```sh
pnpm install                          # install all workspace dependencies
pnpm run build                        # build all packages (tsdown)
pnpm run test                         # run all vitest tests
pnpm run gates                        # full gate suite: build + test + hygiene + doc-sync
pnpm run verify-translation-pairing   # check bilingual README consistency (7 pairs)
```

## Install into a DSH profile

`@zhangj1164/dsh-telemetry`, `@zhangj1164/dsh-github-issue`, `@zhangj1164/dsh-memo` and `@zhangj1164/dsh-client-ui-memo-settings` each declare their own `dsh.bundle`, and every composition entry id has exactly one owning bundle. A subset composes as cleanly as the whole suite, so name the packages you want:

```sh
# the full memo suite (telemetry + issue service + memo + its browser panel + its settings page)
dsh plugin --profile web add @zhangj1164/dsh-telemetry @zhangj1164/dsh-github-issue @zhangj1164/dsh-memo @zhangj1164/dsh-client-ui-memo-settings

# the generic telemetry service alone, for another plugin to consume
dsh plugin --profile web add @zhangj1164/dsh-telemetry
```

Name every bundle the boot needs. A profile sets `autoInstallPeers: false`, so an install brings in what the command names plus what those packages depend on, and never a peer dependency. The memo panel is one of those dependencies: `@zhangj1164/dsh-client-ui-memo` arrives with `@zhangj1164/dsh-memo` and is not named. `@zhangj1164/dsh-memo` by itself still leaves the `github-issue` row unresolvable — `memo (@zhangj1164/dsh-memo): pending (waiting for service: githubIssue)` — because that service is owned by its own bundle.

`@zhangj1164/dsh-client-ui-memo` declares no bundle of its own. `@zhangj1164/dsh-memo`'s patch inserts its `ui-memo` row and depends on the package, so installing the memo service installs and activates the panel; `dsh plugin add` reports a package without `dsh.bundle` as a plain dependency rather than a profile layer, and that warning is expected for a `dsh.client` plugin, not a defect. The declaration is a regular dependency rather than a peer on purpose: a profile installs no peers, and the release that declared it as one left the row inactive and the sidebar without a memo entry ([#194](https://github.com/zhangj1164/dsh-mega-plugins/issues/194)). The panel keeps its own peer on the memo host, which is why pnpm reports a cyclic workspace dependency on install; no build or boot depends on that order. `@zhangj1164/dsh-client-ui-memo-settings` differs on purpose: it carries its own bundle patch, which inserts the `ui-memo-settings` row, so it installs as a profile layer and can be added or removed without touching the memo bundle. Its page registers only while the deployed memo Host serves the `memo` settings namespace, so installing it without the memo suite leaves no visible trace.

`@zhangj1164/dsh-telemetry` and `@zhangj1164/dsh-github-issue` expose Cordis services (`ctx.telemetry`, `ctx.githubIssue`) rather than model tools or panels of their own. They are infrastructure: installing `@zhangj1164/dsh-telemetry` by itself gives a consumer plugin something to call and gives an end user nothing to see. The visible surface is the memo board.

### Install from GitHub instead of the registry

The same packages install straight from this repository, with no registry release. pnpm selects a package inside a repository with a `path:` parameter that belongs to the **committish**, after the `#` — pnpm reads it as part of the ref, so an `&path:` written against the repository URL is silently taken as part of the repository name and the fetch fails:

```sh
dsh plugin --profile web add \
  "github:zhangj1164/dsh-mega-plugins#path:packages/telemetry/dsh-telemetry" \
  "github:zhangj1164/dsh-mega-plugins#path:packages/github-issue/dsh-github-issue" \
  "github:zhangj1164/dsh-mega-plugins#path:packages/memo/dsh-memo" \
  "github:zhangj1164/dsh-mega-plugins#path:packages/client/ui-memo-settings"
```

Add `"github:zhangj1164/dsh-mega-plugins#path:packages/client/ui-memo"` when the change under test is a browser-side one. Without it the install still succeeds: a git-read manifest keeps its plain range, so the memo bundle takes the panel from the registry as its dependency. Naming the path pins the panel to the same checkout, which is what a panel change needs.

A git install fetches source, not build output, so each package's `prepare` script builds `lib/` during the install. pnpm ≥10 does not run that script until the profile authorizes it: the first `add` fails with `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` and prints an exact `allowBuilds` key. The key pnpm prints names the resolved commit, so it stops matching after the next push. Write the repository-level form instead — it matches any commit — into `${DSH_HOME}/profiles/web/pnpm-workspace.yaml`:

```yaml
allowBuilds:
  '@zhangj1164/dsh-telemetry@git+https://github.com/zhangj1164/dsh-mega-plugins.git': true
  '@zhangj1164/dsh-github-issue@git+https://github.com/zhangj1164/dsh-mega-plugins.git': true
  '@zhangj1164/dsh-memo@git+https://github.com/zhangj1164/dsh-mega-plugins.git': true
  '@zhangj1164/dsh-client-ui-memo@git+https://github.com/zhangj1164/dsh-mega-plugins.git': true
  '@zhangj1164/dsh-client-ui-memo-settings@git+https://github.com/zhangj1164/dsh-mega-plugins.git': true
```

That authorization lets the package's code run on your machine at install time, outside any agent sandbox. Allow only source you trust, and pin the commit when the installed content must stop moving — `github:zhangj1164/dsh-mega-plugins#<sha>&path:packages/memo/dsh-memo`, with the ref and the `path:` joined by `&`.

The registry stays the better default: a published package ships prebuilt `lib/` and needs no build authorization at all. A git install also keeps `workspace:^` in the sibling `peerDependencies`, because nothing rewrites a manifest pnpm reads straight out of a checkout. pnpm prints a peer warning for those ranges, and the boot is unaffected: a profile names every package the boot needs and sets `autoInstallPeers: false`, so the ranges have nothing left to resolve. For the same reason a plain range carries the one dependency that must install — the memo bundle's panel — and a `workspace:` range there would break this install with `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`.

## Workspace Structure

```
packages/
  telemetry/dsh-telemetry/        # @zhangj1164/dsh-telemetry (standalone bundle: `telemetry` row)
  github-issue/dsh-github-issue/  # @zhangj1164/dsh-github-issue (standalone bundle: `github-issue` row)
  memo/dsh-memo/                  # @zhangj1164/dsh-memo (bundle: `memo` + `ui-memo` rows; injects both services)
  client/ui-memo/                 # @zhangj1164/dsh-client-ui-memo (dsh.client plugin, no bundle; inserted by @zhangj1164/dsh-memo)
  client/ui-memo-settings/        # @zhangj1164/dsh-client-ui-memo-settings (dsh.client plugin + own bundle: `ui-memo-settings` row)
  openwiki/dsh-openwiki-visualize/ # @zhangj1164/dsh-openwiki-visualize (own bundle: `openwiki-visualize` row; carries both a host service and its dsh.client half)
```

The `pnpm-workspace.yaml` declares `packages/*/*` — mirroring the DSH monorepo's `packages/<group>/<pkg>` convention.
