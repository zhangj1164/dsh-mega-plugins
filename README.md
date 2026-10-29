# dsh-mega-plugins

English | [中文](README.zh.md)

Five DSH plugins developed as a pnpm monorepo: a local-only personal memo suite with AI analysis, and an OpenWiki preview for the Web right Sidebar.

## Packages

- **@zhangj1164/dsh-telemetry** (`packages/telemetry/dsh-telemetry`) — Generic local telemetry tracker over the storage-domain KV backend (req 7).
- **@zhangj1164/dsh-github-issue** (`packages/github-issue/dsh-github-issue`) — GitHub issue generation and optimization service using LLM (req 8, 9, 10, 11).
- **@zhangj1164/dsh-memo** (`packages/memo/dsh-memo`) — Week-keyed personal memo service with AI analysis, report export, and telemetry logging (req 1–6, 8).
- **@zhangj1164/dsh-client-ui-memo** (`packages/client/ui-memo`) — Browser-side UI panel with memo entry, analysis, report download, log analysis, and issue editor (req 1–4, 6, 8, 9, 11).
- **@zhangj1164/dsh-openwiki-visualize** (`packages/openwiki/dsh-openwiki-visualize`) — Detects the OpenWiki in the selected workspace, serves it with `openwiki visualize` on loopback, and embeds the official reader in a self-owned right-Sidebar tab, with openwiki/DSH environment checks and plugin self-update.

## Commands

```sh
pnpm install                          # install all workspace dependencies
pnpm run build                        # build all packages (tsdown)
pnpm run test                         # run all vitest tests
pnpm run gates                        # full gate suite: build + test + hygiene + doc-sync
pnpm run verify-translation-pairing   # check bilingual README consistency (6 pairs)
```

## Install into a DSH profile

`@zhangj1164/dsh-telemetry`, `@zhangj1164/dsh-github-issue` and `@zhangj1164/dsh-memo` each declare their own `dsh.bundle`, and every composition entry id has exactly one owning bundle. A subset composes as cleanly as the whole suite, so name the packages you want:

```sh
# the full memo suite (telemetry + issue service + memo + its browser panel)
dsh plugin --profile web add @zhangj1164/dsh-telemetry @zhangj1164/dsh-github-issue @zhangj1164/dsh-memo @zhangj1164/dsh-client-ui-memo

# the generic telemetry service alone, for another plugin to consume
dsh plugin --profile web add @zhangj1164/dsh-telemetry
```

Every package whose row or injected service the boot needs must be named. A profile sets `autoInstallPeers: false`, so an install brings in only what the command names — `@zhangj1164/dsh-memo` alone leaves the `github-issue` and `ui-memo` rows unresolvable and the loader fails the boot.

`@zhangj1164/dsh-client-ui-memo` declares no bundle of its own: `@zhangj1164/dsh-memo`'s patch inserts its `ui-memo` row, so the panel is activated by installing `@zhangj1164/dsh-memo` — but the package itself still has to be named, and `dsh plugin add` reports it as a plain dependency rather than a profile layer. That warning is expected for a `dsh.client` plugin, not a defect.

`@zhangj1164/dsh-telemetry` and `@zhangj1164/dsh-github-issue` expose Cordis services (`ctx.telemetry`, `ctx.githubIssue`) rather than model tools or panels of their own. They are infrastructure: installing `@zhangj1164/dsh-telemetry` by itself gives a consumer plugin something to call and gives an end user nothing to see. The visible surface is the memo board.

### Install from GitHub instead of the registry

The same four packages install straight from this repository, with no registry release. pnpm selects a package inside a repository with a `path:` parameter that belongs to the **committish**, after the `#` — pnpm reads it as part of the ref, so an `&path:` written against the repository URL is silently taken as part of the repository name and the fetch fails:

```sh
dsh plugin --profile web add \
  "github:zhangj1164/dsh-mega-plugins#path:packages/telemetry/dsh-telemetry" \
  "github:zhangj1164/dsh-mega-plugins#path:packages/github-issue/dsh-github-issue" \
  "github:zhangj1164/dsh-mega-plugins#path:packages/memo/dsh-memo" \
  "github:zhangj1164/dsh-mega-plugins#path:packages/client/ui-memo"
```

A git install fetches source, not build output, so each package's `prepare` script builds `lib/` during the install. pnpm ≥10 does not run that script until the profile authorizes it: the first `add` fails with `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` and prints an exact `allowBuilds` key. The key pnpm prints names the resolved commit, so it stops matching after the next push. Write the repository-level form instead — it matches any commit — into `${DSH_HOME}/profiles/web/pnpm-workspace.yaml`:

```yaml
allowBuilds:
  '@zhangj1164/dsh-telemetry@git+https://github.com/zhangj1164/dsh-mega-plugins.git': true
  '@zhangj1164/dsh-github-issue@git+https://github.com/zhangj1164/dsh-mega-plugins.git': true
  '@zhangj1164/dsh-memo@git+https://github.com/zhangj1164/dsh-mega-plugins.git': true
  '@zhangj1164/dsh-client-ui-memo@git+https://github.com/zhangj1164/dsh-mega-plugins.git': true
```

That authorization lets the package's code run on your machine at install time, outside any agent sandbox. Allow only source you trust, and pin the commit when the installed content must stop moving — `github:zhangj1164/dsh-mega-plugins#<sha>&path:packages/memo/dsh-memo`, with the ref and the `path:` joined by `&`.

The registry stays the better default: a published package ships prebuilt `lib/` and needs no build authorization at all. A git install also keeps `workspace:^` in the sibling `peerDependencies`, because nothing rewrites a manifest pnpm reads straight out of a checkout. pnpm prints a peer warning for those ranges, and the boot is unaffected: a profile names every package the boot needs and sets `autoInstallPeers: false`, so the ranges have nothing left to resolve.

## Workspace Structure

```
packages/
  telemetry/dsh-telemetry/        # @zhangj1164/dsh-telemetry (standalone bundle: `telemetry` row)
  github-issue/dsh-github-issue/  # @zhangj1164/dsh-github-issue (standalone bundle: `github-issue` row)
  memo/dsh-memo/                  # @zhangj1164/dsh-memo (bundle: `memo` + `ui-memo` rows; injects both services)
  client/ui-memo/                 # @zhangj1164/dsh-client-ui-memo (dsh.client plugin, no bundle; inserted by @zhangj1164/dsh-memo)
  openwiki/dsh-openwiki-visualize/ # @zhangj1164/dsh-openwiki-visualize (own bundle: `openwiki-visualize` row; carries both a host service and its dsh.client half)
```

The `pnpm-workspace.yaml` declares `packages/*/*` — mirroring the DSH monorepo's `packages/<group>/<pkg>` convention.
