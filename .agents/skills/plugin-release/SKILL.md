---
name: plugin-release
description: "Prepare a release in this monorepo from the record alone: measure which packages changed since each one last reached npm, decide the version each needs, bump only those manifests, prove the packed artifacts carry no `workspace:` range, and stop before publishing. Use when the user says 发版, 升级插件版本, 要发布到 npm, or invokes /plugin-release."
---

# plugin-release

Turn the PR record on `main` into a publishable version bump: a green tree plus a package-by-package publish list. The publish itself belongs to the user.

Every step names the evidence it needs and the condition that ends it. Which package changed is a measurement — read it, and settle it with the log and the diff rather than a PR title or a label.

## 1. Anchor the release

`main` is the only publishable state, and `pnpm publish` refuses a tree that is dirty or behind its remote (`ERR_PNPM_GIT_UNCLEAN`), so the bump has to land on `main` before the user publishes.

```sh
git fetch origin && git switch main && git pull --ff-only origin main
```

This repository carries no release tags, so the npm publish time is the release anchor for every package:

```sh
npm view <pkg> version      # what the registry serves now
npm view <pkg> time --json  # when each version landed
```

Done when each workspace package (`packages/*/*`) has a published version and its publish timestamp.

## 2. Attribute the change

```sh
git log --since=<that package's publish time> --oneline -- <package dir>
gh pr list --state merged --limit 30 --json number,title,mergedAt,labels
```

An `area/*` label names where a PR intended to land; `git log -- <package dir>` is what proves it. Use the labels to find the candidates and the log to settle them.

Done when every package is either **changed** (source, tests, README, or a runtime `dependencies`/`peerDependencies` range) or **unchanged**, every changed one names the PRs that changed it, and you can say in one line what those PRs did.

A `devDependencies`-only bump never earns a release: consumers do not install those, and a published range that still resolves needs no new version. Say that out loud instead of bumping for activity.

## 3. Choose the version

| Change | Bump |
|---|---|
| a defect fixed, behaviour corrected | patch |
| exported type gains a required field, new config field, new export, changed read semantics | minor |
| public API removed or narrowed | major |

Read the diff, not the PR title. A PR labelled `feat` that only tightens existing behaviour is a patch; a PR labelled `fix` that adds a required field to an exported interface is a minor. Under `0.x` a minor bump is also how this repository says "this may need your attention", so state that in the PR body when it applies.

**Ripple rule.** A dependent whose published `peerDependencies` range would exclude the new version ships a release in the same batch:

```sh
npm view <pkg> peerDependencies
```

`@zhangj1164/dsh-memo` peers telemetry, github-issue and the client UI as `workspace:^`, so its packed range follows whatever those sit at pack time. Telemetry moving `0.2.0 → 0.3.0` leaves memo's published `^0.2.0` excluding it and forces a memo release; inside one minor line the dependent stays put.

Done when each package to publish has a target version and a one-line reason.

## 4. Bump and prove

Change `version` in the affected manifests and nothing else.

```sh
pnpm run gates
cd packages/<area>/<pkg> && pnpm pack --pack-destination <tmp>
tar -xOf <tmp>/<tarball>.tgz package/package.json
```

The packed manifest is the artifact the user publishes, so read it: the new version, no `workspace:` string anywhere, every rewritten peer range naming the versions being published, and the expected `files`. This is the check that catches what `npm publish` ships wrong, because it copies `workspace:` ranges through verbatim.

Done when the gates are green and every packed manifest has been read, not assumed.

## 5. Report

In this order:

1. the PR summary — what landed on `main` since the last release, grouped by package, with PR numbers;
2. the table: package, published version, target version, reason;
3. the packages deliberately left alone and why;
4. the exact publish commands, dependencies first;
5. what the user should see in the registry afterwards.

Publish order follows the workspace graph — `dsh-telemetry`, `dsh-github-issue`, `dsh-memo`, `dsh-client-ui-memo` — because a dependent repacks its peers' current versions.

Verification to quote:

```sh
npm view <pkg>@<version> peerDependencies  # no workspace: range
npm install <pkg>@<version>                # from a clean directory
```

## Boundaries

- Publishing is the user's decision. Prepare up to a committed, pushed `main` plus the command list, then stop and ask; `pnpm publish` is the packer, since `npm publish` writes `workspace:` ranges into the registry.
- The bump reaches `main` through a pull request, per `AGENTS.md`: issue, branch `<kind>/<slug>`, gates, PR, merge. A release PR references the Issues the shipped PRs closed, carries one `kind/*` (usually `kind/cleanup`), and covers the `area/*` labels of what it ships.
- Publish only what changed. A version number is a promise about content, and a release of unchanged bytes spends the user's trust on nothing.

For bundle manifests, the `prepublishOnly` guard and the announcement, read the `dsh-plugin-contribute` skill.
