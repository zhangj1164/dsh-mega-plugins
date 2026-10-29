# @zhangj1164/dsh-client-ui-memo-settings

English | [中文](README.zh.md)

A Settings page for the memo suite. It edits the memo Host's configuration through the deployment's own settings surface, so the AI route, the archived-session summary copy, and the GitHub repository can be changed from DSH Web and take effect without a restart.

## Plugin

A pure UI surface plugin: the host `apply` is empty so the plugin appears in the host `cordis.yml` / Loader; the browser half ships via `exports["./client"]`, discovered through the `dsh.client` declaration in `package.json`.

The page is one `settings.section` entry: the Settings shell renders it in the content column and builds its navigation row from the registration's own `id`, `order`, and `label`. It registers only while the Host serves the `memo` settings namespace (`ctx.configForms.whileServed`), so a deployment without the memo plugin shows no trace of this package — no empty page and no stray navigation row.

The page owns no memo value. It stages a draft over the Host form and commits field by field through `ctx.configForms`, whose writes carry the namespace revision from the snapshot; a refused write stops the run and leaves the remaining drafts staged. The memo Host declares every `Config` field `.volatile()`, so an accepted write reaches the running service in place — `cordis-plugin-loader` refreshes the volatile references instead of remounting the plugin.

## Fields

| Field | Control | Default | Bounds |
|---|---|---|---|
| `provider` | text | deployment default | — |
| `model` | text | deployment default | — |
| `sessionSummaryLanguage` | picker: 自动 / 中文 / 英文 | `auto` | — |
| `sessionSummaryMaxSessions` | number | `5` | 1–20 |
| `sessionSummaryTranscriptMaxChars` | number | `24000` | 1000–200000 |
| `sessionSummaryMaxChars` | number | `300` | 100–4000 |
| `sessionSummarySourceTemplate` | multiline | `来源会话：{sessionId}` | — |
| `sessionSummaryPrompt` | multiline | the Host's built-in prompt | — |
| `repoUrl` | text | `https://github.com/zhangj1164/dsh-mega-plugins` | — |

Four groups in the order the page renders them: AI 分析 (`provider`, `model`), 归档会话总结 (language, session cap, transcript budget, summary length), 总结文案 (source template, prompt), GitHub (`repoUrl`).

**Blank means unset.** An empty `provider` or `model` is saved as an unset, which restores the documented precedence: the request carries no route and the Host resolves the deployment's default. Every other field's blank is also a reset to the default value rather than an empty string.

**Overridden and reset.** A field is marked 已覆盖 when the Host document's user layer carries it, which is read from the snapshot's own `user` rather than inferred from a value comparison; only then does the row offer 恢复默认, and that stages an unset. Nothing is written until 保存.

**Bounds are a convenience, not the rule.** The Host validates every write and refuses an out-of-range value; the page mirrors the schema's numbers so a bad entry is caught before a round trip, and shows 超出允许范围 while the save button stays disabled.

Not on this page: `storageWriteRetries`, `storageWriteRetryDelayMs` and `logAnalysisPlugins` are deployment-level knobs that belong in `cordis.yml`, and `sessionSummaryMaxCharsLimit` bounds another surface's length control rather than this page's value.

## Bundle layer

This package declares `dsh.bundle` with its own `cordis.patch.yml`, which inserts one row, `ui-memo-settings`. Installed without `@zhangj1164/dsh-memo`, the module loads and registers nothing, because the `memo` namespace is never served.

Install the suite by naming every package, since a profile installs only what is on the command line:

```sh
dsh plugin --profile web add @zhangj1164/dsh-telemetry @zhangj1164/dsh-github-issue @zhangj1164/dsh-memo @zhangj1164/dsh-client-ui-memo @zhangj1164/dsh-client-ui-memo-settings
```

## Tests

`tests/form.spec.ts` drives the draft model against a stand-in Host form: staging without writing, save-only-the-edited-field, blank saving as an unset, a refusal that keeps the draft, the read-only and unavailable states, the four bounds, and the reconciliation that drops a draft once the Host agrees with it. `tests/MemoSettingsSection.spec.tsx` renders the page in jsdom over the real model and exercises every control, including the overridden badge and its reset, the invalid-number alert, and the discard path. `tests/entry.spec.tsx` applies the real browser half against a stand-in client context: the declared services, the single `settings.section` registration and its nav identity, the gate on the served namespace, the dictionaries, the injected store and actions, and the style disposal.

## Known limitations

- **Subset by design** — the page covers the fields a user of the board would change. The deployment knobs listed above stay in `cordis.yml`, where a mistaken edit cannot reach every browser.
- **Bounds are duplicated** — the browser restates the memo schema's ranges because the client cannot read the schema, and the Host remains the authority; a schema change must update both.
