// Derive the issue STRUCTURE from the GitHub Issue Form at runtime.
//
// The Issue Form (`.github/ISSUE_TEMPLATE/task.yml`) is the single source of
// truth for structure: each input field's id, heading (`label`), whether it is
// required, its type, and any dropdown options. `schema.js` owns the RULES the
// form cannot express; the validator joins the two on `id`.
//
// `yaml` is used ONLY here, ONLY to parse the form. The submitted issue body is
// still parsed with plain string ops in `validator.js`.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const HERE = dirname(fileURLToPath(import.meta.url));

// This action's OWN canonical Issue Form. The composite action runs from
// `$GITHUB_ACTION_PATH` (this checkout), so the structure is read from here, not
// from the consumer repo's copied form, which is UI-only. Resolved relative to
// this module so it is robust to the process working directory.
const FORM_PATH = resolve(HERE, '..', '.github', 'ISSUE_TEMPLATE', 'task.yml');

// The input element types a submitter fills in. A `type: markdown` block is
// intro prose with no id and no response, so it is not part of the structure.
const INPUT_TYPES = new Set(['input', 'textarea', 'dropdown']);

// Parse an Issue Form's YAML into an ordered list of input fields:
//   { id, label, required, type, options }[]
// Throw on a structurally unusable form (no body, no input fields, a field with
// no id or no label). This parser decides the schema for every issue on every
// consumer repo, so degrading to "no fields" — which would pass every issue
// unchecked — is never acceptable; fail loud instead.
export function parseForm(yamlText) {
  const doc = parse(yamlText);
  if (!doc || !Array.isArray(doc.body)) {
    throw new Error('Issue Form has no `body` list.');
  }

  const fields = doc.body
    .filter((el) => el && INPUT_TYPES.has(el.type))
    .map((el) => {
      const label = el.attributes?.label;
      if (!el.id) throw new Error(`Issue Form has a ${el.type} field with no id.`);
      if (!label) throw new Error(`Issue Form field "${el.id}" has no label.`);
      return {
        id: el.id,
        label,
        type: el.type,
        required: el.validations?.required === true,
        options: el.type === 'dropdown' ? (el.attributes?.options ?? []) : undefined,
      };
    });

  if (fields.length === 0) throw new Error('Issue Form has no input fields.');
  return fields;
}

// Parse this action's own canonical Issue Form into its structure.
export function loadForm() {
  return parseForm(readFileSync(FORM_PATH, 'utf8'));
}
