---
name: awesome-dsh-plugin
description: "Update this monorepo's rows in `awesome-dsh-plugin` after a release, or add the row for a new installable subpackage: diff each existing `data/plugins/zhangj1164__dsh-mega-plugins*.yml` against the shipped code, rewrite only the entries whose claims went stale, prove the new line and the file shape, then open a PR from a fork and stop before a maintainer merges. Use when the user says 投稿 awesome、更新 awesome 条目、同步 awesome-dsh-plugin，or invokes /awesome-dsh-plugin."
---

# awesome-dsh-plugin

Keep this repo's rows on the list true, then hand the maintainer a one-file PR. A row is a claim about shipped code, so the work is a diff against the release, not a copy of the README.

## 1. Anchor

`main` is the only state worth describing, and the entries live upstream:

```sh
git fetch origin && git switch main && git pull --ff-only origin main
```

Read the rulebook and one recent update PR in the same pass. `contributing.md` is authoritative; the PR shows the shape maintainers accept today, which is what a rulebook lags behind:

```sh
gh api repos/awesome-dsh-plugin/awesome-dsh-plugin/contents/contributing.md -H "Accept: application/vnd.github.raw"
gh pr list --repo awesome-dsh-plugin/awesome-dsh-plugin --state all --limit 20 --json number,title,state,createdAt
gh pr diff <the newest update PR> --repo awesome-dsh-plugin/awesome-dsh-plugin
```

Then read every entry this repo owns. One file per installable subpackage, named `data/plugins/zhangj1164__dsh-mega-plugins--packages-<dir>-<pkg>.yml`:

```sh
gh search code --repo awesome-dsh-plugin/awesome-dsh-plugin zhangj1164
gh api "repos/awesome-dsh-plugin/awesome-dsh-plugin/contents/data/plugins/<file>.yml" \
  -H "Accept: application/vnd.github.raw"
```

Done when you hold contributing.md, a recent update PR, and the content of every entry this repo owns.

## 2. Decide what is stale

An entry is **stale** when its line overstates, understates, or misses something the released code now does. A version bump is not staleness by itself: the list has no version field, and a release that only fixes behaviour inside an already-described capability changes nothing here.

For each entry, walk the claims in its `description` against the package's README and source since the last submission:

```sh
git log --oneline -- packages/<area>/<pkg>
```

Also check the two shape changes the entry set can need: a subpackage that became installable since the last submission (`dsh.bundle` now in its `package.json`), and an entry whose package no longer exists. `@zhangj1164/dsh-client-ui-memo` ships only `dsh.client`, installs as part of memo's bundle, and must not get a row of its own.

Done when every entry is either **current** — with the sentence you checked and the source that backs it — or **stale**, with the exact sentence to change and the replacement. If none is stale, stop and report "no PR needed"; a PR that rewrites nothing spends review on nothing.

## 3. Draft the change

Edit only this repo's entry files, and only the sentences that went stale. A PR may carry at most 3 entries (a monorepo allowance), so when more are stale, split into several PRs rather than exceed it.

The rules that decide whether CI passes and a maintainer merges:

- `description.en` is required, ends with a period, and states what the plugin does — no superlatives. Add `zh` in the same PR; leaving it out is allowed but a bilingual row is the norm here.
- Quote a value containing `: `, or YAML reads it as a nested key.
- `url` names the subdirectory exactly: `https://github.com/zhangj1164/dsh-mega-plugins/tree/main/packages/<area>/<pkg>`. `name` is `zhangj1164/dsh-mega-plugins#<pkg>`.
- `category` says what it does: `dev` for telemetry and github-issue, `memory` for memo, `docs` for openwiki. A new subpackage picks its own; a near miss is a maintainer edit, not a bounce.
- No `npm:` key, no hand-edited README, no touching another author's entry.

Done when the draft names every changed file, every changed sentence, and why the old sentence was wrong.

## 4. Prove it

The description is read as a claim and checked against the code, so make the same check the maintainer will: every number counted, every API name grepped.

Do the whole proof in a throwaway clone, because the generator needs the real repository:

```sh
gh repo clone awesome-dsh-plugin/awesome-dsh-plugin <tmp> -- --depth 1
cd <tmp> && npm ci
# write the entry file(s), then:
node scripts/generate-readme.mjs
git status --short
```

The generator is the entry parser: if it runs, the YAML loads and every field has the shape `lib/entries.mjs` expects. Its README diff must change no other entry's lines — if it does, the checkout was not on a clean `main`; discard those generated files before committing, since `main` regenerates them after merge.

Confirm the CI preconditions from GitHub rather than from memory:

```sh
gh api repos/zhangj1164/dsh-mega-plugins --jq '.created_at, .archived'
gh api repos/zhangj1164/dsh-mega-plugins/topics --jq '.names'
```

`dsh.bundle` must exist in the entry's subpackage, the repo must be at least a day old, and the `dsh-plugin` topic must be present.

Done when the generator accepted every changed file, every claim has a source, and the three preconditions are confirmed.

## 5. Open the PR

Pause before any write to GitHub. Show the `git diff`, the PR title and body, and the exact commands, then ask.

```sh
git switch -c update-<pkg>-entry
git add data/plugins/<changed files>
git commit -m "Update zhangj1164/dsh-mega-plugins#<pkg> entry: <what changed>"
```

On confirmation, fork if needed, push the branch, and open the PR:

```sh
gh repo view zhangj1164/awesome-dsh-plugin >/dev/null 2>&1 \
  || gh repo fork awesome-dsh-plugin/awesome-dsh-plugin --clone=false
git remote add fork https://github.com/zhangj1164/awesome-dsh-plugin.git  # once
git push fork update-<pkg>-entry
gh pr create --repo awesome-dsh-plugin/awesome-dsh-plugin \
  --head zhangj1164:update-<pkg>-entry \
  --title "Update zhangj1164/dsh-mega-plugins#<pkg>: <one-line change>" \
  --body-file <body>
```

The body names the release the line now describes, lists each changed sentence and why, and says the branch touches only this repo's entry. Then watch CI — it checks entry count, `dsh.bundle`, repo age, `awesome-lint` and the site build. Push a fix to the same branch; do not open a second PR.

Done when CI is green, or a failing check is explained in a PR comment. The maintainer merges; the skill stops there.

## Boundaries

- The list is a claim, not a mirror: never paste README marketing, never describe a capability the code does not have.
- Only this repo's entries, at most 3 per PR, never the generated READMEs, never another author's row.
- Forking, pushing and opening the PR are state-changing: present the diff and commands, then pause for confirmation, as `dsh-plugin-contribute` does.
- npm presence is optional and detected automatically; a `tarball:` field is for GitHub Release assets only, and this repo publishes to npm.
