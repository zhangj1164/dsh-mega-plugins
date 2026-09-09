---
name: dsh-plugin-contribute
description: Use when delivering a new DSH plugin to the ecosystem (packaging a dsh.bundle, publishing to npm or GitHub, tagging the dsh-plugin topic), iterating an already-published plugin (version bump, changelog, re-publish), or analyzing an official reply or review from GitHub Discussions or a plugin repository issue/PR against the plugin's delivery context. Owns the delivery, iteration, and feedback loop; points to the cordis tutorials and cookbook for writing plugin code.
---

# DSH plugin contribution

Deliver and iterate DSH plugins and act on official or community feedback. The official `deepseek-ai/deepseek-harness` repository does not accept external pull requests; the contribution path is to publish a plugin package and announce it in GitHub Discussions, not to open a PR. This skill owns packaging, publishing, version iteration, and reply analysis. For writing plugin code, follow the [cordis tutorial](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-tutorial/01-first-plugin.md), the [package checklist](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-package.md), and the [tool authoring guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-tool.md); the [publish tutorial](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md) owns the bundle and profile mechanics.

Every branch ends by presenting an exact command checklist and pausing before any state-changing operation. See the pause guard.

## Deliver a new plugin

Ship a plugin that is not yet published.

1. Confirm the package is a deliverable bundle: `package.json` declares `dsh: { bundle: { patch: "./cordis.patch.yml" } }`, `files` lists the runtime artifacts, and a plugin entry exists. The publish tutorial defines the manifest shape; a package without `dsh.bundle` installs as a plain dependency and activates no layer.
2. Verify the build produces `lib/`. Run the package build. If users will install from git, confirm a self-contained `prepare` script exists that builds the published entry points without assuming a sibling monorepo checkout.
3. Choose the distribution form and record the exact commands: npm publish ships prebuilt `lib/`; git tag needs a `prepare` script; a tarball comes from `pnpm pack`. The publish tutorial owns the trade-offs and the pnpm ≥10 `allowBuilds` allowance.
4. Generate the delivery checklist: version string, `pnpm pack` dry-run output, the publish command, and the `dsh-plugin` topic tag.
5. Present the checklist and pause. Do not execute publish, push, or discussion creation until the user confirms.
6. On confirmation, execute the publish.
7. Ensure the GitHub repository carries the `dsh-plugin` topic for discoverability.
8. Optionally draft (do not auto-post) a GitHub Discussions announcement in the official repository.

Completion: the plugin is published at a recorded version and discoverable through the `dsh-plugin` topic.

## Iterate a published plugin

Release a new version of a plugin that already ships.

1. Locate the plugin checkout; read the current version from `package.json` and the last release tag.
2. Collect changes since the last tag: `git log <last-tag>..HEAD --oneline`.
3. Decide the semver bump: patch for fixes, minor for additive, major for breaking.
4. Bump the version in `package.json` and update the changelog.
5. Verify the build and run the owning tests; confirm `lib/` is current.
6. Generate the iteration checklist: the new tag, the publish command, and the announcement target.
7. Present the checklist and pause. Do not execute until the user confirms.
8. On confirmation, publish the new version.
9. Draft or update the GitHub Discussions announcement.

Completion: the new version is published, the changelog records the change, and the release is announced.

## Analyze a reply

Act on feedback from official GitHub Discussions, a plugin repository issue or PR, or pasted text.

1. Identify the source: official Discussions on `deepseek-ai/deepseek-harness`, an issue or PR on the plugin's own repository, or text the user pastes.
2. Fetch the reply by channel. For Discussions, query the GraphQL API:

```sh
gh api graphql -F owner=deepseek-ai -F name=deepseek-harness -f query='
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    discussions(first: 10, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes { number title body comments(first: 5) { nodes { author { login } body createdAt } } }
    }
  }
}'
```

For an own-repository issue or PR, use `gh issue view`, `gh pr view`, or `gh api`; for pasted text, use it directly.

3. Load the plugin's delivery context: read `package.json`, the README, and the recent changelog and tags to understand what shipped.
4. Decompose the reply into actionable items: each is a bug, a feature request, a doc gap, or general feedback.
5. Map each item to the action it needs — a code change, a doc update, or a version bump — and point to the relevant cookbook guide for code changes.
6. Recommend the next step per item and which branch of this skill handles it.

Completion: the reply is decomposed into actionable items, each with a recommended next step and the owning branch.

## Pause guard

Present the exact command and pause for user confirmation before any of: `pnpm publish` or `npm publish`; `git push` or `git push --tags`; `gh discussion create` or any `gh api` write; `dsh plugin add` against a profile. Generating the checklist and running read-only checks does not require a pause.
