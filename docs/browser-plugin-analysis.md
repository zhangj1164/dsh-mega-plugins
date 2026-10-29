# DSH Browser / Embed / Preview Plugins — Analysis for `dsh-openwiki-visualize`

**Date:** 2026-10-16
**Question:** for a new DSH Web plugin `dsh-openwiki-visualize` that previews a local openwiki site (`openwiki visualize` server at `http://127.0.0.1:<port>`) inside a right-side drawer/panel, which published third-party DSH plugin can be reused as an internal dependency to provide the "browser view" (iframe / webview), instead of writing that layer ourselves?

**Bottom line:** no published DSH Web plugin exposes a clean, reusable *browser-view client Service* for a right-side drawer. The DSH host's own `ui-sidebar-browser` sidebar kind is desktop-profile-only (claimed by the better-sidebar integration guide, see Sources), so on the **Web** profile browser embedding is a plugin-supplied page by design. Two plugins are worth reusing: `dsh-preview-plugin` (the host-side same-origin proxy + sandboxed-iframe layer that solves cross-origin, `X-Frame-Options` and root-relative asset problems) and `dsh-better-sidebar` (the de-facto right-sidebar/drawer shell with a real `ctx.betterSidebar.registerTab` extension point). The most robust realistic plan combines them, and still owns a thin iframe element.

---

## Sources

Every URL below was actually fetched in this session; the note says what it yielded. Provenance terms used throughout the report: **"in list"** = appears in the awesome-dsh-plugin README; **"verified"** = a repository or registry fetch confirmed the fact.

