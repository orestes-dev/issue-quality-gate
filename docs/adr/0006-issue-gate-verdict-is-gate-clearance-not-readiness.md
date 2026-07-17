# Issue-gate verdict is gate clearance, a legibility floor, not readiness

The issue gate's verdict means the issue is **legible**: it meets a minimum of
structure and substance to be worth documenting. It does not mean the issue is
ready to implement. The CONTEXT.md glossary term for the `issue-quality:*` union
is renamed from **Readiness** to **Gate clearance**; the label strings are
unchanged.

"Readiness" overstated the verdict. It read as "cleared for a consumer to pick
up," but the gate judges legibility only. Whether a design is settled and the
work is pickable is a separate, downstream decision (a consumer's own
`ready-to-implement` label, defined in the consumer's agent rules) that the gate
never evaluates. Conflating the two let a consumer treat a merely-legible but
under-specified issue as ready to start, and it collided with the consumer's own
`ready-to-implement` signal on the word "ready."

## Relationship to ADR 0005

ADR 0005 moved the PR gate's labels to the `pr-readiness` namespace, justified
by two points: the PR gate decides readiness-to-merge (primary), and "readiness"
already named the sibling issue property in CONTEXT.md (secondary). This ADR
renames that sibling property, so the secondary justification no longer holds.
The primary one stands: the PR gate genuinely hard-fails CI and blocks merge, so
"cleared to merge" is a real readiness verdict it makes. `pr-readiness:*`,
`override:pr-readiness`, and the "PR Readiness Checklist" scorecard are unchanged.
0005's decision stands; only its secondary rationale is superseded.

## Considered options

Renaming the PR gate too (e.g. `pr-quality` or `pr-clearance`) for symmetry with
the issue side was rejected. The PR gate really does decide readiness-to-merge,
so "readiness" is accurate there; renaming a minted label namespace is a breaking
change across consumers for no semantic gain. This mirrors 0005's own reasoning
that symmetry with a misleading name is not a virtue: here, symmetry would
introduce a misleading name rather than remove one.

Keeping "Readiness" for the issue side was rejected: it names a downstream
decision the gate does not make, and it overloads "ready," which the consumer's
`ready-to-implement` signal owns.

## Consequences

- **No label change.** `issue-quality:pass` / `warning` / `failing`, the override
  label, and the positive-union query are unchanged, so consumer queries keep
  working. Only the glossary term and prose move.
- **The `issue-quality:failing` description changes** from "not ready for pickup"
  to "below the minimum structure and substance bar"; existing labels keep their
  old description until recreated on a fresh repo.
- **Issue-side "ready/readiness" becomes "clearance"** in CONTEXT.md, the README's
  "Consuming the gate's output" section, code comments, and the transitive-check
  identifiers (`CLEARED_LABELS`, `isIssueCleared`); "PR Readiness" and the
  `pr-readiness` namespace stay.
