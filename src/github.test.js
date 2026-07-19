import { test } from "node:test";
import assert from "node:assert/strict";

import { GitHub, ApiUnavailableError } from "./github.js";

// A fake fetch driven by a queue of scripted outcomes. Each entry is either a
// response spec `{ status, body }` or an Error to throw (a network/timeout
// fault). `calls` counts invocations so a test can assert retry vs no-retry.
function fakeFetch(script) {
  const state = { calls: 0 };
  const fetch = async () => {
    const step = script[state.calls];
    state.calls += 1;
    if (step instanceof Error) throw step;
    return {
      ok: step.status < 400,
      status: step.status,
      json: async () => step.body ?? {},
    };
  };
  return { fetch, state };
}

// Zero backoff keeps the retry tests instant; three attempts matches the default.
function client(fetch) {
  return new GitHub({
    token: "t",
    owner: "o",
    repo: "r",
    fetchImpl: fetch,
    retryAttempts: 3,
    retryBackoffMs: 0,
  });
}

test("a 5xx that clears within the window resolves without failing", async () => {
  const { fetch, state } = fakeFetch([
    { status: 503 },
    { status: 502 },
    { status: 200, body: { number: 7, user: { login: "octocat" } } },
  ]);
  const pr = await client(fetch).getPullRequest(7);
  assert.equal(pr.number, 7);
  assert.equal(pr.author, "octocat");
  assert.equal(state.calls, 3, "should retry twice then succeed");
});

test("a persistent 5xx throws ApiUnavailableError carrying the status", async () => {
  const { fetch, state } = fakeFetch([
    { status: 503 },
    { status: 503 },
    { status: 503 },
  ]);
  await assert.rejects(client(fetch).getPullRequest(7), (err) => {
    assert.ok(err instanceof ApiUnavailableError);
    assert.equal(err.status, 503);
    return true;
  });
  assert.equal(state.calls, 3, "should exhaust exactly retryAttempts attempts");
});

test("a 4xx fails immediately with no retry", async () => {
  const { fetch, state } = fakeFetch([{ status: 404 }]);
  await assert.rejects(client(fetch).getPullRequest(7), (err) => {
    assert.ok(!(err instanceof ApiUnavailableError), "4xx is not an outage");
    assert.match(err.message, /Failed to fetch pull request: 404/);
    return true;
  });
  assert.equal(state.calls, 1, "a 4xx must not be retried");
});

test("a network error retries then succeeds", async () => {
  const { fetch, state } = fakeFetch([
    new Error("ECONNRESET"),
    { status: 200, body: { number: 9 } },
  ]);
  const issue = await client(fetch).getIssue(9);
  assert.equal(issue.number, 9);
  assert.equal(state.calls, 2);
});

test("a persistent network error throws ApiUnavailableError with null status", async () => {
  const { fetch } = fakeFetch([
    new Error("timeout"),
    new Error("timeout"),
    new Error("timeout"),
  ]);
  await assert.rejects(client(fetch).getIssue(9), (err) => {
    assert.ok(err instanceof ApiUnavailableError);
    assert.equal(err.status, null);
    return true;
  });
});

test("getIssue surfaces a persistent 5xx as an outage, not a rule failure", async () => {
  const { fetch } = fakeFetch([
    { status: 500 },
    { status: 500 },
    { status: 500 },
  ]);
  await assert.rejects(
    client(fetch).getIssue(3),
    (err) => err instanceof ApiUnavailableError && err.status === 500,
  );
});

test("a paginated read (#paginate) retries a 5xx on a page", async () => {
  const { fetch, state } = fakeFetch([
    { status: 503 },
    {
      status: 200,
      body: [{ sha: "abc", commit: { message: "feat: x\n\nbody" } }],
    },
  ]);
  const commits = await client(fetch).getPullRequestCommits(7);
  assert.deepEqual(commits, [{ sha: "abc", subject: "feat: x" }]);
  assert.equal(state.calls, 2);
});

// A fetch that records each request (method + path suffix + parsed body) and
// replies from a queue, so ensureLabel's create/repair/ok branches can be
// asserted by what it wrote, not just the return value.
function recordingFetch(script) {
  const requests = [];
  const state = { calls: 0 };
  const fetch = async (url, init) => {
    requests.push({
      method: init.method,
      url,
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    const step = script[state.calls];
    state.calls += 1;
    return {
      ok: step.status < 400,
      status: step.status,
      json: async () => step.body ?? {},
    };
  };
  return { fetch, requests, state };
}

test("ensureLabel creates a missing label (404 then POST)", async () => {
  const { fetch, requests } = recordingFetch([
    { status: 404 },
    { status: 201 },
  ]);
  const result = await client(fetch).ensureLabel("gate:x", "0e8a16", "desc");
  assert.equal(result, "created");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[1].method, "POST");
  assert.deepEqual(requests[1].body, {
    name: "gate:x",
    color: "0e8a16",
    description: "desc",
  });
});

test("ensureLabel treats a 422 on create (a racing run) as success", async () => {
  const { fetch } = recordingFetch([{ status: 404 }, { status: 422 }]);
  const result = await client(fetch).ensureLabel("gate:x", "0e8a16", "desc");
  assert.equal(result, "created");
});

test("ensureLabel repairs a drifted label (PATCHes color/description)", async () => {
  const { fetch, requests } = recordingFetch([
    { status: 200, body: { color: "cccccc", description: "old" } },
    { status: 200 },
  ]);
  const result = await client(fetch).ensureLabel("gate:x", "0e8a16", "new");
  assert.equal(result, "repaired");
  assert.equal(requests.length, 2);
  assert.equal(requests[1].method, "PATCH");
  assert.deepEqual(requests[1].body, { color: "0e8a16", description: "new" });
});

test("ensureLabel leaves a matching label untouched (no second write)", async () => {
  const { fetch, requests } = recordingFetch([
    { status: 200, body: { color: "0e8a16", description: "desc" } },
  ]);
  const result = await client(fetch).ensureLabel("gate:x", "0e8a16", "desc");
  assert.equal(result, "ok");
  assert.equal(requests.length, 1, "a matching label must not be rewritten");
});

test("ensureLabel ignores color case and a null description when comparing", async () => {
  const { fetch, requests } = recordingFetch([
    { status: 200, body: { color: "0E8A16", description: null } },
  ]);
  const result = await client(fetch).ensureLabel("gate:x", "0e8a16", "");
  assert.equal(result, "ok");
  assert.equal(requests.length, 1);
});
