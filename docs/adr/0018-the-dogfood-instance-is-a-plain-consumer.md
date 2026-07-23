# The dogfood instance is a plain consumer

This repo's `.github/workflows/{issue-quality,pr-readiness,commit-hygiene}.yml`
become verbatim copies of `templates/workflow/*.yml`, referencing
`orestes-dev/repo-contract@main` exactly as a consumer's do, and the `uses: ./`
self-test they carried is dropped rather than relocated. The repo keeps its
source role only in `templates/` and `src/`, never in a file that also serves the
consumer role.

Those three files were the last place two roles shared one path. Being
hand-authored variants, they could not be expressed in `init`'s vocabulary, which
is byte-equality (ADR 0003): they needed a bespoke field-level drift comparator,
`init` reported all three `stale` forever, `init --force` would have clobbered
them, and the `.repo-contract.json` manifest that #74 made load-bearing had to be
hand-written rather than produced by the tool. Every other installed file, both
Forms, both Author guides, and both hooks, was already a verbatim copy.

The `uses: ./` difference is irreducible, not incidental prose drift: it is
precisely what made a PR's gate run exercise that PR's own code. So the fix is to
stop asking one file to serve both roles, not to reconcile the two files or to
teach `init` a rendering step that would reproduce the fork.

## Decisions

- **The consumer copies win the `.github/workflows/` path**, because that is the
  path `init` installs into and the one a consumer's repo mirrors.
  `issue-quality.yml` also loses the `contents: read` permission it granted for
  `actions/checkout`, which belonged to the self-test and not to a consumer copy.
- **No self-test workflow replaces them.** The alternatives are set out below;
  none bought a signal proportional to its cost.
- **One table-driven drift test replaces seven hand-written ones.** Every entry
  of `SCAFFOLDS[].files` is asserted byte-identical to its `templates/` source,
  which is a claim `src/scaffolds.js` already made in prose and can now make
  without exception. It subsumes the three field-level workflow comparators and
  the six per-file byte assertions scattered across `validator.test.js`,
  `pr-validator.test.js`, and `hooks.test.js`, and it is complete by
  construction: a future scaffold file is drift-checked the moment it joins the
  manifest.
- **`ci.yml` gains an `action.yml` dispatch assertion**, checking that the
  `object` input resolves to command files that exist. It is the cheapest slice
  of what `uses: ./` covered, and it is deliberately narrower (see Consequences).
- **This revises the dogfood-drift-test decision recorded in #42**, which
  predates the scaffold manifest making byte-equality load-bearing for `init`.
  ADR 0003 is untouched and strengthened: its consequence that this repo's
  applied copies must equal the `templates/` bundle now holds of every
  destination with no exception.

## Considered options

- **Self-test against a fixture with no write permissions.** Rejected because it
  collapses into one of the other two. Stubbed, it is what `src/action.test.js`
  already does and adds nothing; against the real API, `run()` reaches
  `addLabels` and `upsertComment` and fails without `issues: write`. It is a
  distinct option only if the action can be told not to write, which is the next
  one.
- **Give the action a dry-run mode and self-test in it.** Rejected: it adds a
  public mode to the action's surface to serve one internal caller, widens the
  work well past its size, and still would not exercise the write path, which is
  where a break would most plausibly live. It buys less than it looks like it
  buys.
- **Self-test against a sentinel object** (a scratch repo or a closed issue held
  for the purpose), triggered by `workflow_dispatch` or `push` rather than by the
  live PR. Rejected: it keeps the composite-wiring signal without the collision,
  but it costs a maintained sentinel and does not run pre-merge on every PR,
  which is most of what made the original signal worth having.
- **Keep the hybrid files.** Rejected: it is the status quo, and it is what makes
  `init` unusable in its own repo.

Every self-test option shares a hazard that also argues against them. Re-running
the gates via `uses: ./` against the live PR would collide with the consumer
copies now running at `@main` on that same PR: both write the same
mutually-exclusive labels and both upsert the same marker-keyed scorecard
comment. The `concurrency` groups are per-gate (`pr-readiness-<number>`), so a
separate workflow does not serialise against them and the two would race, which
is exactly the corruption ADR 0009 chose queue-and-drain to prevent. The job key
is also the status-check context (ADR 0013), so a self-test job reusing a gate's
name would collide there too.

## Consequences

- **Gate verdicts on this repo's PRs come from `@main`'s rules, not the PR's.** A
  rule change merges before it ever grades this repo's own issues and PRs. That
  is precisely what a consumer experiences, which makes it the more honest
  dogfood, and it is the benign half of the trade-off.
- **The canary is gone, and that is the load-bearing cost.** `uses: ./` was the
  only place this action's composite wiring and real API layer executed before a
  merge: `ci.yml` stubs `fetchImpl`, `src/github.test.js` drives a fake fetch,
  and nothing runs `action.yml`. After this change a PR can break
  `src/commands/pr.js` or `action.yml`, pass a green `ci.yml`, merge, and fail
  the next gate run in every opted-in repo at once, this one included.
- **The mitigation does not claim parity.** The `action.yml` dispatch assertion
  plus the existing suite is narrower than what `uses: ./` covered, and is
  recorded here as such rather than as a replacement.
- **The residual detection path is a real consumer's run against `@main`**,
  minutes after merge, with revert as the remedy. That is the risk this project
  already accepted when it chose unpinned `@main` for consumers, on the stated
  grounds that a bad change affects every opted-in repo at once. The dogfood was
  masking one slice of an exposure that was never mitigated anywhere else.
- **`init` becomes usable in its own repo.** It reports every file `ok`, no
  scaffold orphaned or stale, and `--force` on a clean tree rewrites nothing, so
  `.repo-contract.json` is reproducible by the tool rather than hand-written and
  the exception #128 documented is removed.
