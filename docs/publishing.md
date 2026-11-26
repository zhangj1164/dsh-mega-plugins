# Publishing to npm

Every package under `packages/` publishes from its own GitHub Actions workflow, and every one of those workflows authenticates through [npm trusted publishing](https://docs.npmjs.com/trusted-publishers): the job proves its identity to the registry with a GitHub OIDC token, and npm mints a short-lived publish token for that one run. No `NPM_TOKEN` secret exists in this repository, and none should be added.

The workflows live in `.github/workflows/publish-<short>.yml`. Each one is the same file with four values swapped — package name, package directory, tag prefix, concurrency group — so a change to the publish logic belongs in all six, or better, in `scripts/publish-plan.ts` and the six workflows together.

## The release flow

1. Bump the version in the package's `package.json` on a branch, open the pull request, let the gates pass, and squash-merge into `main`. Nothing is published from a branch.
2. Tag the squash-merge commit on `main` and push the tag:

   ```sh
   git switch main && git pull --ff-only origin main
   git tag memo-v0.7.5
   git push origin memo-v0.7.5
   ```

3. The tag runs `.github/workflows/publish-memo.yml`, which resolves the release plan, refuses a tag that is not on `main`, refuses a tag whose version disagrees with the manifest, refuses a version that already exists on the registry, builds the workspace, runs `pnpm publish`, and verifies the registry copy it just created.
4. Publish in dependency order, and bump dependents in the same batch when a new version falls outside their peer range: `@zhangj1164/dsh-telemetry` → `@zhangj1164/dsh-github-issue` → `@zhangj1164/dsh-memo` → `@zhangj1164/dsh-client-ui-memo` → `@zhangj1164/dsh-client-ui-memo-settings` / `@zhangj1164/dsh-openwiki-visualize`. A dependent package re-packs its peers' published versions while packing, so the peer has to be on the registry first; the memo 0.7.4 / ui-memo 0.7.1 release in [#199](https://github.com/zhangj1164/dsh-mega-plugins/pull/199) shipped in that order for exactly this reason, and `pnpm run verify-publish-guard` plus the packed-manifest read are what catch a `workspace:` range that slipped through.

## Parameters for each npm `/access` page

Open the package's page on npm — `https://www.npmjs.com/package/<name>/access` — find **Trusted publishing**, choose **GitHub Actions**, and fill the form with these values. All six packages use the same values except the workflow filename.

| Field on the /access page | Value |
| --- | --- |
| Publisher | `GitHub Actions` |
| Organization or user | `zhangj1164` |
| Repository | `dsh-mega-plugins` |
| Workflow filename | the package's own file, exactly as listed below |
| Environment name | leave empty |
| Allowed actions | check **Allow npm publish** only |

| Package | Tag prefix | Workflow filename | `/access` page |
| --- | --- | --- | --- |
| `@zhangj1164/dsh-telemetry` | `telemetry-v` | `publish-telemetry.yml` | https://www.npmjs.com/package/@zhangj1164/dsh-telemetry/access |
| `@zhangj1164/dsh-github-issue` | `github-issue-v` | `publish-github-issue.yml` | https://www.npmjs.com/package/@zhangj1164/dsh-github-issue/access |
| `@zhangj1164/dsh-memo` | `memo-v` | `publish-memo.yml` | https://www.npmjs.com/package/@zhangj1164/dsh-memo/access |
| `@zhangj1164/dsh-client-ui-memo` | `ui-memo-v` | `publish-ui-memo.yml` | https://www.npmjs.com/package/@zhangj1164/dsh-client-ui-memo/access |
| `@zhangj1164/dsh-client-ui-memo-settings` | `ui-memo-settings-v` | `publish-ui-memo-settings.yml` | https://www.npmjs.com/package/@zhangj1164/dsh-client-ui-memo-settings/access |
| `@zhangj1164/dsh-openwiki-visualize` | `openwiki-visualize-v` | `publish-openwiki-visualize.yml` | https://www.npmjs.com/package/@zhangj1164/dsh-openwiki-visualize/access |

Four consequences are worth stating plainly:

- The workflow filename is part of the credential. npm compares it against the `workflow_ref` claim in the OIDC token, so a stored value of `publish-memo.yml` covers `.github/workflows/publish-memo.yml` and nothing else. Renaming a workflow file, or adding a reusable workflow between the tag and the publish job, invalidates the connection until the page is updated.
- Leave **Environment name** empty, because the workflows declare no `environment:`. Filling it in would require adding the same `environment:` to the job, and a mismatch fails the OIDC exchange rather than falling back to a token.
- A package can be configured as a trusted publisher only after it has been published at least once. All six already exist on the registry, so every page is configurable today; a brand-new seventh package needs one manual, token-authenticated publish first.
- Each package accepts up to 10 trusted publisher connections. Dist-tag and staged-publish permissions are deliberately off: the workflows publish `latest` directly, and widening the allowed actions would let a compromised run move tags it has no reason to touch.

## Why one workflow per package

Trusted publishing binds a connection to one workflow filename, so a single `publish.yml` driving a matrix could not be authorized for six packages, and a `workflow_call` indirection would break the filename match for every caller. Six self-contained files are the shape the credential model asks for; the cost is that a change to the shared logic belongs in `scripts/publish-plan.ts` with the workflows calling it, which is where the tag, version, and registry checks already live.

## What the publish workflows deliberately do not do

- **No token, no `registry-url`.** `actions/setup-node` writes `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}` into `.npmrc` when `registry-url` is set; with no secret defined, that line is an empty token, and pnpm's OIDC exchange is skipped in favour of an authentication that cannot succeed. The workflows set neither, so pnpm fetches the OIDC token from `ACTIONS_ID_TOKEN_REQUEST_URL`, exchanges it for a publish token, and attaches provenance on its own because this repository and these packages are public.
- **No `npm publish`.** pnpm rewrites `workspace:` ranges to real versions while packing; npm ships them verbatim, which is the failure recorded in [Publish with `pnpm publish`, never `npm publish`](../AGENTS.md#publish-with-pnpm-publish-never-npm-publish).
- **No full gate suite.** The pull request already ran `pnpm run gates` before the merge; a publish run repeats only `pnpm run build`, because a dependent package's `.d.ts` needs its peers' built `lib/`. Re-running eleven gates six times per release batch would mostly re-prove the tag commit the PR already proved.
- **No `--provenance` flag.** Provenance is attached automatically for a public package published from a public repository; forcing it adds nothing and would fail a release if the environment changed.
- **No silent re-publish.** A tag push for a version already on the registry fails with a message saying so. Re-running a finished release is the job of `workflow_dispatch` from the tag, which detects the existing version itself and verifies the registry copy instead of publishing again.

## The checks behind each workflow

`scripts/publish-plan.ts` is the only shared code; the workflows call it twice.

- `plan` refuses a manifest marked `private`, a tag that does not match the package's prefix, a tag that names a different version than `package.json` declares, and a tag push whose version already exists. It writes `version`, `tag`, and `skip` to `$GITHUB_OUTPUT` for the later steps, and appends a table to the job summary.
- `verify` reads the registry copy back and fails on a version mismatch, any surviving `workspace:` range in the published manifest, or a `latest` dist-tag pointing somewhere else. A missing provenance attestation is a warning, because the releases published before the workflows existed (memo 0.7.4 among them) carry none.

The workflow also proves the tag commit is reachable from `origin/main` before building anything, and passes `--no-git-checks` to `pnpm publish` because the tag checkout is a detached HEAD — pnpm's own branch check would abort with `GIT_UNKNOWN_BRANCH`, and the ancestry check is the stricter test anyway.

## Recovering a failed release

| Situation | What to do |
| --- | --- |
| The run failed before the upload finished | Re-run the failed job, or dispatch the workflow from the tag: the version is still absent, so it publishes. |
| The upload succeeded but a later step failed | Dispatch the workflow from the tag. The plan detects the published version and switches to verification only. |
| The tag points at a commit that never reached `main` | Delete the tag, merge the commit through a pull request, re-tag the merge commit on `main`. |
| The tag names the wrong version | Delete the tag, fix the version through a pull request, re-tag the merge commit. Nothing was published: the plan refuses the tag before the build. |
| The workflow filename was renamed | Update the package's `/access` page first; the OIDC claim carries the new name, so the old connection no longer matches. |

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `403 Forbidden` / `ENEEDAUTH` when publishing | No trusted publisher connection matches the OIDC claim: wrong workflow filename, wrong repository, or a filled-in environment that the job does not declare. | Correct the `/access` page; compare the workflow filename character for character. |
| An OIDC token error naming `id-token` | The job lost `permissions: id-token: write`, usually by adding a job-level `permissions` block that replaced the workflow-level one. | Keep `id-token: write` on whichever block applies to the publish job. |
| `E409` / "cannot publish over the previously published versions" | The version already exists and the tag push was not supposed to be a re-run. | Bump the version through a pull request; do not reuse a version. |
| The registry copy shows a `workspace:` range | The package was published by `npm publish` or a tool that copies the manifest verbatim. | Publish with `pnpm publish`; the verify step fails on this so it cannot pass unnoticed. |
| `GIT_UNKNOWN_BRANCH` from pnpm | `--no-git-checks` was removed from the publish command. | Restore it; keep the ancestry step as the real check. |
| The run says the tag is not on `main` | The tag was created on a branch commit, or `fetch-depth: 0` was removed so `origin/main` is unknown. | Tag the squash-merge commit on `main`; keep the full-history checkout. |
| Provenance is absent on a new release | The repository or the package turned private, or the run published with a token instead of OIDC. | Check repository visibility and remove any `NODE_AUTH_TOKEN`/`registry-url` configuration. |

## Trying the checks locally

The plan and verify modes read the same environment variables the workflows set, and they talk to the registry directly, so a release can be rehearsed without pushing a tag:

```sh
PACKAGE_DIR=packages/memo/dsh-memo PACKAGE_NAME=@zhangj1164/dsh-memo \
TAG=memo-v0.7.5 TAG_PREFIX=memo-v GITHUB_EVENT_NAME=workflow_dispatch \
pnpm exec tsx scripts/publish-plan.ts plan

PACKAGE_NAME=@zhangj1164/dsh-memo VERSION=0.7.5 DIST_TAG=latest \
pnpm exec tsx scripts/publish-plan.ts verify
```

`pnpm exec vitest run scripts/tests/publish-plan.spec.ts` covers the refusals without touching the network, and `pnpm --filter <name> publish --dry-run --no-git-checks` packs the package and runs its `prepublishOnly` guard without uploading.

## Adding a new publishable package

1. Confirm the package has a first publish on npm; trusted publishing cannot be configured before that.
2. Copy any `publish-*.yml` workflow, then replace the package name, `PACKAGE_DIR`, `TAG_PREFIX`, and the concurrency group (all four appear in the file).
3. Add the package to the two tables above, and the workflow filename to the `/access` instructions.
4. Configure the `/access` page with the values from the first table before pushing the first tag.
