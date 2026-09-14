# AGENTS.md — dsh-mega-plugins

Four DSH plugins for personal memo management with local-only storage and AI analysis, developed as a pnpm monorepo following the [DSH plugin contribution](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md) pattern.

## Repository layout

```
packages/
  telemetry/dsh-telemetry/        # Generic local telemetry tracker (storage-domain KV)
  github-issue/dsh-github-issue/   # GitHub issue generation and optimization (LLM)
  memo/dsh-memo/                  # Week-keyed memo service (depends on the other two)
  client/ui-memo/                 # Browser-side UI panel (depends on dsh-memo + dsh-github-issue)
scripts/
  verify-translation-pairing.ts   # Bilingual README consistency gate
.github/
  issue-management/               # Issue policy engine and Project board lifecycle
  ISSUE_TEMPLATE/                 # Five native Issue types with <details> folding
  workflows/                      # CI, issue policy, issue lifecycle, translation pairing
.agents/
  skills/dsh-plugin-contribute/   # DSH plugin publication and iteration skill
```

## Commands

```sh
pnpm install                          # install all workspace dependencies
pnpm run build                        # build all packages (tsdown)
pnpm run test                         # run all vitest tests from root (64 tests across 4 packages)
pnpm run gates                        # full gate suite: build + test + hygiene + doc-sync + policy (8 gates)
pnpm run gates:hygiene                # export-JSDoc gate only
pnpm run gates:doc-sync               # translation pairing + markdown links + markdown wrap
pnpm run verify-export-jsdoc          # enforce JSDoc on every exported name
pnpm run verify-package-exports       # every declared exports/types target exists in the build output
pnpm run verify-translation-pairing   # check bilingual README consistency (5 pairs)
pnpm run verify-md-links              # check relative Markdown links resolve
pnpm run verify-md-wrap               # reject hard-wrapped prose paragraphs
node --test .github/issue-management/policy.test.mjs  # run issue policy tests (23 tests)
```

## Mandatory workflow

`main` is always releasable. Nothing reaches it except through a reviewed pull request, and every pull request starts from a branch cut off the latest `main`. This rule is not advisory: the agent or human doing the work follows it, and the reviewer enforces it.

1. **Sync `main` first.** `git fetch origin && git switch main && git pull --ff-only origin main`. Never branch from a stale `main`, and never develop directly on `main`.
2. **Cut a branch.** `<kind>/<short-slug>`, using the same kind as the change's label — for example `fix/memo-llm-failure-passthrough`, `feat/ui-memo-settings-section`, `docs/agents-workflow`. One branch carries one coherent change.
3. **Do the work on the branch,** including tests and documentation. Commit in small, reviewable steps.
4. **Run the whole gate suite locally** with `pnpm run gates` and get it green before opening the pull request. A red gate is never pushed for CI to discover.
5. **For UI changes, verify in the running DSH Web** at `http://127.0.0.1:3080` after rebuilding the affected bundles. A passing unit test is necessary but not sufficient for a user-visible change.
6. **Open a pull request** that references at least one issue, carries exactly one `kind/*` label and at least one `area/*` label, and states what was verified and how. The pull request template lists the required sections.
7. **Merge only after the gates pass on the pull request.** Squash-merge into `main`, then delete the branch.

### Every change starts from an issue

Work that begins from a GitHub issue follows the same path as any other change: read the issue, then create the branch from `main`, implement, and open a pull request that closes the issue. An issue is a work item, not a licence to commit to `main` — the same branch → pull request → gates → merge sequence applies, with no exception for maintainers, for "small" changes, or for automation.

### Do not let a gate guard its own fix

The issue-policy workflow checks out `policy.mjs` from the default branch, so a fix to the policy itself cannot be validated on the pull request that introduces it. Land policy fixes on `main` first (through their own pull request), then re-run the blocked pull request. Do not weaken a gate to make it pass.

## Design principles

- **一切皆插件（Everything is a plugin）**：贯彻 DSH 的核心理念。所有功能以 Cordis 插件形式交付——通过 `ctx.plugin()` 挂载，通过 `Service` / `TypertRemoteService` 暴露能力，通过 `inject` 声明依赖，通过 `ctx.get()` 读取可选服务。禁止在插件边界之外引入裸函数模块或全局单例。新增行为优先寻找 DSH 文档化的扩展点（Service、Event、Tool、Slot、Waterfall），而非修改现有插件内部逻辑。
- **禁止硬编码（No hardcoding）**：部署可变的值必须是校验过的 `Config` 字段，可从 `cordis.yml` 配置；协议常量、外部规范和安全不变量保持固定。禁止在代码中内联 URL、端点、阈值、提示词片段、存储路径等可变值——它们必须作为 `Config` 字段或命名常量声明，并在 `package.json` 的 `dsh.bundle` / `cordis.patch.yml` 中由部署方覆盖。`DEFAULT_*` 常量或测试钩子不算可配置性。

## Conventions

- **ESM everywhere** (`"type": "module"`). Each package uses `tsdown` with `fixedExtension: false` to emit `.js`.
- **Shared devDependencies at root**: tooling duplicated across packages (`vitest`, `tsdown`, `typescript`, `@types/node`) is declared once in the root `package.json` `devDependencies`, not repeated in each package. Each package declares only its own package-specific devDependencies and peer duplicates.
- **Tests required**: every package under `packages/` must have a `tests/` directory with at least one `.spec.ts` file, and all tests must pass via `pnpm run test` (which runs `vitest run` from the repo root). The root `vitest.config.ts` discovers all packages via `packages/*/*/tests/**/*.spec.{ts,tsx}` — no per-package `vitest.config.ts` is needed, mirroring the official DSH pattern. The `gates` aggregate includes the `test` gate and fails the build on any broken test. New packages must add tests before their first release.
- **Workspace protocol**: `dsh-memo` declares `workspace:^` / `workspace:*` for its `dsh-telemetry` and `dsh-github-issue` peer and dev dependencies.
- **Bundle layers**: `dsh-telemetry`, `dsh-github-issue` and `dsh-memo` each declare `dsh.bundle` with their own `cordis.patch.yml`, so any of them can be installed on its own. The memo bundle patch also inserts `dsh-github-issue` for deployments that want the suite; that insertion and the standalone one are interchangeable, not additive — a deployment that installs both must not enable both rows.
- **Standard TypeScript decorators**: `@Remote` decorators on `TypertRemoteService` subclasses require the shared `standardDecorators()` Vite plugin in `scripts/vitest-decorators.ts`, applied globally by the root `vitest.config.ts`. The plugin is a no-op for files without decorator syntax, so it applies safely to every package without per-package config.
- **Bilingual READMEs**: every README is a complete pair (`README.md` + `README.zh.md` + `README.i18n.yaml`). After editing either side, bring the other along and re-record with `pnpm run verify-translation-pairing --write --all`.
- **Issue management**: Issues use five native types (Bug/Feature/Idea/Research/Task) with `<details>` folding and ≤50 visible text units. PRs must reference at least one Issue, carry exactly one `kind/*` label, and at least one `area/*` label. The policy engine in `.github/issue-management/policy.mjs` enforces these rules mechanically.
- **This project is based on the DeepSeek Harness framework** and references official implementations. The `policy.mjs`, issue templates, and PR template are adapted from the [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) repository under BSD-3-Clause.
