# dsh-mega-plugins

English | [中文](README.zh.md)

Four DSH plugins for personal memo management with local-only storage and AI analysis, developed as a pnpm monorepo.

## Packages

- **@zhangj1164/dsh-telemetry** (`packages/telemetry/dsh-telemetry`) — Generic local telemetry tracker over the storage-domain KV backend (req 7).
- **@zhangj1164/dsh-github-issue** (`packages/github-issue/dsh-github-issue`) — GitHub issue generation and optimization service using LLM (req 8, 9, 10, 11).
- **@zhangj1164/dsh-memo** (`packages/memo/dsh-memo`) — Week-keyed personal memo service with AI analysis, report export, and telemetry logging (req 1–6, 8).
- **@zhangj1164/dsh-client-ui-memo** (`packages/client/ui-memo`) — Browser-side UI panel with memo entry, analysis, report download, log analysis, and issue editor (req 1–4, 6, 8, 9, 11).

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

## Workspace Structure

```
packages/
  telemetry/dsh-telemetry/        # @zhangj1164/dsh-telemetry (standalone bundle: `telemetry` row)
  github-issue/dsh-github-issue/  # @zhangj1164/dsh-github-issue (standalone bundle: `github-issue` row)
  memo/dsh-memo/                  # @zhangj1164/dsh-memo (bundle: `memo` + `ui-memo` rows; injects both services)
  client/ui-memo/                 # @zhangj1164/dsh-client-ui-memo (dsh.client plugin, no bundle; inserted by @zhangj1164/dsh-memo)
```

The `pnpm-workspace.yaml` declares `packages/*/*` — mirroring the DSH monorepo's `packages/<group>/<pkg>` convention.
