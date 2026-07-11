// Deterministic, dependency-free validator: presence, min/max length,
// checklist item count, enum membership only.
//
// Parsing is done with plain string operations (no regex): the submitted issue
// body is a sequence of `### <label>` sections produced by the Issue Form.

import { RULES, NO_RESPONSE, LABEL, STATUS, OVERRIDE_HEADING } from './schema.js';
import { loadForm } from './form.js';

// STRUCTURE derived from the Issue Form at module load: the ordered fields the
// gate checks, each `{ id, label, required, type, options }`. Joined to the
// RULES on `id` per field. Loaded once; a broken form throws here (fail loud)
// rather than silently degrading to "no checks".
const FIELDS = loadForm();

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
const KNOWN_HEADINGS = new Set([...FIELDS.map((f) => f.label), OVERRIDE_HEADING]);

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

// One check result. `key` is the field id; `label` is its rendered heading.
// `message` describes the outcome for its status (why it failed, or a short
// confirmation when it passed) and is rendered verbatim into the scorecard line.
const check = (key, label, status, message) => ({ key, label, status, message });

// Enum (dropdown) field: membership in the form's options, plus any RULES
// `blocking` values too large to land as one issue. Both hard.
function checkEnum(field, rule, value) {
  const { id, label, options } = field;
  if (!options.includes(value)) {
    return check(id, label, STATUS.FAIL, `must be one of ${options.join(', ')}`);
  }
  if ((rule?.blocking ?? []).includes(value)) {
    return check(
      id,
      label,
      STATUS.FAIL,
      `${value} is too big to land as one issue; split it into smaller issues`,
    );
  }
  return check(id, label, STATUS.PASS, value);
}

// Checklist field: at least `minItems` non-empty markdown checklist items.
function checkChecklist(field, rule, value) {
  const { id, label } = field;
  const items = countChecklistItems(value);
  if (items < (rule.minItems ?? 1)) {
    return check(id, label, STATUS.FAIL, 'must contain at least one checklist item (`- [ ]`)');
  }
  return check(id, label, STATUS.PASS, `${items} checklist item${items === 1 ? '' : 's'}`);
}

// Prose field: RULES `minLength` is hard; `maxLength` is a warning-only fluff
// detector. Worst status wins, so one line covers the field.
function checkProse(field, rule, value) {
  const { id, label } = field;
  const min = rule?.minLength;
  if (min && value.length < min) {
    return check(id, label, STATUS.FAIL, `too short (${value.length} chars, need at least ${min})`);
  }
  const max = rule?.maxLength;
  if (max && value.length > max) {
    return check(id, label, STATUS.WARN, `long (${value.length} chars, over ${max}); trim narrative bloat`);
  }
  return check(id, label, STATUS.PASS, `present (${value.length} chars)`);
}

// One field's check, additive: presence fires from the form's `required`, the
// remaining rules from the field's type and its joined RULES entry. A field
// that is absent-but-optional passes rather than hard-failing, so a future
// `required: false` field in the form correctly stops blocking on absence.
function checkField(sections, field, rule) {
  const { id, label, required, type } = field;
  const value = fieldValue(sections, label);
  if (value === '') {
    if (!required) return check(id, label, STATUS.PASS, 'optional; not provided');
    return check(id, label, STATUS.FAIL, type === 'dropdown' ? 'missing' : 'missing or empty');
  }
  if (type === 'dropdown') return checkEnum(field, rule, value);
  if (rule?.checklist) return checkChecklist(field, rule, value);
  return checkProse(field, rule, value);
}

// Validate a submitted issue body against the template-derived structure joined
// to the RULES. Returns a full per-check scorecard (one line per field, in form
// order) so the bot comment can show every check, pass included:
//   { checks: {key,label,status,message}[] }.
export function validate(body) {
  const sections = parseSections(body);
  const checks = FIELDS.map((field) => checkField(sections, field, RULES[field.id]));
  return { checks };
}

// Convenience predicates over a scorecard, so call sites need not know the
// STATUS strings.
export const failures = (checks) => checks.filter((c) => c.status === STATUS.FAIL);
export const warnings = (checks) => checks.filter((c) => c.status === STATUS.WARN);

// Which mutually-exclusive quality label the scorecard implies: worst wins.
export function labelFor({ checks }) {
  if (checks.some((c) => c.status === STATUS.FAIL)) return LABEL.FAILING;
  if (checks.some((c) => c.status === STATUS.WARN)) return LABEL.WARNING;
  return LABEL.PASS;
}
