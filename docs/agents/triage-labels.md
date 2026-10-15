# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## Wayfinder labels

`/wayfinder` uses a second, orthogonal label family, created alongside the triage roles:

| Label                 | Meaning                                                                   |
| --------------------- | ------------------------------------------------------------------------- |
| `wayfinder:map`       | The map issue of a wayfinder effort — owns Notes / Decisions-so-far / Fog |
| `wayfinder:research`  | Research ticket                                                           |
| `wayfinder:prototype` | Prototype ticket                                                          |
| `wayfinder:grilling`  | Open decision / discussion ticket                                         |
| `wayfinder:task`      | Task ticket                                                               |

This repo tracks labels natively on GitHub, so each string above is a real repository label rather than a mapping. Colors live on the labels themselves (`gh label list`); the label palette table described in the setup skill applies only to the local Markdown backend, which this repo does not use.
