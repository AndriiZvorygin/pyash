import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ensureMatrixCredentials, ensureMatrixExecutiveDmRoom } from "../program/agent/channels/bootstrap.mjs";

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

test("matrix bootstrap with explicit user is idempotent when user already exists", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-matrix-bootstrap-idempotent-"));
  const agentHouse = path.join(root, "world", "house", "helper");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });
  const cachedAuthPath = path.join(agentHouse, "conduct", "matrix-auth.json");
  await fs.writeFile(cachedAuthPath, JSON.stringify({
    homeserver: "https://matrix.example.org",
    user: "@helper:example.org",
    localpart: "helper",
    password: "pw0",
    accessToken: "",
    deviceId: "DEV0"
  }, null, 2));

  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.endsWith("/_synapse/admin/v1/register") && (!opts.method || opts.method === "GET")) {
      return { ok: true, async json() { return { nonce: "nonce1" }; } };
    }
    if (url.endsWith("/_synapse/admin/v1/register") && opts.method === "POST") {
      return {
        ok: false,
        status: 400,
        async json() {
          return { errcode: "M_USER_IN_USE", error: "User ID already taken." };
        }
      };
    }
    if (url.endsWith("/_matrix/client/v3/login")) {
      const payload = JSON.parse(String(opts.body ?? "{}"));
      assert.equal(payload?.identifier?.user, "@helper:example.org");
      assert.equal(payload?.password, "pw0");
      return {
        ok: true,
        async json() {
          return { access_token: "tok-new", user_id: "@helper:example.org", device_id: "DEV1" };
        }
      };
    }
    throw new Error(`unexpected fetch url: ${url}`);
  };

  const resolved = await ensureMatrixCredentials({
    agentName: "helper",
    agentHouse,
    config: {
      homeserver: "https://matrix.example.org",
      user: "@helper:example.org",
      registrationSharedSecret: "secret"
    },
    fetchImpl
  });
  assert.equal(resolved.user, "@helper:example.org");
  assert.equal(resolved.token, "tok-new");
  const postText = await fs.readFile(cachedAuthPath, "utf8");
  const post = JSON.parse(postText);
  assert.equal(post.user, "@helper:example.org");
  assert.equal(post.localpart, "helper");
  assert.equal(post.accessToken, "tok-new");
});

test("matrix bootstrap recovers cached token user via whoami when user is missing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-matrix-bootstrap-whoami-"));
  const agentHouse = path.join(root, "world", "house", "helper");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });
  const cachedAuthPath = path.join(agentHouse, "conduct", "matrix-auth.json");
  await fs.writeFile(cachedAuthPath, JSON.stringify({
    homeserver: "https://matrix.example.org",
    user: null,
    accessToken: "tok-cached",
    executiveDmRooms: {
      "@andrii:matrix.example.org": "!dm:matrix.example.org"
    }
  }, null, 2));

  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.endsWith("/_matrix/client/v3/account/whoami")) {
      return {
        ok: true,
        async json() {
          return { user_id: "@helper:matrix.example.org" };
        }
      };
    }
    throw new Error(`unexpected fetch url: ${url}`);
  };

  const resolved = await ensureMatrixCredentials({
    agentName: "helper",
    agentHouse,
    config: { homeserver: "https://matrix.example.org" },
    fetchImpl
  });
  assert.equal(resolved.token, "tok-cached");
  assert.equal(resolved.user, "@helper:matrix.example.org");
  assert.deepEqual(resolved.executiveDmRooms, {
    "@andrii:matrix.example.org": "!dm:matrix.example.org"
  });

  const persisted = JSON.parse(await fs.readFile(cachedAuthPath, "utf8"));
  assert.equal(persisted.user, "@helper:matrix.example.org");
  assert.equal(calls.length, 1);
});

test("matrix executive dm bootstrap reuses m.direct room when present", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-matrix-executive-dm-existing-"));
  const agentHouse = path.join(root, "world", "house", "helper");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });

  const calls = [];
  const roomId = "!dmexisting:example.org";
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.includes("/account_data/m.direct")) {
      return {
        ok: true,
        async json() {
          return {
            "@admin:matrix.liberit.ca": [roomId]
          };
        }
      };
    }
    throw new Error(`unexpected fetch url: ${url}`);
  };

  const resolved = await ensureMatrixExecutiveDmRoom({
    agentHouse,
    homeserver: "https://matrix.liberit.ca",
    token: "tok",
    user: "@helper:matrix.liberit.ca",
    executiveUser: "@admin:matrix.liberit.ca",
    fetchImpl
  });
  assert.equal(resolved, roomId);
  assert.equal(calls.length, 1);
});

test("matrix executive dm bootstrap creates room and normalizes executive username", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-matrix-executive-dm-create-"));
  const agentHouse = path.join(root, "world", "house", "helper");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });

  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.includes("/account_data/m.direct")) {
      return {
        ok: true,
        async json() {
          return {};
        }
      };
    }
    if (url.endsWith("/_matrix/client/v3/createRoom")) {
      const payload = JSON.parse(String(opts.body ?? "{}"));
      assert.deepEqual(payload.invite, ["@xr12p:matrix.liberit.ca"]);
      assert.equal(payload.is_direct, true);
      return {
        ok: true,
        async json() {
          return { room_id: "!newdm:matrix.liberit.ca" };
        }
      };
    }
    throw new Error(`unexpected fetch url: ${url}`);
  };

  const resolved = await ensureMatrixExecutiveDmRoom({
    agentHouse,
    homeserver: "https://matrix.liberit.ca",
    token: "tok",
    user: "@helper:matrix.liberit.ca",
    executiveUser: "xr12p:matrix.liberit.ca",
    fetchImpl
  });
  assert.equal(resolved, "!newdm:matrix.liberit.ca");
  assert.equal(calls.length, 2);
});
