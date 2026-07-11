# Issue quality gate — design decisions so far

Captured from a /grill session on 2026-07-11, started in `second-brain` but the scope
pivoted mid-session: this is meant to become a **universal, opt-in, cross-repo**
mechanism, not something second-brain-specific. That pivot itself is unresolved —
see "Open thread" at the bottom. Do not treat this doc as final; it's a checkpoint
to resume from, to be compared later against the existing `food` repo's
`issue-quality:failing` implementation.

## Problem framing

- Trigger: an audit issue noting GitHub issues aren't uniform, aren't sized right,
  and aren't reliably good input for autonomous agents.
- Explicitly building **from first principles**, not porting `food`'s solution
  wholesale — the owner wants to re-derive it, even though `food` already has a
  working `issue-quality:failing` label + bot-comment gate.
- Target failure modes (all four, confirmed): wrong size, missing/vague acceptance
  criteria, inconsistent structure, fluff/narrative bloat.

## Determinism bar

- "Deterministic" = structural/mechanical checks only (presence, min length,
  checklist item count, enum values). No dedicated LLM-judge pass run against
  every issue.
- Exception: when an LLM is *already* active (a Claude Code session about to
  create an issue via `gh issue create`), it can self-check — but even there,
  the check should be running the same mechanical validator, not an ad hoc
  LLM judgment call.

## Required fields (issue schema)

1. **Context** — what/why. Presence + min-length check (no max — see severity
   section for the max-length compromise).
2. **Acceptance Criteria** — must be a markdown checklist (`- [ ]`) with ≥1 non-empty item (a bare `- [ ]` prefill does not count).
3. **Out of Scope** — explicit non-goals, forces scoping to one slice.
4. **Size** — enum `XS/S/M/L/XL`. `L`/`XL` = too big for one agent run.

## Enforcement architecture

- **Layered**, two creation paths converge on the same rules:
  - **GitHub Issue Forms** (`.github/ISSUE_TEMPLATE/*.yml`) enforce required-field
    *presence* at submission time for manual/UI-created issues — GitHub itself
    won't accept an empty required field. This form is the **canonical source of
    truth** for the schema; no separate LLM-tuned template to keep in sync.
  - A **CI Action** (triggers on `issues: opened`/`edited` always, and on
    `labeled`/`unlabeled` only when a human touches the override or an
    `issue-quality:*` label — continuous, not one-shot) re-validates everything
    the form can't express: min length, checklist item count, Size blocking.
    This is the backstop for manual/UI issues and for edits after the fact. The
    gate writes its own labels as the CI bot; excluding the bot sender means
    those writes never re-trigger it (belt-and-suspenders over GitHub's own
    `GITHUB_TOKEN` recursion prevention and the diff-based no-op guard), while a
    human hand-editing a quality label re-runs the gate so manual changes
    self-heal.
  - **Claude Code / `gh` CLI path**: before calling `gh issue create`, the agent
    runs the *same shared validator script* locally as a pre-flight check. One
    script, invoked from both CI and the agent's pre-flight step — avoids two
    implementations of the rules drifting apart.

