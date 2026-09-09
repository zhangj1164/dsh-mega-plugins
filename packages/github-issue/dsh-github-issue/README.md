# dsh-github-issue

English | [中文](README.zh.md)

GitHub issue generation and optimization service for DeepSeek Harness. Builds structured issue reports from telemetry analysis, constructs pre-filled issue-creation URLs, and optimizes natural-language issue descriptions with the configured model.

## Plugin

`GithubIssueService extends TypertRemoteService` with `static inject = ['llm']`. The service uses `ctx.get('llm')` for model calls and exposes three Remote methods callable by the client UI.

| Config | Default | Meaning |
|---|---|---|
| `repoUrl` | `https://github.com/zhangj1164/dsh-mega-plugins` | Default repository URL for issue prefill when a request omits `repoUrl`. |

## Remote methods

| Method | Behavior |
|---|---|
| `generateReport(request)` | Calls the model with a built-in structuring prompt to produce a uniform GitHub issue report from telemetry failure analysis. Returns a `GithubIssueReport` with title, body, and labels. |
| `prefilledIssueUrl(request)` | Builds a pre-filled GitHub issue-creation URL from a report. Validates the repo URL; returns `invalid-url` on failure. |
| `optimizeIssue(request)` | Rewrites a natural-language description into a structured issue following a pinned Markdown template. Returns `empty-input` for blank descriptions, `llm-failure` when the model produces no output. |

## Issue report template

Both `generateReport` and `optimizeIssue` use built-in system prompts that pin a uniform Markdown structure. The first line is always a `## ` heading used as the issue title. The template includes sections for plugin, action, expected/actual behavior, and reproduction steps.

## Requirement mapping

- **Req 8** — `generateReport` turns telemetry failure analysis into a uniform GitHub issue report that correlates each failure group against the plugin's feature code.
- **Req 9** — `prefilledIssueUrl` builds a pre-filled GitHub issue-creation URL so the user can jump to the project's new-issue page with the report already filled in.
- **Req 10** — Packaged as a standalone DSH plugin: any developer can install the `dsh-github-issue` profile and wire it into their own UI plugin. The memo bundle's `cordis.patch.yml` inserts it as a plain dependency.
- **Req 11** — `optimizeIssue` rewrites a natural-language description into a structured issue using the configured model and a built-in structuring prompt. The `ui-memo` package calls this directly for its "Add Issue" editor.
- **Req 12** — Reusable: the issue report template, the prefill URL builder, and the optimization prompt are all generic and not memo-specific.

## Known Limitations

- **No bundle layer** — this package declares no `dsh.bundle`; it is installed as a plain dependency and activated by the memo bundle's `cordis.patch.yml`.
- **Model dependency** — `inject: ['llm']` means the service will not activate without an LLM provider.