| # | URL | What it yielded |
|---|-----|-----------------|
| 1 | `https://raw.githubusercontent.com/awesome-dsh-plugin/awesome-dsh-plugin/master/README.md` | HTTP 200 via `web_fetch`; truncated (README is 1.47 MB). Confirmed the list exists and the toc/categories. |
| 2 | `https://api.github.com/repos/awesome-dsh-plugin/awesome-dsh-plugin` | Repo metadata: 18,913 stars, license CC0-1.0, default branch `main`, pushed 2026-10-15, updated 2026-10-16, 1,027 open issues. |
| 3 | `https://api.github.com/repos/awesome-dsh-plugin/awesome-dsh-plugin/contents/` | Root listing: `README.md` = 1,478,954 bytes, `README.zh.md` = 1,395,685 bytes, plus `data/`, `site/`, `scripts/`. |
| 4 | `https://api.github.com/repos/awesome-dsh-plugin/awesome-dsh-plugin/git/blobs/4be0ec5d3cd86dbb919fee416d0d41158720e83f` | Full README (1,478,954 bytes) downloaded via `curl.exe` with `Accept: application/vnd.github.raw`. **`### Browser & Web` is lines 2874–2982** (~93 entries); all section headers captured. |
| 5 | `https://awesome-dsh-plugin.com/count.json` | `{"label":"plugins","message":"4765"}` — 4,765 listed plugins. |
| 6 | `https://api.github.com/repos/awesome-dsh-plugin/awesome-dsh-plugin/contents/data/plugins?ref=main` | Listing of per-plugin YAML files (page of 1,000), named `<owner>__<repo>.yml`. |
| 7 | `https://api.github.com/repos/awesome-dsh-plugin/awesome-dsh-plugin/contents/data/plugins/RaulLazaro__dsh-preview-plugin.yml?ref=main` | Sample YAML schema: `url`, `name`, `category`, `description.en`, `description.zh` only (no npm/stars). |
| 8 | `https://api.github.com/repos/awesome-dsh-plugin/awesome-dsh-plugin/contents/data/stars.json?ref=main` | Stars map keyed by repo URL with `checkedAt` (mostly `2026-08-19`). **Incomplete** — many candidates absent. |
| 9 | `https://api.github.com/repos/awesome-dsh-plugin/awesome-dsh-plugin/contents/data/added-dates.json?ref=main` | Added-date map keyed by list URL. |
| 10 | `https://api.github.com/repos/<owner>/<repo>` (×~12) | Per-candidate metadata: stars, `pushed_at`, `license.spdx_id`, `default_branch`, `archived`. See inventory. |
| 11 | `https://api.github.com/repos/<owner>/<repo>/contents/package.json` (×~10) | `name`, `version`, `dsh.bundle`, `dsh.client`, `peerDependencies`, `exports`. |
| 12 | `https://registry.npmjs.org/dsh-better-sidebar` | latest `0.26.1`, MIT, published 2026-10-16, full `dsh` + peer map, large dependency set. |
| 13 | `https://registry.npmjs.org/dsh-artifact-preview` | latest `0.1.2`, MIT, published 2026-08-18. |
| 14 | `https://registry.npmjs.org/dsh-overleaf` | latest `0.1.3`, MIT, published 2026-08-22; peers `@deepseek-ai/dsh-mcp-client` (npm dist differs from repo HEAD `1.0.0`). |
| 15 | `https://registry.npmjs.org/dsh-tiddlywiki` | latest `0.30.65`. |
| 16 | `https://registry.npmjs.org/@deepseek-ai%2Fdsh` | latest `0.2.0-rc.2` — sanity check that scoped lookups work; also the current host line. |
| 17 | `https://registry.npmjs.org/dsh-preview-plugin` | **HTTP 404 — not published on npm.** |
| 18 | `https://registry.npmjs.org/fsviewer` | **HTTP 404 — not published on npm.** |
| 19 | `https://registry.npmjs.org/dsh-inapp-browser` | **HTTP 404 — not published on npm.** |
| 20 | `https://registry.npmjs.org/@dsh-external%2Fdsh-webrelay` | **HTTP 404 — not published on npm.** |
| 21 | `https://registry.npmjs.org/@dsh-external%2Fdsh-web-preview-float` | **HTTP 404 — not published on npm.** |
| 22 | `https://raw.githubusercontent.com`/… candidate READMEs via GitHub API raw (`Raw` accept): `RaulLazaro/dsh-preview-plugin`, `sunyuhuirong/fsviewer`, `alllllinnrann/dsh-inapp-browser`, `Baisbt/dsh-plugin-webrelay`, `Fisfzy/ego-browser`, `omdsh-dev/DSH-better-sidebar` | Read for behaviour and integration points. |
| 23 | `https://api.github.com/repos/omdsh-dev/DSH-better-sidebar/contents/docs/external-plugin-guide.md` | 119,805-byte integration guide: `ctx.betterSidebar.registerTab` / `registerFileViewer` contract, and the statement that the host browser kind is desktop-only since 0.1.7. |
| 24 | `https://api.github.com/repos/RaulLazaro/dsh-preview-plugin/contents/lib/index.js` and `.../lib/client.js` | Host: `inject = ['webServer']`, registers `/preview/:port/*` + `/api/preview-port`, tool `set_preview_port`. Client: `inject = ['slots']`, `ctx.slots.inject("conversation.view", …)`, renders a sandboxed `<iframe>`. No client Service is exposed. |

