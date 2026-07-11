// Deterministic, dependency-free validator. No LLM judgment: presence,
// min/max length, checklist item count, enum membership only.
//
// Parsing is done with plain string operations (no regex): the submitted issue
// body is a sequence of `### <label>` sections produced by the Issue Form.

import {
  FIELD,
  NO_RESPONSE,
  SIZES,
  BLOCKING_SIZES,
  MIN_LENGTH,
  MAX_LENGTH,
  LABEL,
  OVERRIDE_HEADING,
} from './schema.js';

// Checklist item prefixes we accept, matching GitHub's task-list rendering:
// any of the `-`/`*`/`+` bullets, checked (`[x]`/`[X]`) or unchecked (`[ ]`).
const BULLETS = ['-', '*', '+'];
const BOXES = ['[ ]', '[x]', '[X]'];
const CHECKLIST_PREFIXES = BULLETS.flatMap((bullet) =>
  BOXES.map((box) => `${bullet} ${box}`),
);

// The only headings that delimit a section. GitHub renders each Issue Form
// field label as `### <label>`; the override rationale is a hand-written
// `## Override rationale`. Restricting boundaries to this set means arbitrary
// headings or fenced code blocks *inside* a field (e.g. a shell `## comment`
// pasted into Context) no longer mis-split the body.
const KNOWN_HEADINGS = new Set([...Object.values(FIELD), OVERRIDE_HEADING]);

// Return the heading text of a markdown h2/h3 line (`## ` or `### `), or null.
function parseHeading(line) {
  let hashes = 0;
  while (hashes < line.length && line[hashes] === '#') hashes += 1;
  if (hashes < 2 || line[hashes] !== ' ') return null;
  return line.slice(hashes + 1).trim();
}

// Split a submitted issue body into a { heading: text } map. Only the known
// schema headings act as section boundaries; every other line is content.
export function parseSections(body) {
  const sections = {};
  let current = null;
  let buffer = [];

  const flush = () => {
    if (current !== null) sections[current] = buffer.join('\n').trim();
  };

  for (const rawLine of String(body ?? '').split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    const heading = parseHeading(line);
    if (heading !== null && KNOWN_HEADINGS.has(heading)) {
      flush();
      current = heading;
      buffer = [];
      continue;
    }
    if (current !== null) buffer.push(line);
  }
  flush();
  return sections;
}

// True when the body carries a non-empty `## Override rationale` section.
export function hasOverrideRationale(body) {
  const sections = parseSections(body);
  const rationale = sections[OVERRIDE_HEADING];
  return typeof rationale === 'string' && rationale.trim().length > 0;
}

// A field is "present" when it has non-empty content that is not the
// Issue Form's placeholder for an empty response.
function fieldValue(sections, heading) {
  const raw = sections[heading];
  if (raw === undefined) return '';
  const trimmed = raw.trim();
  if (trimmed === NO_RESPONSE) return '';
  return trimmed;
}

// Count checklist items that carry actual text. A bare `- [ ]` (the Issue
// Form's prefill) is not a verifiable outcome, so it does not count.
function countChecklistItems(text) {
  let count = 0;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    const prefix = CHECKLIST_PREFIXES.find((p) => line.startsWith(p));
    if (prefix === undefined) continue;
    if (line.slice(prefix.length).trim().length > 0) count += 1;
  }
  return count;
}

// Validate a submitted issue body.
// Returns { errors: string[], warnings: string[], size: string|null }.
export function validate(body) {
  const sections = parseSections(body);
  const errors = [];
  const warnings = [];

  // Prose fields: presence + min-length (hard), max-length (warning).
  for (const heading of [FIELD.CONTEXT, FIELD.OUT_OF_SCOPE]) {
    const value = fieldValue(sections, heading);
    if (value === '') {
      errors.push(`**${heading}** is missing or empty.`);
      continue;
    }
    const min = MIN_LENGTH[heading];
    if (min && value.length < min) {
      errors.push(
        `**${heading}** is too short (${value.length} chars, need at least ${min}).`,
      );
    }
    const max = MAX_LENGTH[heading];
    if (max && value.length > max) {
      warnings.push(
        `**${heading}** is long (${value.length} chars, over ${max}); trim narrative bloat.`,
      );
    }
  }

  // Acceptance Criteria: a checklist with at least one item (hard).
  const ac = fieldValue(sections, FIELD.ACCEPTANCE_CRITERIA);
  if (ac === '') {
    errors.push(`**${FIELD.ACCEPTANCE_CRITERIA}** is missing or empty.`);
  } else if (countChecklistItems(ac) < 1) {
    errors.push(
      `**${FIELD.ACCEPTANCE_CRITERIA}** must contain at least one checklist item (\`- [ ]\`).`,
    );
  }

  // Size: enum membership (hard) + L/XL blocks queue eligibility (hard).
  const size = fieldValue(sections, FIELD.SIZE) || null;
  if (size === null) {
    errors.push(`**${FIELD.SIZE}** is missing.`);
  } else if (!SIZES.includes(size)) {
    errors.push(`**${FIELD.SIZE}** must be one of ${SIZES.join(', ')}.`);
  } else if (BLOCKING_SIZES.includes(size)) {
    errors.push(
      `**${FIELD.SIZE}** is ${size}, too big for a single agent run. Split it into smaller issues.`,
    );
  }

  return { errors, warnings, size };
}

// Which mutually-exclusive quality label the result implies.
export function labelFor({ errors, warnings }) {
  if (errors.length > 0) return LABEL.FAILING;
  if (warnings.length > 0) return LABEL.WARNING;
  return LABEL.PASS;
}
