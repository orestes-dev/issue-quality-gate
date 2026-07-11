// The RULES the gate enforces plus the fixed labels/statuses it applies.
//
// STRUCTURE (which fields exist, their headings, whether they are required, and
// any dropdown options) is NOT here: it is owned by the Issue Form
// (`.github/ISSUE_TEMPLATE/task.yml`) and derived from it at runtime by
// `form.js`. This module owns only what the form cannot express — the RULES —
// keyed by field `id` and joined to the structure in the validator.

// Constraints the Issue Form cannot express, keyed by field `id` (the form's
// element id, stable across heading renames). The validator joins these onto
// the template-derived structure; a rule for an unknown field, or a field with
// no rule, fails the bijection test. Every number here is restated in the
// README's human-readable bar and guarded by a drift test.
//
//   minLength / maxLength  prose length floor (hard) / ceiling (warning)
//   checklist / minItems   require a markdown checklist with N non-empty items
//   blocking               dropdown options too large to land as one issue
export const RULES = {
  context: { minLength: 30, maxLength: 1500 },
  'acceptance-criteria': { checklist: true, minItems: 1 },
  'out-of-scope': { minLength: 10 },
  size: { blocking: ['L', 'XL'] },
};

// GitHub renders an empty optional field as this literal. Treat it as absent.
export const NO_RESPONSE = '_No response_';

// Per-check outcome, worst-wins across a field's rules. The scorecard comment
// renders one line per check with an icon derived from this; the mutually
// exclusive label reflects the worst status across all checks.
export const STATUS = { PASS: 'pass', WARN: 'warn', FAIL: 'fail' };

// Labels applied by the gate. Mutually exclusive.
export const LABEL = {
  FAILING: 'issue-quality:failing',
  WARNING: 'issue-quality:warning',
  PASS: 'issue-quality:pass',
};

// Metadata so the gate can create the labels with intentional colors and
// descriptions rather than letting GitHub auto-create them gray and blank.
export const LABEL_META = {
  [LABEL.FAILING]: {
    color: 'd93f0b',
    description: 'Issue has failing quality checks; not ready for pickup',
  },
  [LABEL.WARNING]: {
    color: 'fbca04',
    description: 'Issue passes but has non-blocking quality warnings',
  },
  [LABEL.PASS]: {
    color: '0e8a16',
    description: 'Issue meets all quality checks',
  },
};

// Manual escape hatch. Setting this label AND writing a non-empty
// `## Override rationale` section in the issue body bypasses the gate.
export const OVERRIDE_LABEL = 'override:issue-quality';
export const OVERRIDE_HEADING = 'Override rationale';

// Marker embedded in the bot comment so it can be found and updated in place.
export const COMMENT_MARKER = '<!-- issue-quality-gate -->';
