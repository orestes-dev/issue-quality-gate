// Structural validator for a pull request. PR structure is defined here in code
// (the source of truth), not parsed from Markdown at runtime; the
// `.github/PULL_REQUEST_TEMPLATE.md` is drift-tested against `PR_SECTIONS`. The
// gate checks presence only, never conformance: a required section must be
// present and non-empty, and the title must follow Conventional Commits.

import { check, checkTitle, parseSections } from "./validator.js";
import { STATUS, OVERRIDE_HEADING } from "./constants.js";

/** @typedef {import('./validator.js').Check} Check */
/** @typedef {import('./validator.js').Scorecard} Scorecard */

/**
 * One section of the PR body: its `##`/`###` heading and whether the gate
 * requires it. `required: false` sections (Divergence) are pinned by the drift
 * test but not enforced for presence in this slice.
 * @typedef {object} PrSection
 * @property {string} heading - The rendered section heading.
 * @property {boolean} required - Whether the gate enforces its presence.
 */

/**
 * The PR structure descriptor: the source of truth the Markdown template is
 * drift-tested against. Summary and Verification are required; Divergence is
 * present in the template but its conditional-rationale rule is a later slice,
 * so it is `required: false` and not enforced here.
 * @type {PrSection[]}
 */
export const PR_SECTIONS = [
  { heading: "Summary", required: true },
  { heading: "Verification", required: true },
  { heading: "Divergence", required: false },
];

// Headings that delimit a PR section when parsing the body: every declared
// section plus the override heading, so an override rationale isn't swallowed
// into the preceding section.
const PR_HEADINGS = new Set([
  ...PR_SECTIONS.map((s) => s.heading),
  OVERRIDE_HEADING,
]);

/**
 * Presence check for one required section: present and non-empty passes, absent
 * or empty is a hard error (the PR gate hard-fails CI on any error).
 * @param {Record<string, string>} sections
 * @param {PrSection} section
 * @returns {Check}
 */
function checkSection(sections, { heading }) {
  const value = (sections[heading] ?? "").trim();
  const key = heading.toLowerCase();
  if (value === "") {
    return check(key, heading, STATUS.FAIL, "missing or empty");
  }
  return check(key, heading, STATUS.PASS, `present (${value.length} chars)`);
}

/**
 * Validate a PR body and title into a scorecard: the Conventional Commits title
 * check leads, followed by one presence check per required section, in template
 * order.
 * @param {string} body - The PR description.
 * @param {string} [title] - The PR title; absent is treated as an empty (failing) title.
 * @returns {Scorecard}
 */
export function validatePr(body, title = "") {
  const sections = parseSections(body, PR_HEADINGS);
  const checks = [
    checkTitle(title),
    ...PR_SECTIONS.filter((s) => s.required).map((s) =>
      checkSection(sections, s),
    ),
  ];
  return { checks };
}
