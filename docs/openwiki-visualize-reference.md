# OpenWiki `visualize` — Authoritative Reference

**Date:** 2026-10-16
**Purpose:** Reference for the planned DSH Web plugin `dsh-openwiki-visualize`, which previews an openwiki site by hosting the `openwiki visualize` local server (or a static export) inside the DSH Web GUI.
**Scope of evidence:** every statement below is either (a) read from the locally installed `openwiki@0.7.2` package source, (b) captured from real CLI output, or (c) read from the upstream README via the GitHub API. Unconfirmed items are confined to [Unverified / Assumptions](#unverified--assumptions).

---

## Sources

Every source actually consulted, with what it yielded.

| # | Source | How accessed | What it yielded |
| - | ------ | ------------ | --------------- |
| 1 | Installed `openwiki` package | `Get-Command openwiki` → `C:\Program Files\nodejs\openwiki.ps1`; resolved install root `D:\ProgramFiles\nvm\v24.19.0\node_modules\openwiki` | Confirms a global install exists and its real on-disk path (the `C:\Program Files\nodejs` entry is the nvm shim). |
| 2 | `openwiki` → `package.json` | read | Version **0.7.2**, MIT, `"type": "module"`, `engines.node >= 22.22.0`, `bin.openwiki = ./dist/cli/cli.js`, repository/homepage `github.com/langchain-ai/openwiki`, **no `exports` field** (no Node API), peer deps `jsdom`/`mermaid` both optional. |
| 3 | `openwiki --help` | run | Full command/option reference (pasted below). Confirms `visualize` usage line and the three documented `visualize` flags. Banner shows `openwiki v0.7.2`. |
| 4 | `openwiki visualize --help` | run | `Unknown option for visualize: --help` on stderr, exit 1. **`visualize` has no `--help`.** |
| 5 | `openwiki --version` | run | `Unknown option: --version`, exit 1. Version must come from the help banner or `package.json`. |
| 6 | `dist/cli/commands.js` (lines 152–238) | read | The exact `visualize` argument parser: defaults, accepted flags, `--flag=value` forms, validation, and the `--export` × `--port`/`--no-open` conflict. |
| 7 | `dist/cli/runners.js` (`runVisualizeCommand`, lines 37–58) | read | Path resolution: `wikiRoot = path.resolve(process.cwd(), command.wikiDir)`; export output dir likewise resolved from cwd. |
| 8 | `dist/visualize/server.js` (203 lines) | read | Host/port/loopback, 20 port attempts, 150 ms debounce, recursive `fs.watch`, fixed route table, banner text, SIGINT lifecycle, browser launch. |
| 9 | `dist/visualize/page.js` (100 lines) | read | The `CSP` constant, the served HTML, CDN libraries + SRI hashes, and that the CSP is an HTTP header live but a `<meta>` tag only in static export. |
| 10 | `dist/visualize/graph.js` (196 lines) | read | Wiki scanning rules, frontmatter subset parsed, node/edge model, and the graph JSON shape. |
| 11 | `dist/visualize/static-export.js` (32 lines) | read | The exact static export file set and that the static client reads `./graph.json` and opens no SSE connection. |
| 12 | `dist/visualize/` directory listing | `Get-ChildItem` | `client.js` (22,696 B), `client-lib.js`, `styles.css` (13,264 B), `graph.js`, `page.js`, `server.js`, `static-export.js`, plus `.d.ts` files. |
| 13 | `dist/agent/prompts/code.js`, `personal.js` | grep | The generated wiki layout the agent is instructed to produce: `/openwiki/quickstart.md`, `/openwiki/INSTRUCTIONS.md`, generated directory `index.md`, reserved `log.md`, `/.last-update.json`, OKF `okf_version: "0.2"`. |
| 14 | Upstream README `langchain-ai/openwiki` | `https://api.github.com/repos/langchain-ai/openwiki/readme` (base64-decoded) | Official project description, `visualize` documentation, static-export file list, CDN/internet requirement, on-disk format, OKF v0.2, modes, `.openwikiignore`, env vars. |
| 15 | Upstream README (installed copy) | `Get-Content <pkg>\README.md` | Byte-for-byte the same document as #14; confirms the shipped README matches `main`. |
| 16 | GitHub repo metadata `langchain-ai/openwiki` | `https://api.github.com/repos/langchain-ai/openwiki` | `default_branch: main`, description, ~17.2k stars. |
| 17 | GitHub repo metadata `D2Moqi/dsh-openwiki` | `https://api.github.com/repos/D2Moqi/dsh-openwiki` | **A different project**: an existing DSH plugin that embeds openwiki (MIT, `master`). Not openwiki itself. |
| 18 | `D2Moqi/dsh-openwiki` README | `https://api.github.com/repos/D2Moqi/dsh-openwiki/readme` (base64-decoded) | Sibling-plugin design: Host half drives `openwiki --init\|--update -p -l <lang>` and reads the wiki from disk; it ships its **own** Markdown renderer and **does not use `openwiki visualize`**. Useful prior art and a disk-contract reference. |
| 19 | npm registry | `https://registry.npmjs.org/openwiki` + `/openwiki/0.7.2` | `dist-tags.latest = 0.7.2`; published versions run `0.0.0 … 0.7.2` (30 versions). Tarball URL confirmed. |
| 20 | `~/.openwiki` state dir | `Get-ChildItem` | `connectors/`, `wiki/`, `skills/`, `mcp-server(s)/`, `conversation_history/`, `.env`, `install-id`, `INSTRUCTIONS.md`, `onboarding.json`, `openwiki.sqlite`. |
| 21 | Workspace scan | glob/watch | **No** openwiki project exists under `E:\Projects\mpass\dsh-mega-plugins` (no `openwiki/` dir, no `.openwikiignore`). The plugin must therefore detect, not assume, a wiki. |

> [!NOTE]
> `$env:USERPROFILE\.chatcode-cli\openwiki-boot.json` also exists (`ts: 2026-10-16T02:52:17.999Z`, `routeResult: "registered"`). That is a **DSH-side** artifact written by an earlier plugin boot attempt — it is not produced by openwiki, and it is not evidence about openwiki's own behavior.

### Raw `openwiki --help` (key excerpts)

The full option list, verbatim:

```
# Usage
   openwiki [--init|--update] [message]
   openwiki code [--init|--update] [message]
   openwiki personal [--init|--update] [message]
   openwiki visualize [path] [--port <port>] [--no-open] [--export <dir>]
   openwiki link [directory]
   openwiki workspace use <workspace>
   openwiki auth <provider>
   openwiki ingest <source|source-instance|all> [--scheduled] [--print] [--modelId <id>]
   openwiki cron list|pause all|resume all|delete all
   openwiki ngrok start [url] [--port <port>]
   openwiki integrations list|install|uninstall <host> [--project [path]]

# Options
   --init                   Generate repository documentation from scratch ...
   --update                 Update existing OpenWiki documentation ...
   --mode <personal|code>   Choose the personal brain or the code brain ...
   -l, --language <locale>  Generate wiki documentation in the given BCP-47 locale ...
   -p, --print              Run once and print the final assistant output.
   --debug                  Show full credential and error diagnostics ...
   --modelId <id>           Use a model ID for this run.
   --scheduled              For ingest only ...
   --telemetry-file <path>  Write the exact anonymous telemetry payload to a local JSON file.
   --port <port>            For visualize: port to serve on (default 4321; increments on conflict).
   --no-open                For visualize: do not open the browser automatically.
   --export <dir>           For visualize: write a static visualizer directory instead of starting the local server.
```

Banner from the same run:

```
│ >_ OpenWiki v0.7.2 agent docs for codebases    │
│ provider: OpenAI                               │
│ model: gpt-5.6-terra                           │
```

> [!IMPORTANT]
> `openwiki --help` and `openwiki init --help` both print the **global** help and then exit non-zero in a non-TTY shell, because the Ink TUI fails with `Raw mode is not supported on the current process.stdin`. Any wrapper that shells out to `openwiki --help` must tolerate that stderr noise and a non-zero exit while still scraping stdout. (This is exactly the probe the sibling plugin implements — see source #18.)

---

## 1. Overview and the exact verified version

OpenWiki is a LangChain (Deep Agents) CLI that generates and maintains a linked Markdown wiki for a codebase (or, in `personal` mode, for connector sources), emitting [Google Open Knowledge Format (OKF) v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) bundles. `openwiki visualize` serves an interactive node graph beside a live Markdown reader, or exports it as a static directory.

| Field | Value |
| ----- | ----- |
| Package name | `openwiki` |
| **Verified version** | **0.7.2** |
| How verified | `package.json` (`version: "0.7.2"`) **and** the live `openwiki --help` banner (`OpenWiki v0.7.2`) **and** npm `dist-tags.latest` |
| Is it the latest published? | **Yes** — npm lists `0.0.0 … 0.7.2`; 0.7.2 is the newest version that exists |
| License | MIT |
| Upstream repo | `https://github.com/langchain-ai/openwiki` |
| Runtime | Node.js **>= 22.22.0** (`engines.node`) |
| Module system | ESM (`"type": "module"`) |
| Entry point | `dist/cli/cli.js` (the only `bin`) |
| Native dependency note | Windows installs must use `npm`/`pnpm`, not `bun` (bun may trigger a `better-sqlite3` native build). |

> [!WARNING]
> **The stated dependency requirement `openwiki > 0.7.2` cannot currently be satisfied.** 0.7.2 is the latest published version, so a range like `>0.7.2` resolves to nothing and `^0.7.2`/`>=0.7.2` is the only installable constraint today. See [Unverified / Assumptions](#unverified--assumptions) for the decision this forces on the plugin.

---

## 2. Every `openwiki` CLI command

From the global help (#3) and the README command reference (#14).

| Command | What it does |
| ------- | ------------ |
| `openwiki` | Interactive chat; code mode over the current repository. |
| `openwiki code` | Explicit code mode (same as bare). |
| `openwiki personal` | Interactive chat against configured sources; personal brain. |
| `openwiki [--init]` | Generate repository docs from scratch into `openwiki/` (preserves `openwiki/INSTRUCTIONS.md`). |
| `openwiki [--update]` | Incremental update of existing docs. |
| `openwiki --mode <personal\|code>` | Force the brain mode. |
| `openwiki [--language <locale>]` / `-l` | Generate docs in a BCP-47 locale. |
| `openwiki -p, --print [message]` | One-shot, non-interactive run that prints the final output. |
| `openwiki --modelId <id>` | Override the model for one run. |
| `openwiki link [directory]` | Create/manage named workspaces of related repository wikis. |
| `openwiki workspace use <name>` / `current` / `clear` | Set/inspect/clear the active workspace. |
| `openwiki auth <provider>` | Authenticate a connector; discover MCP tools. |
| `openwiki auth configure <provider> [--force]` | Create local connector config referencing saved env vars. |
| `openwiki auth tools <provider>` | List MCP tools for a configured provider. |
| `openwiki ingest <source\|source-instance\|all> [--scheduled] [--print] [--modelId <id>]` | Run ingestion + wiki update for one connector or all. |
| `openwiki cron list` / `pause all` / `resume all` / `delete all` | Manage connector schedules. |
| `openwiki ngrok start [url] [--port <port>]` | Start an ngrok tunnel for Slack OAuth. |
| **`openwiki visualize [path] [--port <port>] [--no-open] [--export <dir>]`** | **Serve the live graph+reader, or export a static site.** (Section 3.) |
| `openwiki integrations list [--project [path]]` | Show installation status. |
| `openwiki integrations install <bob\|codex\|claude\|opencode\|cursor\|kiro\|omp\|antigravity\|copilot> [--force] [--project [path]]` | Install the OpenWiki skill + MCP config. |
| `openwiki integrations uninstall <host> [--project [path]]` | Remove an integration. |
| `openwiki --help` | Full help (see the non-TTY caveat above). |

Global options available across run commands: `--init`, `--update`, `--mode`, `-l/--language`, `-p/--print`, `--debug`, `--modelId`, `--scheduled` (ingest only), `--telemetry-file <path>`.

---

## 3. `openwiki visualize` — full parameter list

Parsed from `dist/cli/commands.js` (#6), which is the authoritative source; the help text (#3) and README (#14) agree.

### 3.1 Flags

| Flag / arg | Type | Default | Meaning | Notes |
| ---------- | ---- | ------- | ------- | ----- |
| `[path]` (positional) | string | **`openwiki`** | Directory of the wiki to visualize. | Resolved as `path.resolve(process.cwd(), path)` (#7). Only **one** positional is accepted; a second errors. Leading `-` args are never positional. |
| `--port <port>` | integer | **4321** | Preferred TCP port to serve on. | Accepts both `--port 4400` and `--port=4400`. Validated `1024 ≤ port ≤ 65535` and must be an integer, else `--port must be between 1024 and 65535.` (exit 1). On `EADDRINUSE` the server increments the port (see §4). |
| `--no-open` | boolean flag | *absent* (i.e. browser **is** opened) | Do not launch the default browser. | Sets internal `open = false`. |
| `--export <dir>` | string | *none* | Write a static visualizer directory instead of starting a server, then exit. | Accepts `--export docs/out` and `--export=docs/out`. Resolved from cwd. |
| `--help` / `-h` | — | — | **Not supported.** | `Unknown option for visualize: --help`, exit 1. |
| any unknown `-…` | — | — | Error. | `Unknown option for visualize: <arg>`, exit 1. |

### 3.2 Rules and validation (exact)

- **Mutual exclusion:** `--export` **cannot** be combined with `--port` or `--no-open` → `--export cannot be combined with --port or --no-open.` (exit 1). Tracked via `sawPort` / `sawNoOpen`.
- `--port` with a missing value or a value starting with `-` → `--port requires a value.`
- `--export` with a missing value or a value starting with `-` → `--export requires a directory.`
- `--export=` (empty) → `--export requires a directory.`
- No `single-dash` short forms exist for `visualize` (unlike the global `-p`, `-l`).

### 3.3 Parsed result object

`commands.js` returns `{ kind: "visualize", exitCode: 0, wikiDir, port, open, exportDir }`, which `runners.js` maps to `runVisualizeServer({ wikiRoot, port, open })` or `exportStaticVisualizer({ wikiRoot, outputDir })`.

### 3.4 Examples (from help + README)

```sh
openwiki visualize                                             # ./openwiki on 127.0.0.1:4321, opens browser
openwiki visualize openwiki --port 4400 --no-open              # explicit dir + port, no browser
openwiki visualize openwiki --export docs/openwiki-visualizer  # static output
openwiki visualize --export docs/openwiki-visualizer           # static output (path defaults to ./openwiki)
```

### 3.5 Static export file set (exact)

`exportStaticVisualizer` writes exactly these files into `--export <dir>` (mkdir `recursive: true`):

| File | Content |
| ---- | ------- |
| `index.html` | The **static** page (`STATIC_PAGE`, `data-static-export="true"`, CSP embedded as a `<meta>` tag, relative asset URLs). |
| `client.js` | Browser client bundle (copied verbatim from the package). |
| `client-lib.js` | Browser libraries bundle. |
| `styles.css` | Stylesheet. |
| `graph.json` | The full graph, `JSON.stringify(graph, null, 2)` + trailing newline. |

The static client reads the sibling `./graph.json` and **never opens an SSE connection**, so it is hostable anywhere. Console output on success:
`Exported static visualizer to <dir> (<n> pages, <m> links).`

---

## 4. Local server behavior

All from `dist/visualize/server.js` (#8) unless noted.

| Property | Value | Evidence |
| -------- | ----- | -------- |
| Transport | **Plain HTTP** (`node:http` `createServer`). Not HTTPS. | `server.js:1` |
| Live-reload transport | **Server-Sent Events (SSE)**, *not* WebSocket. `GET /events` → `text/event-stream`, sends `retry: 2000`, and on each rebuild `event: reload\ndata: 1\n\n`. | `server.js:38-41,117-127` |
| Default host | **`127.0.0.1`**, hard-coded (`const HOST = "127.0.0.1"`), loopback only — never exposed on the network. | `server.js:8` |
| Host configurability | **None.** There is no `--host` flag and no env override found; the binding host is a constant. | `commands.js`, `server.js` |
| Default port | **4321** | `commands.js:154` |
| Port when busy | On `EADDRINUSE`, retries `port+1`, `port+2`, … up to **`PORT_ATTEMPTS = 20`** attempts, then `Failed to start server: …` and `process.exit(1)`. | `server.js:9,151-166` |
| Preview URL | `http://127.0.0.1:<boundPort>` — printed by the banner and passed to the browser opener. | `server.js:67` |
| Browser launch | Unless `--no-open`: `cmd /c start "" <url>` (win32), `open` (darwin), `xdg-open` (linux). The URL is a separate argv element, never shell-interpolated. | `server.js:185-192` |
| Startup banner | `OpenWiki visualizer` / `wiki:  <wikiRoot>` / `open:  http://127.0.0.1:<port>` / `live:  editing pages under the wiki refreshes the browser` / `Ctrl-C to stop.` | `server.js:196-202` |
| Hot reload | Yes. Rebuild on change: `fs.watch(wikiRoot, { recursive: true })` debounced **150 ms** (`WATCH_DEBOUNCE_MS`), rebuilds the graph, prints `↻ change detected: N pages, M links`, and broadcasts SSE `reload` to all clients. If recursive watch is unsupported it prints `(live watch unavailable on this platform)` and continues. | `server.js:10,170-181` |
| Shutdown | `SIGINT` → prints `stopped.`, `server.close()`, promise resolves (process exits). | `server.js:62-65` |
| Missing wiki dir | Fails fast: `Wiki directory not found: <path>. Run \`openwiki --init\` first, or pass a path.` (also for a non-directory). | `server.js:137-147` |

### 4.1 Route table (fixed)

Routing is locked to exact string matches; **no filesystem path is ever derived from `req.url`**.

| Route | Method | Response |
| ----- | ------ | -------- |
| `/` and `/index.html` | GET | `200 text/html; charset=utf-8` + **`content-security-policy` header** + the live page. |
| `/client.js` | GET | `200 text/javascript; charset=utf-8` |
| `/client-lib.js` | GET | `200 text/javascript; charset=utf-8` |
| `/styles.css` | GET | `200 text/css; charset=utf-8` |
| `/api/graph` | GET | `200 application/json; charset=utf-8` — the current graph JSON. |
| `/events` | GET | `200 text/event-stream`, `cache-control: no-cache`, `connection: keep-alive`, SSE reload channel. |
| everything else | any | `404 text/plain` — `Not found`. |

> [!IMPORTANT]
> **There is no base path and no query-string tolerance.** The match is `url === "/"` (not `startsWith`), so:
> - the visualizer can only be served at the **root of its own origin**, and
> - a request to `/?anything` or `/index.html?x=1` returns **404**.
>
> A host plugin therefore cannot proxy this under a DSH sub-path (e.g. `/openwiki/preview/`) by URL rewriting alone; it must give the server its own origin (direct `http://127.0.0.1:<port>/` in an iframe) or proxy while stripping the query and rewriting to `/`.

### 4.2 Graph JSON shape (`/api/graph`, and `graph.json` in exports)

```jsonc
{
  "root": "<basename of wiki dir>",
  "generatedAt": "<ISO 8601>",
  "types": ["<sorted unique node types>"],
  "nodes": [{
    "id": "architecture/overview",   // path relative to wiki root, forward slashes, no .md
    "title": "…",
    "type": "…",                     // frontmatter `type`, else "Section" for index.md, else "Reference"
    "description": "…",
    "tags": ["…"],
    "body": "<markdown body without frontmatter>",
    "size": 1234,                    // body.length
    "links": ["<target id>"],
    "backlinks": ["<source id>"]
  }],
  "edges": [{ "source": "<id>", "target": "<id>" }]
}
```

---

## 5. On-disk openwiki project format (for "does this workspace have an openwiki?")

### 5.1 Code mode (repository wiki) — generated in the repo

`openwiki --init` (or a coding-agent integration) writes into **`openwiki/` at the repository root**:

| Path | Kind | Notes |
| ---- | ---- | ----- |
| `openwiki/` | directory | The wiki root; the default `visualize` target. |
| `openwiki/quickstart.md` | Markdown | The entrypoint page; links to every major section. |
| `openwiki/index.md` | Markdown | **Reserved** OKF document; deterministic per-directory index. The bundle-root index carries `okf_version: "0.2"`. Reserved docs get **no concept front matter**. |
| `openwiki/log.md` | Markdown | **Reserved** OKF document (excluded by the visualizer). |
| `openwiki/INSTRUCTIONS.md` | Markdown | User-authored brief. **Never rewritten** by normal runs; preserved across `--init`. Excluded from the graph. |
| `openwiki/**/*.md` | Markdown | Concept pages (nested subdirectories allowed, e.g. `architecture/overview.md`). |
| `openwiki/.claims/*.json` | JSON sidecars | Versioned Grounded Claims (source evidence per page, e.g. `repo://src/server.ts#L40-L82`). |
| `openwiki/.page-manifest.json` | JSON | Per-page manifest (durable page records). |
| `openwiki/.run.json` | JSON | In-progress run state / resume queue; **deleted on successful finalization**. |
| `openwiki/.last-update.json` | JSON | Last successful run metadata (incl. `gitHead`), refreshed even on no-op runs. |
| `openwiki/.langsmith.json` | JSON | Optional; only when the LangSmith connector is configured. Names workspaces/projects, never the key. |
| `AGENTS.md` (repo root) | Markdown | OpenWiki manages only its `<!-- OPENWIKI:START -->…<!-- OPENWIKI:END -->` block. |
| `CLAUDE.md` (repo root) | Markdown | Refreshed **only** if it already exists. |
| `.openwikiignore` (repo root) | gitignore syntax | Read boundary for generation (not for `visualize`). |

**Detection signal for a host plugin:** a directory named `openwiki/` containing at least one `.md` file. Stronger, unambiguous markers, in order of confidence:

1. `openwiki/.page-manifest.json` present → definitely a generated code wiki.
2. `openwiki/quickstart.md` or `openwiki/index.md` present.
3. Any `*.md` under `openwiki/` (the visualizer's own acceptance test is exactly "directory exists", and it tolerates an empty result).

> The sibling plugin `D2Moqi/dsh-openwiki` treats `openwiki/` under the workspace root as the contract and notes that `.page-manifest.json` can be **missing** in edge cases (init interrupted before finalize), which is why it always keeps a recursive disk-scan fallback. A detector should not require the manifest.

### 5.2 Personal mode

Personal-mode wikis live under the local state dir, not the repo:

| Path | Notes |
| ---- | ----- |
| `~/.openwiki/wiki/` (or `$OPENWIKI_CONFIG_DIR/wiki`) | Personal wiki root. |
| `~/.openwiki/` | Credentials, connector data, skills, history, `install-id`, `openwiki.sqlite`. `OPENWIKI_CONFIG_DIR` relocates the whole state dir. |
| `~/.openwiki/connectors/<connector>/raw/` | Raw connector payloads + manifests. |

The sibling plugin additionally supports a third convention, `openwiki-kb/wiki` inside a project, by injecting `OPENWIKI_CONFIG_DIR` — that is a plugin convention, **not** an openwiki-native path.

### 5.3 Page frontmatter (OKF v0.2) — what the visualizer reads

`graph.js` parses only a **small subset** of YAML frontmatter, so a host plugin must not assume a full YAML parser:

- Only files that **start with `---`** are treated as having frontmatter; otherwise the whole file is the body.
- Supported: `key: value` scalars, inline arrays `key: [a, b]`, and dashed lists (`key:` followed by `- item` lines).
- Quotes around values are stripped (one pair).
- **Known fields consumed:** `type`, `title`, `description`, `tags`. Others are ignored (but preserved in the raw text).
- Frontmatter is fully **stripped from `body`** in the graph JSON.

Title/type fallbacks: `title` → (for `index.md`) the capitalized section dir name (`Home` at root) → first `# H1` → filename. `type` → frontmatter `type`, else `Section` for `index.md`, else `Reference`.

### 5.4 Scanning rules (what does and does not become a node)

- Recursive over the wiki root; a resolved path must stay **within** `wikiRoot`, and symlink dirents are neither `isDirectory()` nor `isFile()` so they are never followed.
- Only files ending `.md` are collected.
- **Excluded:** `INSTRUCTIONS.md` and `log.md` (by exact basename, at any depth).
- Node id = path relative to the wiki root, `\` → `/`, trailing `.md` removed.
- Edges come from **relative** Markdown links matching `](foo.md)` (optionally with `#anchor`); percent-encoding is decoded once; self-links, links to nonexistent pages, and duplicate edges are dropped. Backlinks are filled in.
- Files are processed in sorted order (deterministic output).

---

## 6. Programmatic API surface

**There is none.** Evidence:

- `package.json` declares **no `exports`** map, no `main`, no `module`, no `types` — only a single `bin` entry (`dist/cli/cli.js`). OpenWiki is CLI-only.
- The shipped `files` array is `["dist", "integrations", "skills", "README.md", "LICENSE"]` — a CLI distribution, with an agent-integration (MCP/skill) surface rather than a library surface.
- `dist/visualize/*.d.ts` files exist, but they are internal build artifacts of the package's own modules; without `exports` they are not importable public entry points.

**What a host plugin can rely on instead:**

| Surface | Form | Stability |
| ------- | ---- | --------- |
| CLI subprocess | `spawn(openwiki, ["visualize", …])` | Documented; the intended integration path. |
| HTTP + JSON | `GET http://127.0.0.1:<port>/api/graph` | Stable within 0.7.2; the graphing contract. |
| Static artifact | `graph.json` from `--export` | A plain JSON file — the **most robust** programmatic-ish surface. |
| Agent integrations | MCP tools (`openwiki_search`, `openwiki_read`, `openwiki_begin`…`openwiki_finish`) + skills under `integrations/` | Documented; oriented to coding agents, not to an embedding host. |
| Config | `~/.openwiki/.env` (env vars), `.openwikiignore`, `openwiki/INSTRUCTIONS.md`, `openwiki/.langsmith.json` | Documented. |

There is **no** JSON manifest describing the visualizer, and **no** documented config schema for `visualize` beyond its three flags. (A `dist/visualize/client-lib.d.ts` exists but is a browser bundle's types, not a public contract.)

---

## 7. Embedding the preview in an iframe

### 7.1 The good news: framing is allowed

The CSP served with `/` is (verbatim from `page.js:11-20`):

```
default-src 'none'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data:; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; base-uri 'none'; form-action 'none'
```

- **No `frame-ancestors` directive** → the CSP does not restrict which origins may frame the page.
- **No `X-Frame-Options` header** is set anywhere in `server.js` or `page.js`.
- The server sets **only** `content-type` (and `content-security-policy` on `/`) — no `Cross-Origin-Resource-Policy`, no `Cross-Origin-Embedder-Policy`, no `Cross-Origin-Opener-Policy`.

**Conclusion:** the live visualizer page **can be embedded in an `<iframe>` from another origin** (e.g. the DSH Web GUI). Sibling UI routes (`/client.js`, `/client-lib.js`, `/styles.css`, `/api/graph`) are same-origin to the iframed page, so `script-src 'self'` / `connect-src 'self'` are satisfied by design.

### 7.2 Caveats a host plugin must handle

1. **Serve it as its own origin.** Because `/` is matched exactly, iframe `src` must be exactly `http://127.0.0.1:<boundPort>/`. Do not append a path or query.
2. **Discover the actual bound port.** The port may be 4321 + N. The CLI does not document a machine-readable way to learn it. Options: parse the `open:  http://127.0.0.1:<port>` banner line from stdout, probe upward from the preferred port for `/api/graph`, or reserve a free port in the host and pass it via `--port` (which still increments on a race).
3. **Internet is required.** The page loads from `cdn.jsdelivr.net` (force-graph 1.49.5, marked 12.0.2, dompurify 3.4.12, mermaid 11.16.0 — all with SRI) and Google Fonts (Inter). `script-src` allows only `'self'` + `cdn.jsdelivr.net`, and `style-src` only `'self'` + `'unsafe-inline'` + `fonts.googleapis.com`. **Offline, or behind a proxy that blocks jsdelivr/fonts, the viewer will render blank or unstyled.** The upstream README states this explicitly. If offline support is required, the host must proxy/rewrite the CDN URLs (which means re-serving the HTML rather than iframing the CLI's page) — the visualizer offers no offline mode.
4. **If framing *is* blocked in some future version**, the fallback is to stop iframing the CLI page and instead:
   - open the visualizer in a new browser tab/window (the CLI's own `--no-open`/default-open behavior), or
   - consume `/api/graph` (JSON) or the exported `graph.json` and render inside DSH's own UI — which is exactly what the sibling plugin `D2Moqi/dsh-openwiki` does (its own Markdown renderer, no `visualize`).
5. **Liveness.** Hot reload arrives over the page's own `/events` SSE, which works fine inside an iframe because it is same-origin to the framed page. No host-side WebSocket is needed.
6. **Lifecycle.** The server runs until `SIGINT`; a host plugin must spawn it as a managed child process, kill it on teardown, and be prepared to retry on a shifted port.

---

## Unverified / Assumptions

Everything below is **not** confirmed by direct evidence in this research. Treat it as open questions, not facts.

1. **The `> 0.7.2` dependency constraint is unsatisfiable today.** *Fact:* npm's latest is 0.7.2 and 0.7.2 is the highest published version. *Assumption:* the requirement was written against an expected future release. **The plugin cannot depend on `openwiki > 0.7.2` as written** — it needs either `^0.7.2`/`>=0.7.2` now, or to wait for a newer publish. **Unknown:** whether/when a 0.8.0 is planned, and whether any `visualize` behavior described here will change in it.
2. **Whether an official openwiki *docs site* exists.** *Unknown.* No docs site was found or reachable; the canonical documentation is the repo README plus `--help`. The candidate URL in the brief, `https://github.com/D2Moqi/dsh-openwiki`, is **not** openwiki — it is a separate, third-party DSH plugin (verified via the GitHub API and its README).
3. **Network reachability.** Direct `web_fetch` failed (`TypeError: fetch failed`) and `raw.githubusercontent.com` timed out in this environment. `api.github.com` and `registry.npmjs.org` **did** work via PowerShell `Invoke-RestMethod`. So the upstream README was obtained through the GitHub API (base64), not the raw URL — the content is identical, but this is worth noting as a method caveat.
4. **No `--host` flag and no environment override for the bind host.** *Verified absent* from the parser, the help, and the README. *Assumption:* the binding can therefore not be changed without patching. Not exhaustively proven (I did not grep the entire `dist` for an env var named e.g. `OPENWIKI_HOST`); minor residual risk.
5. **No machine-readable port announcement.** The bound port is only printed in the human banner (`open:  http://…`). *Assumption:* the host must parse that line or probe. **Unknown:** whether the banner text is stable across versions, and whether stdout is line-buffered when the process is not a TTY (the Ink/TUI `Raw mode` error suggests non-TTY behavior differs — treat stdout scraping as fragile).
6. **The exact set of files `--init` creates outside `openwiki/`** is inferred from the agent prompt sources (#13), the README (#14), and the sibling plugin (#18), not from observing a real init (the workspace has no openwiki project and no init was run). Names like `.page-manifest.json`, `.run.json`, `.last-update.json`, `.langsmith.json`, `AGENTS.md`, `CLAUDE.md`, `.openwikiignore` are stated by those sources; their **exact JSON schemas are unknown**.
7. **Whether `visualize` is affected by `.openwikiignore`.** *Assumption:* no — `graph.js` only excludes `INSTRUCTIONS.md` and `log.md`; `.openwikiignore` is documented as governing *generation*, and `graph.js` contains no reference to it. Not separately proven.
8. **Personal-mode `visualize`.** `openwiki visualize ~/.openwiki/wiki` is *assumed* to work (the command takes an arbitrary directory), but the README documents `visualize` only in the code-wiki context, and this was not executed.
9. **`--export` + iframe.** The static page embeds CSP as a `<meta>` tag (still no `frame-ancestors`), so it should also be frameable; the static files are relative-path based. *Assumption:* fine for iframing, but only if the host serves the static dir itself with permissive response headers (a host serving it with its own restrictive CSP/XFO could block framing).
10. **Client-rendered markdown safety.** `page.js` comments say scalars are HTML-escaped client-side and bodies additionally protected by CSP + DOMPurify; the actual client-side sanitization code in `client.js` was not audited line by line. *Assumption:* rendering wiki content is sanitized. Relevant if a host ever injects untrusted content into the wiki.
11. **Behavior differences of the `D2Moqi/dsh-openwiki` sibling.** Its README is read as prior art; its claims about DSH internals (RPC routes, slots, better-sidebar) were **not** independently verified and are out of scope here.
12. **No code was written or executed against a real wiki** — the server was never started in this research, so banner text, port-increment behavior, and iframe rendering are confirmed from source, not from a live run. A live smoke test against a real `openwiki/` directory remains to be done before the plugin is implemented.

---

## Checklist for `dsh-openwiki-visualize` (derived, not a spec)

- Detect a wiki by looking for `openwiki/` containing `.md` files (do not require `.page-manifest.json`).
- Depend on `openwiki` with an installable range — `>0.7.2` resolves to nothing today.
- Spawn `openwiki visualize <wikiRoot> --port <p> --no-open` as a managed child; discover the bound port from the banner (or probe `/api/graph`).
- Iframe `http://127.0.0.1:<port>/` — exactly `/`, no path, no query.
- Framing is permitted (no `frame-ancestors`, no `X-Frame-Options`); no host-side cross-origin work needed.
- Internet is required for CDN assets; document this in the plugin, or render `graph.json` yourself for offline.
- Kill the child on teardown; the server only stops on `SIGINT`.
