// CI entry point. Invoked by the composite action on issues:{opened,edited,
// labeled,unlabeled}. Fetches the issue fresh from the API, validates its body,
// reconciles the two mutually-exclusive quality labels, and keeps a single bot
// comment in sync.
//
// Every write is diff-based and idempotent: a re-run that finds the issue
// already in the correct state performs no writes, so the label triggers do not
// cause an event loop.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { validate, labelFor, hasOverrideRationale } from './validator.js';
import { renderComment } from './report.js';
import {
  LABEL,
  LABEL_META,
  COMMENT_MARKER,
  OVERRIDE_LABEL,
  OVERRIDE_HEADING,
} from './schema.js';
import { GitHub } from './github.js';

const ALL_QUALITY_LABELS = [LABEL.FAILING, LABEL.WARNING, LABEL.PASS];

// The gate's own comment carries a hidden marker so it can be located and
// updated in place. Exactly one such comment ever exists per issue. The author
// must be a bot: a human who pastes the marker into their own comment must not
// have it adopted (updated or deleted) by the gate.
const isGateComment = (c) =>
  c.user?.type === 'Bot' && c.body?.includes(COMMENT_MARKER);

function loadEvent() {
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path) throw new Error('GITHUB_EVENT_PATH is not set.');
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Drive the issue to carry exactly `desiredLabel` (or none if null) out of the
// mutually-exclusive quality set. Diff-based: no-ops when already correct.
//
// Add before remove: GitHub has no atomic add-and-remove delta call (only a
// full-set PUT, which would clobber concurrent unrelated-label edits). Adding
// the desired label first means an interrupted run — `cancel-in-progress` can
// kill it between calls — leaves the issue over-labeled rather than with no
// quality label at all, which is more visible and self-corrects on the next run.
async function reconcileLabels(gh, issueNumber, currentLabels, desiredLabel) {
  const current = new Set(currentLabels);

  if (desiredLabel && !current.has(desiredLabel)) {
    const meta = LABEL_META[desiredLabel];
    await gh.ensureLabel(desiredLabel, meta.color, meta.description);
    await gh.addLabels(issueNumber, [desiredLabel]);
  }

  const toRemove = ALL_QUALITY_LABELS.filter(
    (label) => label !== desiredLabel && current.has(label),
  );
  for (const label of toRemove) await gh.removeLabel(issueNumber, label);
}

async function deleteGateComment(gh, issueNumber) {
  const existing = await gh.findComment(issueNumber, isGateComment);
  if (existing) await gh.deleteComment(existing.id);
}

async function syncComment(gh, issueNumber, result) {
  const existing = await gh.findComment(issueNumber, isGateComment);

  // Clean pass carries no label, so it carries no comment either. Remove a
  // stale one left over from a previous failing/warning state.
  const clean = result.errors.length === 0 && result.warnings.length === 0;
  if (clean) {
    if (existing) await gh.deleteComment(existing.id);
    return;
  }

  const bodyText = renderComment(result);
  if (!existing) {
    await gh.createComment(issueNumber, bodyText);
    return;
  }
  // Only rewrite when the content actually changed, to avoid comment churn.
  if (existing.body.trim() !== bodyText.trim()) {
    await gh.updateComment(existing.id, bodyText);
  }
}

// Core gate logic, decoupled from process env so it can be driven with an
// injected GitHub client and event payload in tests. Returns a short status
// string for logging.
export async function run({ gh, event }) {
  const eventIssue = event.issue;
  if (!eventIssue) throw new Error('Event payload has no issue.');

  // Fetch fresh: the event payload's body/labels can be stale on edited/labeled.
  const issue = await gh.getIssue(eventIssue.number);
  const body = issue.body || '';
  const currentLabels = (issue.labels || []).map((l) =>
    typeof l === 'string' ? l : l.name,
  );

  // Manual override: the label plus a written rationale bypasses the gate. Strip
  // every quality label and the gate comment, then stop.
  if (currentLabels.includes(OVERRIDE_LABEL) && hasOverrideRationale(body)) {
    await reconcileLabels(gh, issue.number, currentLabels, null);
    await deleteGateComment(gh, issue.number);
    return `issue #${issue.number}: overridden`;
  }

  const result = validate(body);

  // Override intent signalled but incomplete: nudge the author to write why.
  if (currentLabels.includes(OVERRIDE_LABEL) && !hasOverrideRationale(body)) {
    result.warnings.push(
      `\`${OVERRIDE_LABEL}\` is set but there is no \`## ${OVERRIDE_HEADING}\` section; the gate still applies.`,
    );
  }

  const desiredLabel = labelFor(result);
  await reconcileLabels(gh, issue.number, currentLabels, desiredLabel);
  await syncComment(gh, issue.number, result);

  if (result.errors.length > 0) {
    return `issue #${issue.number}: failing (${result.errors.length} error(s))`;
  }
  if (result.warnings.length > 0) {
    return `issue #${issue.number}: warning (${result.warnings.length} warning(s))`;
  }
  return `issue #${issue.number}: passing`;
}

async function main() {
  const [owner, repo] = (process.env.GITHUB_REPOSITORY || '').split('/');
  const gh = new GitHub({
    token: process.env.GITHUB_TOKEN,
    apiUrl: process.env.GITHUB_API_URL,
    owner,
    repo,
  });
  const summary = await run({ gh, event: loadEvent() });
  console.log(summary);
}

// Only run as a CLI when invoked directly, not when imported by tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
