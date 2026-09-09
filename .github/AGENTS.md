# AGENTS.md — GitHub Actions

Run CI and issue-management jobs on `ubuntu-latest`. The `issue-lifecycle.yml` workflow requires a GitHub App token (vars `DSH_MEGA_PLUGINS_ISSUE_APP_CLIENT_ID` + secret `DSH_MEGA_PLUGINS_ISSUE_APP_PRIVATE_KEY`) to write Project board status; `issue-policy.yml` uses the read-only `github.token`. The `verify-translation-pairing.yml` workflow fires only on README path changes. Dependabot labels dependency PRs `kind/dependency` + `area/infra` with a 30-day cooldown.
