import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ensureMatrixCredentials } from "../program/agent/channels/bootstrap.mjs";

test("matrix bootstrap registers, logs in, and caches token", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-matrix-bootstrap-"));
  const agentHouse = path.join(root, "world", "house", "helper");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });

  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.endsWith("/_synapse/admin/v1/register") && (!opts.method || opts.method === "GET")) {
      return { ok: true, async json() { return { nonce: "nonce1" }; } };
    }
    if (url.endsWith("/_synapse/admin/v1/register") && opts.method === "POST") {
      return { ok: true, async json() { return { user_id: "@helper:example.org" }; } };
    }
    if (url.endsWith("/_matrix/client/v3/login")) {
      return {
        ok: true,
        async json() {
          return { access_token: "tok123", user_id: "@helper:example.org", device_id: "DEV1" };
        }
      };
    }
    throw new Error(`unexpected fetch url: ${url}`);
  };

  const first = await ensureMatrixCredentials({
    agentName: "helper",
    agentHouse,
    config: {
      homeserver: "https://matrix.example.org",
      registrationSharedSecret: "secret"
    },
    fetchImpl
  });
  assert.equal(first.token, "tok123");
  assert.equal(first.user, "@helper:example.org");
  assert.ok(calls.length >= 3);

  const callsAfterCache = [];
  const second = await ensureMatrixCredentials({
    agentName: "helper",
    agentHouse,
    config: { homeserver: "https://matrix.example.org" },
    fetchImpl: async (url, opts) => {
      callsAfterCache.push({ url, opts });
      throw new Error("should not fetch when cached");
    }
  });
  assert.equal(second.token, "tok123");
  assert.equal(callsAfterCache.length, 0);
});

