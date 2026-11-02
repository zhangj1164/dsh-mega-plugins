# @zhangj1164/dsh-github-issue

English | [中文](README.zh.md)

GitHub issue generation and optimization service for DeepSeek Harness. Builds structured issue reports from telemetry analysis, constructs pre-filled issue-creation URLs, optimizes natural-language issue descriptions with the configured model, and closes the intake loop: filing the report through the GitHub API, listing the issues that carry the claim label, and handing one to a fresh Session on the first startup of the local day.

## Plugin

`GithubIssueService extends TypertRemoteService` with `static inject = ['llm']`. The service uses `ctx.get('llm')` for model calls and exposes seven Remote methods callable by the client UI.

| Config | Default | Meaning |
|---|---|---|
| `repoUrl` | `https://github.com/zhangj1164/dsh-mega-plugins` | Default repository URL for issue prefill when a request omits `repoUrl`. |
| `maxPrefillUrlLength` | `7000` | Longest pre-filled issue URL to produce, counted in characters. GitHub refuses a request URL that is too long and shows an error page instead of the new-issue form, and it publishes no stable constant for the boundary, so this carries headroom and is deployment-tunable. `0` disables shortening. |
| `prefillTruncationNote` | a Chinese note | Appended to the issue body when the URL had to be shortened, so the reader knows the body is partial. |
| `provider` | unset | Provider route for model calls. Unset follows the deployment's `agentDefaultModel` selection, so a deployment can pin issue generation from `cordis.yml` alone. |
| `model` | unset | Model id for model calls. Unset follows the same fallback as `provider`. |
| `tokenEnv` | `GITHUB_TOKEN` | Environment variable read for the GitHub token when `token` is unset. An empty name disables the lookup. |
| `token` | unset | Explicit GitHub token. Set it when the deployment manages secrets itself; it wins over the environment and the command. |
| `tokenCommand` | `gh auth token` | Command whose standard output is the token, run once per process only when neither `token` nor `tokenEnv` supplies one. The default reuses the credential the `gh` CLI already stores; set it to an empty string to disable the lookup. |
| `tokenCommandTimeoutMs` | `10000` | Deadline for `tokenCommand`, in milliseconds. |
| `apiBaseUrl` | `https://api.github.com` | GitHub REST origin. An Enterprise deployment sets its own `https://host/api/v3`. |
| `requestTimeoutMs` | `15000` | Deadline for one GitHub REST request, in milliseconds. |
| `claimLabel` | `ready-for-agent` | Label that marks an issue claimable by the intake loop. The repository's triage vocabulary owns the value; this field only names which label counts. |
| `maxIssuesPerRun` | `3` | Largest number of issues one intake pass may dispatch. |
| `autopilotEnabled` | `false` | Whether the host checks for claimable issues on its first startup of the local day. Off by default: opening a Session without being asked is a deployment decision. |
| `autopilotCwd` | empty | Working directory the dispatched Sessions own. Empty follows the host's default directory. |
| `autopilotPreset` | empty | Agent preset the dispatched Sessions run. Empty follows the deployment default. |
| `autopilotTimeZone` | empty | IANA zone "today" is measured in. Empty follows the host's own zone, so the user's local midnight starts a new day. |
| `autopilotPrompt` | the built-in template | Prompt handed to every dispatched Session. Placeholders `{number}`, `{title}`, `{url}`, `{body}`, and `{labels}` are replaced; an unknown placeholder stays visible. |

## Remote methods