- **Unattended-loop enforcement chokepoint**: the loop only reads issues carrying
  the `Sandcastle` label. The CI Action strips/blocks `Sandcastle` on hard
  failures, so enforcement is structural (the loop can't see a failing issue),
  not a "please respect this flag" convention.

- **Manual-pickup enforcement**: relies on an *already-existing global* rule in
  `~/.dotfiles/claude/rules/issue-tracker.md` (applies to every repo the user
  works in): check for label `issue-quality:failing`, and if present, read the
  bot's checklist comment (author `github-actions`) and surface it. Reusing that
  **exact label name and comment-author convention** means second-brain (or any
  repo) gets manual-path enforcement for free, no new project-level CLAUDE.md
  instruction needed.
  - Response mode when the label is present: **surface the gaps and ask** the
    user whether to proceed — not a hard refusal. Manual sessions are sometimes
    exactly where a rough issue gets fleshed out together.

## Severity: errors vs warnings

- User's instruction mid-session: *"let the agent judge if the warning should be
  acted upon or not"* — some checks should warn, not hard-block.
- Landed on: **keep everything a hard error for now** (presence, min-length, AC
  checklist ≥1, Size L/XL blocks queue eligibility) — simplest mental model —
  **except** add a new **max-length check as warning-only** (a fluff detector
  that doesn't block, just gets flagged).
- **RESOLVED (superseded an earlier "shared label" decision): two separate
  labels.**
  - `issue-quality:failing` — hard block. Applied only when ≥1 hard-error check
    fails.
  - `issue-quality:warning` — non-blocking, informational, independently
    filterable (`gh issue list --label issue-quality:warning`). Applied when
    there are zero hard errors but ≥1 warning (e.g. max-length fluff flag).
  - Rationale: a label's real job is being a *filterable signal*, not "trigger
    reading the comment" — comments are always visible via normal
    `gh issue view --comments` regardless of label. "Issues that are blocked"
    and "issues with unresolved warnings" are genuinely different queries, so
    collapsing them into one label loses that.
  - Both labels get a bot comment (author `github-actions`) explaining what
    failed/what's flagged.
  - **Follow-up required**: the *global* `~/.dotfiles/claude/rules/issue-tracker.md`
    rule currently only mentions `issue-quality:failing`. It needs a one-line
    addition to also check for `issue-quality:warning`, so both are always
    surfaced regardless of which repo a session is in. Not done yet — noted as
    a required follow-up when this design is implemented.

## Rollout

- Gate applies **going forward only** — no retroactive audit/backfill pass over
  the existing open-issue backlog. Old untouched issues aren't touched until
  they're next edited or labeled.

## Universal / cross-repo design (session pivoted here)

Mid-session the user redirected: this shouldn't be second-brain-only, it should
be a **universal mechanism usable across all their repos**, with an opt-in per
repo. Resolved so far:

- **Distribution**: a new dedicated repo, **`orestes-dev/issue-quality-gate`**,
  publishes a reusable/composite GitHub Action containing the validator logic
  and CI workflow. Consuming repos add a thin workflow file that calls it — one
  place to fix bugs or change rules, every repo picks up updates on next run
  with no vendored copy to keep in sync (except see bootstrap note below).
- **Schema is fixed, not configurable per repo** — no workflow inputs, no
  `.issue-quality.yml` override file. One schema everywhere that opts in, so the
  global CLAUDE.md rule and the `issue-quality:failing` label convention mean
  the same thing in every repo without per-repo lookup.
- **Opt-in mechanic**: adding the thin per-repo workflow file *is* the opt-in —
  no separate flag or registry. Two files actually need to land in a consuming
  repo (GitHub requires Issue Forms to live in-repo, they can't be pulled from
  elsewhere at render time):
  1. The Issue Form YAML in that repo's `.github/ISSUE_TEMPLATE/`.
  2. The thin workflow file that calls the shared reusable Action.
- **Bootstrap method**: `issue-quality-gate` ships a setup CLI (e.g.
  `npx github:orestes-dev/issue-quality-gate init`) that drops both files into
  whatever repo it's run from. Repeatable, easy to re-run when the template
  changes, no manual copy-paste.
- **Agent-side opt-in detection**: the global CLAUDE.md rule
  (`~/.dotfiles/claude/rules/issue-tracker.md`) gets updated to check for the
  presence of the opt-in workflow file (e.g. `.github/workflows/issue-quality*.yml`)
  in the current repo. Same artifact signals both "CI enforcement is on" and
  "the agent should pre-flight-validate before `gh issue create`" — one file,
  one meaning, no separate marker.
- **Pre-flight validator invocation** (agent side, before `gh issue create`):
  `npx github:orestes-dev/issue-quality-gate validate <file>` — runs straight
  from the shared repo, no local install, always the latest published version.
  Assumes the repo is reachable at runtime (public, or ambient GitHub auth is
  present). The body file must mirror the Issue Form's `### ` section headings;
  the validator parses those, so a freeform draft reports every field missing.
- **Queue-label scope, RESOLVED**: the shared Action's entire job is
  applying/removing `issue-quality:failing` / `issue-quality:warning` and
  posting the comment. It does **not** know about or touch any repo-specific
  queue label (e.g. second-brain's `Sandcastle`). Each repo's own automation is
  responsible for separately checking `issue-quality:failing` before treating
  an issue as ready. This keeps the Action config-free (no per-repo label-name
  input) and decoupled from repo-specific queue mechanisms.
  - **Follow-up required for second-brain specifically**: `.sandcastle/`'s
    `plan.md` issue filter currently only reads the `Sandcastle` label. Once
    this gate exists, it needs to *also* check for absence of
    `issue-quality:failing` before picking up an issue — the shared Action will
    no longer strip `Sandcastle` itself. Not done yet.

## Action versioning

- Consuming repos' thin workflow files reference `orestes-dev/issue-quality-gate@main`,
  not a pinned tag/SHA. Rule/schema changes propagate to every opted-in repo
  immediately on next run — no per-repo bump step, accepting the risk that a bad
  change to the shared repo can affect issue creation everywhere at once.

## Open thread (not yet started)

Once this design is fleshed out further (actual Issue Form field syntax, the
validator's rule implementation, the reusable workflow YAML, the setup CLI),
**compare it against `food`'s existing `issue-quality:failing` implementation**
— explicitly deferred, not to be done yet. The point of building from first
principles here was to re-derive the idea independently before reconciling with
what already exists in `food`.

## Post-comparison decisions (resolved)

The `food` comparison is done. It surfaced robustness lessons (API fetch over
stale event payload, per-issue concurrency, `unlabeled` trigger, pre-created
label colors, comment removed on clean pass) that were folded in, plus two
design calls that were reviewed and resolved, superseding earlier notes above:

1. **Override escape hatch: added.** The `override:issue-quality` label plus a
   non-empty `## Override rationale` section bypasses the gate (strips all
   quality labels and the comment). The label alone, without a rationale, does
   not bypass; it raises a warning so the "why" is never skipped.
2. **Explicit `issue-quality:pass` label: added.** A clean issue now carries
   `issue-quality:pass`, so "explicitly validated" is a queryable state. This
   supersedes the "clean carries neither label" note in the severity section:
   there are now three mutually-exclusive labels (pass / warning / failing),
   only the latter two carrying a bot comment.