**Network note (important, honest):** `raw.githubusercontent.com` from a plain PowerShell `Invoke-WebRequest` **times out** in this environment; `https://api.github.com/...` and `https://registry.npmjs.org/...` work from PowerShell, and `web_fetch` reaches `raw.githubusercontent.com`. The full README could not be read through `web_fetch` because it exceeds the fetch truncation limit, so it was retrieved through the GitHub git-blobs API with `Accept: application/vnd.github.raw` (source #4). The GitHub REST API is unauthenticated and rate-limited (~60 req/hr); the number of repo/registry fetches was kept small on purpose, which is why only the highest-value candidates were individually verified. Anything not listed in the inventory as "verified" is therefore *in list only*.

---

## Inventory — browser / embed / preview candidates

Stars and dates were read from the GitHub API at fetch time (2026-10-16) unless marked "(list)". "Not on npm" means `registry.npmjs.org` returned 404 (verified). "amend" = the npm dist differs from repo HEAD.

### A. Verified embed / browser-view candidates

| Name | Repo | npm | Version | Stars | Last push | What it actually does | DSH extension point | Usable as a library/dependency? |
|------|------|-----|---------|-------|-----------|-----------------------|--------------------|--------------------------------|
| dsh-preview-plugin | `RaulLazaro/dsh-preview-plugin` | **not on npm** (404) | 1.3.2 (git) | 1 | 2026-10-09 | Live preview tab: embeds **any** `127.0.0.1:<port>` dev server in a sandboxed iframe with a **same-origin path proxy** `/preview/:port/*` (SPA 404→shell fallback, `<base>` injection, `fetch`/XHR URL rewriting, cookies, streaming, stall timeout). Agent tool `set_preview_port`; HTTP API `/api/preview-port`. | Host: `inject=['webServer']`, `ctx.webServer.register` for `/preview/:port/*` and `/api/preview-port`. Client: `inject=['slots']`, `ctx.slots.inject("conversation.view", …)` → registers a **conversation-area view**, not a right-sidebar tab. **No client Service exposed.** | Yes, partially: install via git as a bundle, or reuse its **host `/preview/<port>/` route** (documented feature) from another plugin's iframe. The client half is a `ModuleLoader` view, not an exported component. |
| dsh-better-sidebar | `omdsh-dev/DSH-better-sidebar` | `dsh-better-sidebar` | 0.26.1 | **4,200** | 2026-10-16 | Ecosystem right-sidebar + bottom-workbench shell. File tree, editor (CodeMirror), Git, tasks, side chat, terminal, markdown/mermaid and sandboxed-HTML viewers. Host routes `/sidebar/api/*`, media/HTML preview/upload routes, 2 WebSockets. | Client `ctx.provide('betterSidebar', service)` → `ctx.betterSidebar.registerTab(descriptor)` / `registerFileViewer(descriptor)`; you supply a React `component`. **Ships no `browser` tab kind** now (host's `ui-sidebar-browser` is desktop-only since 0.1.7). | Yes — this is the intended consumption path and 30+ ecosystem plugins use it. Peers DSH `^0.2.0-rc.2`; large dependency graph. |
| dsh-inapp-browser | `alllllinnrann/dsh-inapp-browser` | **not on npm** (404) | 0.2.7 (git) | 1 | 2026-09-23 | Shared Chromium (Edge/Chrome) browser **panel** rendered by frame transport into Better Sidebar; human+agent mouse/keyboard, snapshots, screenshots, per-chat profiles; `iab_*` tools. Chinese README. | Client `inject=['dsh-better-sidebar']`; peer `dsh-better-sidebar >=0.19.1 <0.20.0` (see risks). Provides **tools**, not a reusable view component. | Weak. Pinned to a 0.19.x sidebar against the current 0.26.1; not on npm; heavy Chromium runtime. |
| dsh-plugin-webrelay | `Baisbt/dsh-plugin-webrelay` | **not on npm** (`@dsh-external/dsh-webrelay`, 404) | 0.1.0 | 1 | 2026-09-14 | Embeds *external AI chat sites* in a DSH side panel via a **same-origin reverse proxy** with per-site DOM adapters; composer round-trip. | Client `inject=['@deepseek-ai/dsh-client-runtime','@deepseek-ai/dsh-client-ui-slots']`. Per-site adapters, not a generic URL viewer. | Weak — purpose-built per site, unpublished. Its same-origin-proxy pattern is the reusable idea. |
| dsh-web-preview-float | `WJNCT55555/dsh-web-preview-float` | **not on npm** (`@dsh-external/dsh-web-preview-float`, 404) | 0.1.0 | 1 | 2026-08-15 | Google-AI-Studio-style **floating** draggable/resizable iframe preview with aspect-ratio/resolution presets, plus a VS Code-style code window. | `dsh.client.platform='web'`; no slot inject declared in package.json. Floating overlay, not a drawer. | Weak — unpublished, floating (not a right drawer). |
| dsh-artifact-preview | `nirvanaslash/dsh-artifact-preview` | `dsh-artifact-preview` | 0.1.2 | 1 | 2026-08-18 | Produced-files card row + resizable split-screen artifact preview (Markdown/code/CSV/JSON/images/HTML) **plus a localhost port preview**. | Client `inject=['@deepseek-ai/dsh-client-ui-conversation']`. | Weak — mainly an artifact viewer; not a generic URL drawer. |
| fsviewer | `sunyuhuirong/fsviewer` | **not on npm** (404) | 1.3.0 (git) | 0 | 2026-09-03 | Right-edge file manager that **takes over the native `details` right column** (priority −10 shadow registration); tree + preview (Markdown/source), and a "browser" tab (direct/proxy iframe). Chinese README with a security warning (host route reads **any absolute path**, unauthenticated). | Client injects `ui-slots`, `ui-workspace`, `ui-primitives`; takes over the native details column rather than registering into a tab service. Host `/fsviewer-api`. | Weak — file-oriented, security posture unsuitable as a dependency. Its "take over native details column" technique is a lower-level alternative. |
| dsh-overleaf | `gychen-NJU/dsh-overleaf` | `dsh-overleaf` | 0.1.3 (npm) / 1.0.0 (HEAD) | 2 | 2026-09-29 | Embeds an Overleaf site (hosted or self-hosted) into a conversation tab through a **same-origin reverse proxy**, cookie/popup login, selection quoting, compile-log fixes. | npm dist peers `@deepseek-ai/dsh-mcp-client` and depends on `@fly233338/overleaf-mcp`; repo HEAD declares `dsh.client.inject=['@deepseek-ai/dsh-client-runtime']`. | Weak for our use (Overleaf-specific), but a strong **pattern reference**: same-origin reverse proxy to a remote/local site. |
| dsh-tiddlywiki | `bbqisbbq/dsh-tiddlywiki` | `dsh-tiddlywiki` | 0.30.65 | 6 | 2026-10-09 | Runs TiddlyWiki as a knowledge base; embeds the TiddlyWiki editor **in the center column over a same-origin proxy**, plus a **right-side wiki tab**. | `dsh.client.inject=['slots']`. | Weak as a dependency (TiddlyWiki-specific), but the **closest published analog** to "embed a local server app in DSH, including a right-side tab". |
| ego-browser | `Fisfzy/ego-browser` | not checked | — | **239** | 2026-09-28 | Drives a bundled Chromium via 32 `ego_*` tools with a **live SSE screencast observation window**; registers as a native Better Sidebar tab when present, else a floating ball. | Opportunistically consumes `ctx.betterSidebar` via `ctx.get()` (`registerTab`/`openTab`, `urlTarget`), not a peer dependency. | Weak for our use — a screencast/automation browser, not a URL iframe; heavy runtime; license **NOASSERTION** (non-SPDX). |
| dsh-viewer | `Crosery/dsh-viewer` | unknown (package.json fetch failed) | — | 9 | 2026-10-06 | Model-facing `display_file` tool rendering 36 extensions inline; local HTML in a **sandboxed frame**; signed HTTP route with range support. | Not confirmed. | Not verified. Listed for the sandboxed-HTML-frame pattern. |

### B. Browser & Web section — the wider cohort (in list, not individually verified)

The `### Browser & Web` section (README lines 2874–2982) contains ~93 entries. The overwhelming majority are **agent-facing web search / fetch providers and browser-automation drivers**, not UI embeds:

- **Search providers** (e.g. `1624318455/dsh-plugin-tavily`, `240xu/dsh-websearch`, `A3Boy/dsh-web-tools`, `chendefine/dsh-web-search-aggregation`, `delef/dsh-free-web-search`, …) — register into the `ctx.web` seam.
- **Fetch / render providers** (e.g. `2672243194/dsh-read-url`, `chendefine/dsh-web-fetch-playwright`, `GreyRaphael/dsh-web-fetch-moli`, `CREAIT-nl/dsh-plugins#web-fetch`, …) — back the built-in `web_fetch`.
- **Browser automation / control** (e.g. `anweat/dsh-browser`, `dengpeihua/dsh-browser-use`, `KasenRi/dsh-browser`, `CJYLZS/dsh-browser`, `lyp88997/dsh-browser-service`, `wqty123/dsh-browser`, `ParticleLight/dsh-browser-plus`, `guo6x/dsh-pilot`, `Viger1/dsh-pilot`, `jiaererw/dsh-plugin-chrome`, …) — drive real Chromium/Chrome over CDP/Playwright and expose tools; several also show a live screenshot panel in the GUI, but they are tool surfaces, not reusable embed components.
- **Extensions / bridges** (e.g. `bpc-oss/chrome-faithful#dsh-plugin-chrome-faithful`, `lyd123qw2008/pi-control-chrome`, `omdsh-dev/dsh-browser#packages/browser/bridge-browser`, `stuarthu/dsh-chrome`) — MV3 extensions + localhost bridges.

These are out of scope for "embed a local site in a drawer" and were not fetched repo-by-repo.

### C. Broader keyword-matched UI/embed candidates (in list, not individually verified)

These surfaced from the whole-README keyword sweep (browser/webview/iframe/preview/embed/panel/drawer/viewer) outside the Browser & Web section and are relevant as alternatives or pattern references:

| Candidate (in list) | Relevance |
|---------------------|-----------|
| `RaulLazaro/dsh-preview-plugin` | "embed any dev server in an iframe with transparent SPA proxying" — the headline hit; verified above. |
| `sunyuhuirong/fsviewer` | "embedded browser (direct/proxy iframe)" in the native details column; verified above. |
| `addie-ace/dsh-livebench-rankings` | Renders in an "isolated same-origin iframe". |
| `ArcaneOrion/dsh-teaching-board` | Projects HTML into a **sandboxed iframe** board. |
| `GooDAnDReaDY/dsh-live-canvas` | Renders HTML/React/Vue in an **isolated iframe sandbox** with hot-reload. |
| `yfwu2020/dsh-reply-visual` | Right sidebar renders generated HTML in a **sandboxed iframe**. |
| `loyalchiiina/dsh-lobsterai-daddy` | Right drawer renders a local console as **native DOM from a loopback same-origin proxy (no iframe)**. |
| `He2way/dsh-task-console` | Infinite canvas with **embedded web-app frames**. |
| `2nd1st/dsh-plugin-open-app` | Per-app sidebar container with **inline app rendering**. |
| `e2mcc/dsh-popout-sidebar` | Artifacts + file tree with multiple preview formats; pops out to another tab. |
| `DamonKoy/dsh-web-ui#dsh-aionui-panel` | "Right-panel system for the dsh web GUI" (Explorer + Preview). |
| `Limitinfinitude/DSH-Right-Sidebar` | Right-side output dock (reports/images/data/video/audio). |
| `ccq1/dsh-side-panel` | Side panel with file browser, terminal, Git review. |
| `AKS1st/dock-editor` / `dock-markdown` / `dock-images` | Dock-workbench viewers (registered as default file viewers). |
| `Crosery/dsh-viewer` | `display_file` renders 36 extensions incl. local HTML in a sandboxed frame. |
| `bbqisbbq/dsh-tiddlywiki` | Local server embedded over same-origin proxy + right-side tab. |

### D. Popularity index caveat

The awesome list's `data/stars.json` is keyed by repo URL and stamped `checkedAt: 2026-08-19`, and it is **incomplete**: `dsh-better-sidebar` (2,216 there vs 4,200 live), `anweat/dsh-browser` (6), `e2mcc/dsh-popout-sidebar` (16), and `stuarthu/dsh-chrome` (0) are present, but `dsh-preview-plugin`, `fsviewer`, `dsh-inapp-browser`, `webrelay`, `dsh-viewer`, `live-canvas` and most others are **absent**. The report uses live GitHub API stars (2026-10-16) wherever a repo was verified, and does not invent stars for unverified entries.

---

## Comparison of realistic candidates

Criteria: **(a)** render an arbitrary `http://127.0.0.1:<port>` URL; **(b)** open a right sidebar / drawer in DSH Web; **(c)** reusable as an internal dependency by another plugin; **(d)** iframe vs webview vs Electron; **(e)** CSP / `X-Frame-Options` handling; **(f)** maintenance; **(g)** license.

| Criterion | **dsh-preview-plugin** | **dsh-better-sidebar** (+ our iframe) | **dsh-inapp-browser** | **dsh-web-preview-float** | **ego-browser** |
|-----------|------------------------|----------------------------------------|------------------------|---------------------------|-----------------|
| (a) arbitrary `127.0.0.1:<port>` | **Yes — its entire purpose.** Explicitly rejects non-local URLs; targets `127.0.0.1` only. | Yes, but the iframe is ours to write; the shell itself is URL-agnostic. | Yes (it opens any URL in Chromium), but via frame transport, not a URL view. | Yes (floating iframe). | Yes (Chromium), not as an iframe. |
| (b) right sidebar / drawer | **No** — client registers a `conversation.view` slot (a view in the conversation area), not the right sidebar. | **Yes** — `registerTab` renders a native right-sidebar tab / drawer (and on mobile its tabs merge into the right drawer). | Yes (a Better Sidebar tab). | No (floating overlay). | Yes when better-sidebar is present (else floating ball). |
| (c) reusable dependency | Partial — reuse the **host `/preview/<port>/` proxy route**; the client half is not an exported component and no Service is exposed. | **Yes — first-class**: `ctx.betterSidebar.registerTab`/`registerFileViewer`, 30+ plugins use it. | Weak — pinned peer, tool surface, unpublished. | Weak — unpublished, floating. | Weak — no peer dep, screencast runtime, license unclear. |
| (d) mechanism | **Sandboxed iframe** + same-origin path proxy | **Right-sidebar React host** (you render an iframe inside it) | Chromium + CDP screencast frames | **Floating iframe** | Chromium + CDP SSE/JPEG/H.264 frames |
| (e) CSP / `X-Frame-Options` | **Solved by design**: the app is served same-origin under `/preview/:port/`, so the target's framing headers never apply; `<base>` + `fetch`/XHR rewriting handle root-relative assets; CORS is strictly same-origin; body cap and stall timeout; no redirect following. | **Not solved by the shell** — a direct `iframe src="http://127.0.0.1:<port>/"` from the DSH origin is cross-origin and subject to the target's `X-Frame-Options` / CSP `frame-ancestors`. Loopback `http://127.0.0.1` is a trustworthy/secure context and is exempt from mixed-content blocking in Chromium, so it usually works if the target sets no framing headers. | N/A (frame transport, no iframe) | Same cross-origin caveat as the iframe column. | N/A (screencast) |
| (f) maintenance | 1 star, last push 2026-10-09, 8 test suites, single maintainer; **not on npm** (git install only). | **Strong**: 4,200 stars, npm 0.26.1 published 2026-10-16, active changelog, large peer surface. | 1 star, 2026-09-23, **peer pinned to better-sidebar `>=0.19.1 <0.20.0`** while current is 0.26.1. | 1 star, 2026-08-15, unpublished. | 239 stars, 2026-09-28, heavy runtime. |
| (g) license | MIT | MIT | MIT | MIT | **NOASSERTION** (non-SPDX) |

Two further facts that shape the decision:

- **DSH Web has no `browser` sidebar kind.** The better-sidebar integration guide states the host ships `ui-sidebar-browser` (`kind: 'browser'`) but that it is mounted **only in the `desktop` profile from DSH 0.1.7**; on the Web profile `openTab('browser', …)` will fail, and a plugin must "provide the page yourself, or hand the link back to the host" (source #23, §browser row). This is *claimed by a third-party doc*, not an official spec — see Unverified.
- **`dsh-preview-plugin` is functionally exact** but ships its UI into the conversation view, so using it as-is gives a Preview tab, not a right drawer; using it as a *library* means depending on its host route.

---

## RECOMMENDATION

No published plugin provides a drop-in, reusable "webview/browser" client Service that opens an arbitrary local URL in a DSH Web right-side drawer. So the recommendation is a **composition**, ranked by how much of the "browser layer" it lets us reuse.

### Rank 1 — `dsh-preview-plugin` for the browser layer + `dsh-better-sidebar` for the drawer (recommended)

This is the only combination that reuses a real, purpose-built browser-embed layer *and* gets the right-side drawer.

**What we import / call**

1. Add both as dependencies of `dsh-openwiki-visualize`:
   - `dsh-better-sidebar` from **npm** (`dsh-better-sidebar@0.26.1`) — the drawer shell and `registerTab` service.
   - `dsh-preview-plugin` from **git** (not on npm): profile `package.json` → `"dsh-preview-plugin": "github:RaulLazaro/dsh-preview-plugin#<sha>"` (or a `file:` checkout), added to `dsh.profile.bundles`.
2. In our **client half**, declare the optional dependency and register a right-sidebar tab:
   ```ts
   // inject: ['betterSidebar']  (client)
   ctx.effect(() => ctx.betterSidebar.registerTab({
     id: 'openwiki:visualize',
     title: 'OpenWiki',
     component: ({ scope }) => (
       <iframe
         src={`/preview/${port}/`}
         sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
         style={{ width: '100%', height: '100%', border: 0 }}
       />
     ),
   }))
   ```
   (`port` comes from our own Config field — per the repo's no-hardcoding rule — never inlined.)
3. In our **host half**, put the port into preview-plugin's state so its proxy owns the mapping, via the documented seam: call the `set_preview_port` tool, or `POST /api/preview-port { "port": <p> }`, or reuse the same host state the preview tab reads. The openwiki server is spawned by our plugin; the proxy is registered by preview-plugin on `ctx.webServer`.

**Why it wins:** `dsh-preview-plugin` is the one component that solves the hard parts of embedding a local server — same-origin serving under `/preview/:port/` (so `X-Frame-Options`/CSP on the target is irrelevant), `<base>` injection and `fetch`/XHR URL rewriting for root-relative assets, SPA `404`→shell fallback for client-side routes, cookie/`Set-Cookie` forwarding, streaming, same-origin-only CORS, body caps and a stall timeout, all behind a loopback-only target. `dsh-better-sidebar` supplies the drawer, tab lifecycle, per-session state and mobile behaviour. Neither needs us to write a proxy or a webview layer.

**Risks / open items**

- **Unpublished dependency**: `dsh-preview-plugin` is not on npm; a git dependency means pnpm must be allowed to run `prepare` in the profile (the repo already documents this pattern) and pinning by `#<sha>` is advisable.
- **Undocumented-by-contract route**: `/preview/:port/` is documented in the plugin's README but is an internal route; a future release could change or namespace it. Treat the coupling as a version-pinned integration, not a stable API.
- **Two-plugin coupling and a version floor**: better-sidebar requires DSH `0.2.0-rc.2+`; register the iframe inside `ctx.effect(() => …)` so HMR/disable disposes it (the guide warns otherwise the next activation throws `"already registered"`).
- **1-star maintainer risk** on `dsh-preview-plugin` (single author, last push 2026-10-09); mitigate by vendoring/pinning and keeping our own thin fallback (Rank 3).
- **Slot fit**: if the product requirement is strictly the *right* drawer, we must use better-sidebar's `registerTab` (preview-plugin alone yields a conversation view). If a conversation-area tab is acceptable, the stand-alone install is far simpler.

### Rank 2 — `dsh-better-sidebar` + a minimal own iframe (no preview-plugin)

If we want to avoid an unpublished dependency and a single-maintainer plugin, depend on `dsh-better-sidebar` alone and render a plain same-origin-caveat iframe inside a registered tab pointing directly at `http://127.0.0.1:<port>/`.

- **What we import/call:** identical `ctx.betterSidebar.registerTab(...)` call as Rank 1, but `src={'http://127.0.0.1:'+port+'/'}`.
- **When it works:** the openwiki static server sets no `X-Frame-Options` / `frame-ancestors` (typical of a local static file server); `http://127.0.0.1` is a secure/trustworthy context and is exempt from Chromium mixed-content blocking, so a loopback iframe from the DSH origin loads.
- **When it breaks:** any framing header on the openwiki server, or a need to read the iframe's DOM/cookies cross-origin. Then a same-origin reverse proxy is required — at which point Rank 1 is strictly better, or we write a ~50-line route on `ctx.webServer` (Rank 3).
- **Risks:** still our own iframe element; bigger dependency footprint (better-sidebar pulls CodeMirror/xterm/mermaid/etc.); better-sidebar's minimum DSH is `0.2.0-rc.2+`.

### Rank 3 — build the minimal embedded view ourselves (fallback / control)

The honest floor: because DSH Web has no browser kind, a minimal plugin that registers a right-sidebar tab (via better-sidebar) or takes over the native `details` column (the `fsviewer` technique) and renders one `<iframe>` — plus, only if the openwiki server refuses framing, a small same-origin reverse proxy on `ctx.webServer` — is roughly the same amount of code as wiring Rank 1/2, with **no third-party dependency risk**. This is the right choice if we cannot accept a git-only, 1-star dependency, or if we want full control of the proxy (headers, auth, range). It is *not* a "big" layer: for a static local site it is one route plus one element; the SPA/asset complications only arise if openwiki uses client-side routing, in which case copy `dsh-preview-plugin`'s `<base>` + `fetch`/XHR rewriting approach.

**Explicitly not recommended:** `ego-browser` (screencast Chromium, NOASSERTION license, wrong abstraction), `dsh-inapp-browser` (pinned to an obsolete better-sidebar range, unpublished, heavy), `dsh-web-preview-float` / `webrelay` (unpublished, floating or site-specific), `fsviewer` (file tool with an unauthenticated arbitrary-path host route).

---

## Unverified / Assumptions

- **The awesome list's own data is partial.** `data/stars.json` is stamped `checkedAt: 2026-08-19` and omits most of the candidates reviewed here; every star count in this report comes from a live GitHub API call made on 2026-10-16 **only for repos actually fetched**. Stars, versions and dates for entries marked "(in list)" are unverified.
- **The 4,765 plugin count and 18,913 stars** are from `count.json` and the repo metadata; they are point-in-time.
- **The claim "DSH Web has no `browser` sidebar kind; `ui-sidebar-browser` is desktop-only since 0.1.7"** comes from the third-party `dsh-better-sidebar` integration guide, not from an official DeepSeek Harness spec. It is consistent with the observed absence of a Web browser slot but was not independently confirmed against the harness source.
- **`dsh-preview-plugin`'s client is a `ModuleLoader` view**, not an exported React component; this report *assumes* its host `/preview/:port/` route can be reused by another plugin's iframe. That route is documented in the plugin's README but is not a versioned public API.
- **openwiki visualize server behaviour is assumed**, not tested: no `X-Frame-Options`/CSP framing headers, plain HTTP on `127.0.0.1`, no auth, and (unknown) whether it uses client-side routing or root-relative assets. The choice between Rank 1 and Rank 2/3 depends on these assumptions. **Verify before committing:** `curl -sI http://127.0.0.1:<port>/` and inspect for `X-Frame-Options` / `Content-Security-Policy`.
- **`dsh-overleaf`'s npm dist (0.1.3) differs from repo HEAD (1.0.0)** in both version and `dsh` shape (npm checks out with `dsh-mcp-client` peers); its integration was not exercised.
- **`Crosery/dsh-viewer`'s package.json could not be fetched** (API failure); its npm name, version and extension point are unknown.
- **`ego-browser`'s npm name, version and full manifest were not fetched.** Its license is reported by GitHub as `NOASSERTION`.
- **`dsh-inapp-browser`'s peer pin** (`>=0.19.1 <0.20.0`) is from its `package.json`; whether it happens to run against `dsh-better-sidebar@0.26.1` was not tested.
- **No candidate was installed or run.** All findings are from READMEs, `package.json`, source files and registry/API metadata; no plugin was executed against a live DSH, and no `127.0.0.1:<port>` embedding was performed.
- **GitHub API rate limit**: unauthenticated, ~60 req/hr; fetches were deliberately kept minimal, so coverage of the ~93 Browser & Web entries and the wider keyword set is intentionally shallow for everything that is not one of the top candidates.
