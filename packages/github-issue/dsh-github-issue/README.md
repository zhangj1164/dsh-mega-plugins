# dsh-github-issue

English | [中文](README.zh.md)

GitHub issue generation and optimization service for DeepSeek Harness. Builds structured issue reports from telemetry analysis, constructs pre-filled issue-creation URLs, and optimizes natural-language issue descriptions with the configured model.

## Plugin

`GithubIssueService extends TypertRemoteService` with `static inject = ['llm']`. The service uses `ctx.get('llm')` for model calls and exposes three Remote methods callable by the client UI.

| Config | Default | Meaning |
|---|---|---|
| `repoUrl` | `https://github.com/zhangj1164/dsh-mega-plugins` | Default repository URL for issue prefill when a request omits `repoUrl`. |
| `maxPrefillUrlLength` | `7000` | Longest pre-filled issue URL to produce, counted in characters. GitHub refuses a request URL that is too long and shows an error page instead of the new-issue form, and it publishes no stable constant for the boundary, so this carries headroom and is deployment-tunable. `0` disables shortening. |
| `prefillTruncationNote` | a Chinese note | Appended to the issue body when the URL had to be shortened, so the reader knows the body is partial. |
| `provider` | unset | Provider route for model calls. Unset follows the deployment's `agentDefaultModel` selection, so a deployment can pin issue generation from `cordis.yml` alone. |
| `model` | unset | Model id for model calls. Unset follows the same fallback as `provider`. |

## Remote methods

| Method | Behavior |
|---|---|
| `generateReport(request)` | Calls the model with a built-in structuring prompt to produce a uniform GitHub issue report from telemetry failure analysis. Returns a `GithubIssueReport` with title, body, and labels. The request carries the analysis window and, per failure group, the route, the last failure time, and the attempts that followed it; all of them are optional, and a missing one is passed to the model as `not recorded` rather than omitted. |
| `prefilledIssueUrl(request)` | Builds a pre-filled GitHub issue-creation URL from a report. Validates the repo URL; returns `invalid-url` on failure. Shortens the body when the composed URL would exceed `maxPrefillUrlLength`, which is a budget the title and labels also spend and percent-encoding inflates, so the check is on the URL rather than the body alone. |
| `optimizeIssue(request)` | Rewrites a natural-language description into a structured issue following a pinned Markdown template. Returns `empty-input` for blank descriptions, `route-missing` when no route resolves, `llm-failure` when the model call failed. |

## Model route

Both model-calling methods resolve their route the way the memo service does: the request's `provider`/`model`, then this service's `Config`, then the deployment's `agentDefaultModel` selection. The request fields are therefore optional, and the client UI sends them only when the user picked a model — the browser never has to publish a route for a call to work.

A blank value counts as absent rather than as a value, so an omitted field still reaches the deployment default instead of travelling to the model as an unusable route. When nothing resolves a route, the call returns `route-missing` and **no model call is attempted**: a call without an adapter cannot succeed, and reporting it as `llm-failure` would name the model for a routing problem.

## Failure facts

A failed call keeps what DSH reported instead of collapsing it into one message. `llm-failure` carries the machine-routing code and the route in its message — `model call to provider "custom" model "glm-5-2-260617" failed: NO_ADAPTER: no adapter registered for provider "custom"` — so `NO_ADAPTER` (a route this deployment never registered), `AUTH`, `RATE_LIMIT`, and `EMPTY_RESPONSE` (the model genuinely returned no text) stay distinguishable. Reporting all of them as "the model produced no output" is what sent a user hunting for a model problem in a request that never reached a model.

A stream that throws a transport error rather than yielding a terminal `finish` chunk becomes `LLM_STREAM_THREW`, not an exception escaping the call.

## Telemetry

Both model-calling methods report to the local telemetry service when the deployment has one, and behave identically when it does not. The service is read with `ctx.get('telemetry')` and deliberately **not** declared in `static inject`: this package installs on its own bundle, and a diagnostic dependency must never be the reason a service refuses to activate.

