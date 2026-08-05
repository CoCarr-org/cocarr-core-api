# Branching Strategy: Git Flow

This repository follows Git Flow. This document is generated/maintained by `setup-gitflow.sh`.

## Branches

| Branch      | Purpose                                   | Protected |
|-------------|--------------------------------------------|-----------|
| `main`  | Production-ready code only. Tagged releases. | Yes |
| `develop` | Integration branch for ongoing development. | Yes |
| `feature/*`  | New features, branched from and merged back into `develop`. | No |
| `release/*`  | Release stabilization, branched from `develop`, merged into `main` and back into `develop`. | No |
| `hotfix/*`   | Urgent production fixes, branched from `main`, merged into `main` and back into `develop`. | No |
| `bugfix/*`   | Non-urgent fixes during development, branched from and merged into `develop`. | No |
| `support/*`  | Long-term maintenance of an old release line. | No |

## Rules enforced

- Direct pushes to `main` / `develop` are blocked — all changes go through a pull request.
- Pull requests require at least 0 approval(s).
- Stale approvals are dismissed when new commits are pushed.
- Force-pushes and branch deletion are disabled on `main` / `develop`.
- Conversations on a PR must be resolved before merging.
Both of the following are enforced by `.github/workflows/branch-policy.yml`, which runs on every pull request:

- Branch names must match: `^(feature|release|hotfix|bugfix|support)/.+$` (job `validate-branch-name`)
- A PR's base branch must match its head branch's type (job `check-merge-direction`):
  - `feature/*`, `bugfix/*` → must target `develop`
  - `release/*`, `hotfix/*` → must target `main` or `develop`

## Known gaps

**Branch naming is checked at pull-request time, not at push time.** The
intended mechanism was a repository ruleset using GitHub's
`branch_name_pattern` rule, which would reject a non-compliant branch as it is
created. GitHub does not offer that rule for repository rulesets on user-owned
accounts — the API rejects it with `422 Invalid rule` — so it cannot be enabled
here at any plan level. You can still *create and push* a badly-named branch;
you just cannot open a mergeable PR from it. If these repos move under a GitHub
organisation, re-run `setup-gitflow.sh` and the ruleset step will apply.

**The policy jobs are not required status checks.** `required_status_checks` is
deliberately `null`, so a red `branch-policy` run shows as a failure but does
not hard-block the merge button. To make it blocking once you are happy with it:

```bash
gh api --method PATCH "repos/OWNER/REPO/branches/main/protection/required_status_checks" \
  -f 'strict=false' -F 'contexts[]=validate-branch-name' -F 'contexts[]=check-merge-direction'
```

## Not yet configured (add when ready)

- Required approvals are set to **0**. GitHub does not allow
  self-approval and `enforce_admins` is on, so on a single-maintainer repo any
  value above 0 makes every PR permanently unmergeable. Raise this to 1 as soon
  as a second reviewer exists.
- CODEOWNERS-based required reviewers.
- Commit message convention (e.g. Conventional Commits) enforcement.