| Method | Behavior |
|---|---|
| `generateReport(request)` | Calls the model with a built-in structuring prompt to produce a uniform GitHub issue report from telemetry failure analysis. Returns a `GithubIssueReport` with title, body, and labels. The request names the `pluginIds` it covers — one report spans a whole suite — plus the analysis window and, per failure group, the route, the last failure time, and the attempts that followed it; the per-group facts are optional, and a missing one is passed to the model as `not recorded` rather than omitted. |
| `prefilledIssueUrl(request)` | Builds a pre-filled GitHub issue-creation URL from a report. Validates the repo URL; returns `invalid-url` on failure. Shortens the body when the composed URL would exceed `maxPrefillUrlLength`, which is a budget the title and labels also spend and percent-encoding inflates, so the check is on the URL rather than the body alone. |
| `optimizeIssue(request)` | Rewrites a natural-language description into a structured issue following a pinned Markdown template. Returns `empty-input` for blank descriptions, `route-missing` when no route resolves, `llm-failure` when the model call failed. |
| `createIssue(request)` | Files the report through the GitHub REST API and returns the created issue's `{ number, url }`. The body is filed without its leading `## title` heading, because GitHub takes the title as its own field. |
| `listClaimableIssues(request)` | Lists the open issues carrying the claim label, excluding pull requests, which GitHub's issue endpoints also return. |
| `dispatchIssue(request)` | Creates one Session through the Session controller, queues the rendered prompt on its Agent, names the Session, and returns its `sessionId`. |
| `runIntake(request)` | Runs one pass: lists the claimable issues, skips those an earlier pass already dispatched, dispatches the rest, and records the local day durably. |

The intake methods report one stable failure code instead of a raw `fetch` error: `auth-missing`, `auth-failure`, `rate-limited`, `invalid-repo`, `invalid-request`, `http-failure`, `network-failure`, `session-unavailable`, or `dispatch-failed`. `auth-missing` is separate from `auth-failure` because no credential and a rejected credential are different deployment problems with different fixes.

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
| A call with no resolvable route | Code `NO_MODEL_ROUTE` — the same code `@zhangj1164/dsh-memo` uses for that condition, so one report can group both packages |

`generateReport` also records which plugin's analysis it was given. Recording only successful calls would answer "which route served these calls" while leaving "has that route changed since it broke?" open, so both halves are recorded.

## Issue report template

Both `generateReport` and `optimizeIssue` use built-in system prompts that pin a uniform Markdown structure. The first line is always a `## ` heading used as the issue title. The template includes sections for plugin, action, expected/actual behavior, route and timing, and reproduction steps.

`generateReport` receives the analysis window and, per failure group, the route, the last failure time, and how many attempts of the same action followed it. Its system prompt requires those facts to be stated, forbids proposing a mechanism the analysis does not evidence — sampling parameters, token budgets, timeouts, chunking, and response parsing are named as examples — and requires a fact the analysis does not carry to be written as `not recorded`. Writing that collection must be added is explicitly ruled out: a missing fact can be an older event as easily as a gap, and the report cannot tell which.

## Issue intake loop

The loop has three steps, and this plugin owns the last two. The user describes a problem in natural language, `optimizeIssue` turns it into the pinned report, and `createIssue` files it. That replaces the point where the loop used to stop: a pre-filled URL still required the user to open the form and press Submit, so nothing could pick the issue up automatically.

`runIntake` then reads the issues that carry `claimLabel` and hands each one to a fresh Session. Dispatch goes through the Session controller rather than the Agent registry directly, so the dispatched Session gets the same preset and workspace policy as one the user opened in the Web; the prompt is queued with the Agent's `followup`, which wakes the driver without waiting for a turn to be open elsewhere. Naming the Session is best-effort: a deployment that mounts no title service still gets a working Session.

The credential is resolved once per process, in this order: `token`, then `tokenEnv`, then `tokenCommand`. The default command is `gh auth token`, so a machine already logged in to GitHub needs no extra secret; a deployment that manages secrets itself sets `token` and disables the command with an empty string. The token is never logged.

### First startup of the day

`autopilotEnabled` turns on one check per local day at host startup. The local day is read from durable storage-domain state, so a restart later the same day does nothing, and an issue that was already dispatched is never dispatched again — its Session exists, and a second one would duplicate the work. The day is committed only after the listing succeeded, so a pass that could not reach GitHub is retried on the next startup instead of being remembered as done.

The check needs durable state and refuses to run without it: without a memory of what it dispatched, a restart would open a second Session for the same issue. It is also off by default, because opening a Session without being asked is a deployment decision rather than something a plugin install does on its own.