| Event | Recorded |
|---|---|
| A call that worked | Action `optimizeIssue` / `generateReport` as `success`, with the route that served it |
| A failed call | The preserved DSH code, message, and HTTP status, the route, and the `github-issue:<action>` feature anchor |
| A call with no resolvable route | Code `NO_MODEL_ROUTE` — the same code `dsh-memo` uses for that condition, so one report can group both packages |

`generateReport` also records which plugin's analysis it was given. Recording only successful calls would answer "which route served these calls" while leaving "has that route changed since it broke?" open, so both halves are recorded.

## Issue report template

Both `generateReport` and `optimizeIssue` use built-in system prompts that pin a uniform Markdown structure. The first line is always a `## ` heading used as the issue title. The template includes sections for plugin, action, expected/actual behavior, route and timing, and reproduction steps.

`generateReport` receives the analysis window and, per failure group, the route, the last failure time, and how many attempts of the same action followed it. Its system prompt requires those facts to be stated, forbids proposing a mechanism the analysis does not evidence — sampling parameters, token budgets, timeouts, chunking, and response parsing are named as examples — and requires a fact the analysis does not carry to be written as `not recorded`. Writing that collection must be added is explicitly ruled out: a missing fact can be an older event as easily as a gap, and the report cannot tell which.

## Requirement mapping

- **Req 8** — `generateReport` turns telemetry failure analysis into a uniform GitHub issue report that correlates each failure group against the plugin's feature code.
- **Req 9** — `prefilledIssueUrl` builds a pre-filled GitHub issue-creation URL so the user can jump to the project's new-issue page with the report already filled in.
- **Req 10** — Packaged as a standalone DSH plugin: this package declares its own `dsh.bundle` with `cordis.patch.yml`, so a deployment can install it on its own and any UI plugin can reach it. See "Adopting this plugin" below.
- **Req 11** — `optimizeIssue` rewrites a natural-language description into a structured issue using the configured model and a built-in structuring prompt. The `ui-memo` package calls this directly for its "Add Issue" editor.
- **Req 12** — Reusable: the issue report template, the prefill URL builder, and the optimization prompt are all generic and not memo-specific.

## Adopting this plugin

Install the package and add it to your deployment's composition:

```sh
pnpm add dsh-github-issue
```

```yaml
# your cordis.yml, or your own bundle's patch
- insert:
    - id: github-issue
      name: dsh-github-issue
      config:
        repoUrl: https://github.com/your-org/your-repo
```

Read the service from any plugin with `ctx.get('githubIssue')`. It is optional from the consumer's side, so guard the read:

```ts
const issues = ctx.get('githubIssue')
if (issues !== undefined) {
  const { report } = await issues.generateReport({ analysis, repoUrl })
}
```

The service has no dependency on `dsh-memo`; memo is one consumer among possible others.

Do not enable both the `dsh-github-issue` bundle and the `dsh-memo` bundle: each inserts an entry with the id `github-issue`, and the loader rejects a duplicate entry id. The memo bundle already inserts this service, so a memo deployment needs no extra step. Both patch files carry the marker `not both` on that id, and the repository's `verify-bundle-entries` gate requires it: an entry id inserted by more than one workspace bundle fails unless every such patch records the exclusion.

## Exports

Every subpath resolves to the flat `lib/*.js` layout tsdown emits.

| Subpath | Contents |
|---|---|
| `dsh-github-issue` | The `GithubIssueService` plugin and its Config. |
| `dsh-github-issue/types` | Wire types: `GithubIssueReport`, request and result shapes. |
| `dsh-github-issue/client` | The browser-facing type face. |
| `dsh-github-issue/invariant` | Invariant definitions. |

## Known Limitations

- **Model dependency** — `inject: ['llm']` means the service will not activate without an LLM provider.
