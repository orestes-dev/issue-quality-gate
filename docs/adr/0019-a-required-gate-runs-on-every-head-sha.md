# A gate that can be required runs on every head SHA, whatever it reads

Every vendored gate workflow triggers on `synchronize`, including the two whose
verdict a push cannot change. `pr-readiness` reads the PR title, body, and
`closingIssuesReferences`; none of those moves when a commit lands, and the
re-run reaches the identical verdict every time. It runs anyway.

The reason is that a required status check is a property of a **commit**, not of
a pull request. A workflow run publishes a check-run against the SHA that was
head when it ran, and nothing carries that check-run forward. Branch protection
then asks a question about the current head: does this SHA have a passing
check-run named `pr-readiness`? A verdict sitting on the previous SHA does not
answer it.

So a gate that omits `synchronize` produces this, which is what happened on #132
(2026-07-24):

1. The PR opens at SHA `A`. The gate runs and writes a passing check-run on `A`.
2. A commit is pushed; head moves to SHA `B`. No trigger fires.
3. Protection evaluates `B`, which carries `check` and `commit-hygiene` (both
   list `synchronize`) and no `pr-readiness` at all.

The check is neither red nor pending. It is **absent**, so `mergeStateStatus` is
`BLOCKED` with nothing in flight and waiting never clears it. The only recovery
is an event the gate does list: editing the title or body fires `edited`, the
gate runs on `B`, and the PR goes `CLEAN`. That workaround is invisible unless
you already know the cause, and it asks a human to touch an unrelated field to
unstick a mechanical problem.

The original trigger list left `synchronize` out on the reasoning that a push
cannot change the verdict. That reasoning is correct about the verdict and
answers the wrong question. Protection does not need a _fresh_ verdict; it needs
a verdict _on this commit_. The re-run is redundant in content and load-bearing
in placement.

## Decisions

- **Trigger on `synchronize` in every gate workflow that is or could become a
  required status check**, regardless of what the gate reads. Whether a push can
  change the verdict is not the criterion; whether protection will look for a
  check-run on the new head is.
- **Cost is not a reason to omit it.** `run()` is diff-based and idempotent, so a
  re-run on an unchanged body writes nothing: it re-upserts the same scorecard
  comment and re-sets the same label. A gate run on this repo measures 11-17s,
  the figure #104's rejection rationale established.
- **The trigger is the mechanism**, not any scheme that copies or re-targets an
  existing check-run onto a new SHA. GitHub's supported path is to run again, and
  a second mechanism would be new surface for an outcome one list entry buys.
- **`issue-quality` is outside this rule.** It runs on `issues`, not
  `pull_request`, and an issue has no head SHA, so no `synchronize` exists to add
  and no protection rule can look for one.

## Considered options

- **Leave `synchronize` out and let `edited` be the recovery.** This was the
  status quo. Rejected: it makes a mechanical requirement into tribal knowledge,
  and the symptom (a required check that is absent rather than failing) is the
  hardest possible shape to diagnose from the PR page.
- **Copy the check-run from the old head to the new one.** Rejected: it is new
  code implementing what a trigger already does, and it would need its own
  trigger to notice the head moved anyway.
- **Gate the re-run on whether the body changed since the last run.** Rejected:
  it optimises the thing that is already cheap while keeping the failure mode
  alive for every push that did not change the body, which is nearly all of them.
- **Add `synchronize` only where a gate is known to be required today.**
  Rejected: whether a context is required is an admin act in a consumer's repo
  that repo-contract deliberately reports and never mutates (ADR 0014), so the
  vendored template cannot know. A gate that is safe to require in principle must
  behave correctly when someone does.

## Consequences

- One extra run per push on every PR in an opted-in repo, converging on the same
  verdict the previous run wrote. This is the same trade ADR 0009 made when it
  stopped cancelling superseded runs: a longer workflow-run list in exchange for
  never dropping a verdict.
- The added runs join the existing `pr-readiness-<number>` concurrency group with
  `cancel-in-progress: false`, so serialization per PR is unchanged and a
  skipping label run still never cancels a validating one (ADR 0009).
- Opted-in consumers must re-vendor (`init --force`) to pick this up. Until they
  do, a repo that made `pr-readiness` a required context keeps the failure mode.
  Exposure today is this repo alone.
- `src/pr-validator.test.js` and `src/commit-validator.test.js` each assert their
  template lists `synchronize`, so a future edit that drops it fails the suite
  rather than resurfacing as a wedged PR.