```yaml
# your cordis.yml, or your own bundle's patch
- insert:
    - id: github-issue
      name: @zhangj1164/dsh-github-issue
      config:
        repoUrl: https://github.com/your-org/your-repo
        autopilotEnabled: true
        autopilotCwd: /path/to/your-repo
        claimLabel: ready-for-agent
```

The host must be running for the check to happen at all; a day with no startup is a day with no check. That is the intended behavior — the check is a startup hook, not a scheduler — and the Automation tasks page remains the place to inspect or manage reminders the Session itself creates.

## Requirement mapping

- **Req 8** — `generateReport` turns telemetry failure analysis into a uniform GitHub issue report that correlates each failure group against the plugin's feature code.
- **Req 9** — `prefilledIssueUrl` builds a pre-filled GitHub issue-creation URL so the user can jump to the project's new-issue page with the report already filled in.
- **Req 10** — Packaged as a standalone DSH plugin: this package declares its own `dsh.bundle` with `cordis.patch.yml`, so a deployment can install it on its own and any UI plugin can reach it. See "Adopting this plugin" below.
- **Req 11** — `optimizeIssue` rewrites a natural-language description into a structured issue using the configured model and a built-in structuring prompt. The `ui-memo` package calls this directly for its "Add Issue" editor.
- **Req 12** — Reusable: the issue report template, the prefill URL builder, and the optimization prompt are all generic and not memo-specific.
- **Req 13** — `createIssue` files the optimized report through the GitHub API, so "format the issue" and "file the issue" are one step instead of a form the user must submit.
- **Req 14** — `runIntake` and the first-startup check close the loop: a claimable issue becomes a Session without the user opening it by hand, and a dispatched issue is never dispatched twice.

## Adopting this plugin

Install the package and add it to your deployment's composition:

```sh
pnpm add @zhangj1164/dsh-github-issue
```

```yaml
# your cordis.yml, or your own bundle's patch
- insert:
    - id: github-issue
      name: @zhangj1164/dsh-github-issue
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

The service has no dependency on `@zhangj1164/dsh-memo`; memo is one consumer among possible others.

This bundle is the sole owner of the `github-issue` entry id. `@zhangj1164/dsh-memo` injects the service but does not insert this row, so the standalone bundle and the memo suite compose without a conflict and `pnpm run verify-bundle-entries` finds no overlap. A memo deployment therefore names the whole suite:

```sh
dsh plugin --profile web add @zhangj1164/dsh-telemetry @zhangj1164/dsh-github-issue @zhangj1164/dsh-memo @zhangj1164/dsh-client-ui-memo
```

`@zhangj1164/dsh-github-issue` is named explicitly rather than pulled in as a peer: a profile sets `autoInstallPeers: false`, so an install brings in only what the command names, and `@zhangj1164/dsh-memo` alone would leave this row unresolvable.

## Exports

Every subpath resolves to the flat `lib/*.js` layout tsdown emits.

| Subpath | Contents |
|---|---|
| `@zhangj1164/dsh-github-issue` | The `GithubIssueService` plugin and its Config. |
| `@zhangj1164/dsh-github-issue/types` | Wire types: `GithubIssueReport`, request and result shapes. |
| `@zhangj1164/dsh-github-issue/client` | The browser-facing type face. |
| `@zhangj1164/dsh-github-issue/invariant` | Invariant definitions. |

## Known Limitations

- **Model dependency** — `inject: ['llm']` means the service will not activate without an LLM provider.
- **No browser UI of its own** — this package registers no model tool and ships no browser UI. Installing it on its own gives a deployment `ctx.get('githubIssue')` and nothing a user can see or click; the visible entry point is `@zhangj1164/dsh-client-ui-memo`'s issue editor, whose "File on GitHub" button and log-analysis action reach it over Remote. Treat it as a backend that a UI plugin consumes, not as a standalone feature.
- **Dispatch needs the Web composition** — `dispatchIssue` and `runIntake` read `ctx.get('sessionController')` and `ctx.get('agents')`. A headless or SDK-only composition that mounts neither reports `session-unavailable` and files or lists issues only.
- **The first-startup check is a startup hook, not a scheduler** — it runs only when the host starts. A deployment that keeps the host running across midnight gets the check on the next start, not at midnight.
