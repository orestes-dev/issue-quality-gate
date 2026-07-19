import { test } from "node:test";
import assert from "node:assert/strict";

import { GATE_LABELS, ensureGateLabels } from "./init.js";
import {
  OVERRIDE_LABEL,
  PR_OVERRIDE_LABEL,
  COMMIT_OVERRIDE_LABEL,
} from "../constants.js";

// The fixed schema is the three gate triples plus the three override labels.
test("GATE_LABELS is the full fixed schema, override labels included", () => {
  assert.equal(GATE_LABELS.length, 12);
  const names = GATE_LABELS.map((l) => l.name);
  for (const override of [
    OVERRIDE_LABEL,
    PR_OVERRIDE_LABEL,
    COMMIT_OVERRIDE_LABEL,
  ]) {
    assert.ok(names.includes(override), `missing ${override}`);
  }
  for (const { color, description } of GATE_LABELS) {
    assert.match(color, /^[0-9a-f]{6}$/, "each label carries a hex color");
    assert.ok(description.length > 0, "each label carries a description");
  }
});

// A client stub whose ensureLabel returns a scripted per-name verdict, so the
// reporting can be asserted without a network.
function fakeClient(verdicts) {
  const calls = [];
  return {
    calls,
    async ensureLabel(name, color, description) {
      calls.push({ name, color, description });
      return verdicts[name] ?? "ok";
    },
  };
}

test("ensureGateLabels reports created / repaired / ok per label", async () => {
  const client = fakeClient({
    [OVERRIDE_LABEL]: "created",
    [PR_OVERRIDE_LABEL]: "repaired",
  });
  const lines = [];
  await ensureGateLabels({ client, log: (l) => lines.push(l) });

  assert.equal(client.calls.length, GATE_LABELS.length);
  assert.ok(
    lines.some((l) => l.startsWith("created") && l.includes(OVERRIDE_LABEL)),
  );
  assert.ok(
    lines.some(
      (l) => l.startsWith("repaired") && l.includes(PR_OVERRIDE_LABEL),
    ),
  );
  assert.ok(lines.some((l) => l.startsWith("ok")));
});

test("ensureGateLabels skips (no write) when there are no credentials", async () => {
  const lines = [];
  await ensureGateLabels({ client: null, log: (l) => lines.push(l) });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^skip\s+labels \(no GitHub credentials/);
});
