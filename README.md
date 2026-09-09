# dsh-mega-plugins

English | [中文](README.zh.md)

Four DSH plugins for personal memo management with local-only storage and AI analysis, developed as a pnpm monorepo.

## Packages

- **dsh-telemetry** (`packages/telemetry/dsh-telemetry`) — Generic local telemetry tracker over the storage-domain KV backend (req 7).
- **dsh-github-issue** (`packages/github-issue/dsh-github-issue`) — GitHub issue generation and optimization service using LLM (req 8, 9, 10, 11).
- **dsh-memo** (`packages/memo/dsh-memo`) — Week-keyed personal memo service with AI analysis, report export, and telemetry logging (req 1–6, 8).
- **dsh-client-ui-memo** (`packages/client/ui-memo`) — Browser-side UI panel with memo entry, analysis, report download, log analysis, and issue editor (req 1–4, 6, 8, 9, 11).

## Commands

```sh
pnpm install                          # install all workspace dependencies
pnpm run build                        # build all packages (tsdown)
pnpm run test                         # run all vitest tests
pnpm run gates                        # full gate suite: build + test + hygiene + doc-sync
pnpm run verify-translation-pairing   # check bilingual README consistency (6 pairs)
```

## Workspace Structure

```
packages/
  telemetry/dsh-telemetry/        # dsh-telemetry (standalone bundle)
  github-issue/dsh-github-issue/ # dsh-github-issue (plain dep, no bundle)
  memo/dsh-memo/                  # dsh-memo (bundle; depends on the above two)
  client/ui-memo/                 # dsh-client-ui-memo (UI panel; depends on dsh-memo + dsh-github-issue)
```

The `pnpm-workspace.yaml` declares `packages/*/*` — mirroring the DSH monorepo's `packages/<group>/<pkg>` convention.
