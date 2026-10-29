# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout: single-context

This repo is **single-context**: one domain, one glossary, one ADR log at the root. The four packages are one coherent suite — a memo service plus the telemetry and GitHub-issue services it injects — so a per-package glossary would fragment vocabulary that the whole suite shares. The domain vocabulary this repo already commits to lives in `AGENTS.md` (Design principles and Conventions).

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, or
- **`CONTEXT-MAP.md`** at the repo root if it exists — it points at one `CONTEXT.md` per context. Read each one relevant to the topic. _(This repo is single-context, so `CONTEXT-MAP.md` is not expected.)_
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

```
/
├── CONTEXT.md
├── docs/
│   ├── adr/
│   │   ├── 0001-<decision>.md
│   │   └── 0002-<decision>.md
│   └── plans/                    ← validated designs, one per change batch
└── packages/
    ├── telemetry/dsh-telemetry/src/
    ├── github-issue/dsh-github-issue/src/
    ├── memo/dsh-memo/src/
    └── client/ui-memo/src/
```

`docs/plans/` is this repo's own convention for a design that has been validated before implementation. It complements `docs/adr/`, which records the durable decisions: a plan explains a change batch, an ADR states a decision the code must keep honoring.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
