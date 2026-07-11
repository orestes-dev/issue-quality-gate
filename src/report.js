// Human-readable rendering of a validation result, shared by the CI bot
// comment and the pre-flight CLI output.

import { COMMENT_MARKER } from './schema.js';

const PASS_HEADER = '## ✅ Issue quality gate passed';
const WARN_HEADER = '## ⚠️ Issue quality gate: warnings';
const FAIL_HEADER = '## ❌ Issue quality gate failed';

function bulletList(items) {
  return items.map((item) => `- ${item}`).join('\n');
}

// Markdown body for the bot comment. Includes the hidden marker so the comment
// can be located and updated in place on later runs.
export function renderComment({ errors, warnings }) {
  const lines = [COMMENT_MARKER];

  if (errors.length > 0) {
    lines.push(FAIL_HEADER, '');
    lines.push('These must be fixed before the issue is ready:', '');
    lines.push(bulletList(errors));
  } else if (warnings.length > 0) {
    lines.push(WARN_HEADER, '');
    lines.push('Non-blocking, but worth addressing:', '');
    lines.push(bulletList(warnings));
  } else {
    lines.push(PASS_HEADER, '');
    lines.push('This issue meets the structural quality bar.');
  }

  if (errors.length > 0 && warnings.length > 0) {
    lines.push('', '### Warnings', '');
    lines.push(bulletList(warnings));
  }

  return lines.join('\n');
}

// Plain-text report for terminal / CLI output.
export function renderCli({ errors, warnings }) {
  const lines = [];
  if (errors.length > 0) {
    lines.push('Issue quality gate: FAILED');
    for (const error of errors) lines.push(`  error:   ${strip(error)}`);
  } else {
    lines.push('Issue quality gate: passed');
  }
  for (const warning of warnings) lines.push(`  warning: ${strip(warning)}`);
  return lines.join('\n');
}

// Drop markdown bold markers for terminal readability.
function strip(text) {
  return text.split('**').join('');
}
