import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash } from "node:crypto";

import { fetchChecksumed } from "../command/bootstrap_caterer.mjs";

// A local server so the test needs nothing from the network.
async function serve(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, url: `http://127.0.0.1:${port}/asset` };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("a bootstrap download recovers from a transient network failure", async () => {
  // The runner lost the connection on the first two attempts. A download
  // that gives up on the first hiccup takes the whole CI run with it.
  let calls = 0;
  const { server, url } = await serve((req, res) => {
    calls += 1;
    if (calls < 3) {
      res.destroy();
      return;
    }
    res.end("payload");
  });
  try {
    const bytes = await fetchChecksumed(url, sha256("payload"), { attempts: 3, backoffMs: 1 });
    assert.equal(bytes.toString(), "payload");
    assert.equal(calls, 3);
  } finally {
    server.close();
  }
});

test("a bootstrap download gives up when the failure is permanent", async () => {
  // A server that always fails must not be retried forever, and the error
  // must say what went wrong rather than that some attempt failed.
  let calls = 0;
  const { server, url } = await serve((req, res) => {
    calls += 1;
    res.statusCode = 500;
    res.end("no");
  });
  try {
    await assert.rejects(
      () => fetchChecksumed(url, sha256("payload"), { attempts: 2, backoffMs: 1 }),
      /download failed 500/u
    );
    assert.equal(calls, 2);
  } finally {
    server.close();
  }
});

test("a bootstrap download refuses a body that does not match the checksum", async () => {
  // The checksum is what makes a retry safe: a wrong body never passes.
  const { server, url } = await serve((req, res) => res.end("tampered"));
  try {
    await assert.rejects(
      () => fetchChecksumed(url, sha256("payload"), { attempts: 1, backoffMs: 1 }),
      /checksum mismatch/u
    );
  } finally {
    server.close();
  }
});
