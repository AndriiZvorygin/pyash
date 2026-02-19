import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ensureMatrixCredentials,
  ensureMatrixExecutiveDmRoom,
  readMatrixAuthCache,
  writeMatrixAuthCache
} from "../program/agent/channels/bootstrap.mjs";

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
  const newspaperDir = path.join(root, "world", "newspaper");
  const files = await fs.readdir(newspaperDir);
  const channelLog = files.find((entry) => entry.includes("-channel-matrix-helper.pya"));
  assert.ok(channelLog, "channel newspaper log should exist");
  const channelText = await fs.readFile(path.join(newspaperDir, channelLog), "utf8");
  assert.match(channelText, /be channel outcome/);
  assert.match(channelText, /as name password_login/);
  assert.match(channelText, /vyah success/);
});

test("matrix bootstrap with explicit user is idempotent when user already exists", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-matrix-bootstrap-idempotent-"));
  const agentHouse = path.join(root, "world", "house", "helper");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });
  await writeMatrixAuthCache(agentHouse, {
    homeserver: "https://matrix.example.org",
    user: "@helper:example.org",
    localpart: "helper",
    password: "pw0",
    accessToken: "",
    deviceId: "DEV0"
  });

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
  const post = await readMatrixAuthCache(agentHouse);
  assert.equal(post.user, "@helper:example.org");
  assert.equal(post.localpart, "helper");
  assert.equal(post.accessToken, "tok-new");
});

test("matrix bootstrap recovers cached token user via whoami when user is missing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-matrix-bootstrap-whoami-"));
  const agentHouse = path.join(root, "world", "house", "helper");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });
  await writeMatrixAuthCache(agentHouse, {
    homeserver: "https://matrix.example.org",
    user: null,
    accessToken: "tok-cached",
    executiveDmRooms: {
      "@andrii:matrix.example.org": "!dm:matrix.example.org"
    }
  });

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

  const persisted = await readMatrixAuthCache(agentHouse);
  assert.equal(persisted.user, "@helper:matrix.example.org");
  assert.equal(calls.length, 1);
});

test("matrix bootstrap ignores mismatched config token for explicit non-appservice user", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-matrix-bootstrap-token-mismatch-"));
  const agentHouse = path.join(root, "world", "house", "accountant");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });

  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (String(url).endsWith("/_matrix/client/v3/account/whoami")) {
      return {
        ok: true,
        async json() {
          return { user_id: "@mricge:matrix.example.org" };
        }
      };
    }
    if (String(url).endsWith("/_synapse/admin/v1/register") && (!opts.method || opts.method === "GET")) {
      return { ok: true, async json() { return { nonce: "nonce1" }; } };
    }
    if (String(url).endsWith("/_synapse/admin/v1/register") && opts.method === "POST") {
      return { ok: true, async json() { return { user_id: "@accountant:matrix.example.org" }; } };
    }
    if (String(url).endsWith("/_matrix/client/v3/login")) {
      const payload = JSON.parse(String(opts.body ?? "{}"));
      assert.equal(payload?.identifier?.user, "@accountant:matrix.example.org");
      return {
        ok: true,
        async json() {
          return { access_token: "tok-accountant", user_id: "@accountant:matrix.example.org", device_id: "DEV1" };
        }
      };
    }
    throw new Error(`unexpected fetch url: ${url}`);
  };

  const resolved = await ensureMatrixCredentials({
    agentName: "accountant",
    agentHouse,
    config: {
      homeserver: "https://matrix.example.org",
      user: "@accountant:matrix.example.org",
      token: "tok-mricge",
      registrationSharedSecret: "secret",
      mode: "sync"
    },
    fetchImpl
  });

  assert.equal(resolved.user, "@accountant:matrix.example.org");
  assert.equal(resolved.token, "tok-accountant");
  assert.equal(calls.filter((call) => String(call.url).endsWith("/_matrix/client/v3/account/whoami")).length, 1);
  assert.equal(calls.filter((call) => String(call.url).endsWith("/_matrix/client/v3/login")).length, 1);

  const persisted = await readMatrixAuthCache(agentHouse);
  assert.equal(persisted.user, "@accountant:matrix.example.org");
  assert.equal(persisted.accessToken, "tok-accountant");
});

test("matrix executive dm bootstrap reuses m.direct room when present", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-matrix-executive-dm-existing-"));
  const agentHouse = path.join(root, "world", "house", "helper");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });

  const calls = [];
  const roomId = "!dmexisting:example.org";
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (String(url).includes("/joined_rooms")) {
      return {
        ok: true,
        async json() {
          return { joined_rooms: [roomId] };
        }
      };
    }
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
  assert.equal(calls.length, 2);
});

test("matrix executive dm bootstrap creates room and normalizes executive username", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-matrix-executive-dm-create-"));
  const agentHouse = path.join(root, "world", "house", "helper");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });

  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (String(url).includes("/joined_rooms")) {
      return {
        ok: true,
        async json() {
          return { joined_rooms: [] };
        }
      };
    }
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
  assert.equal(calls.length, 3);
});

test("matrix executive dm bootstrap appservice mode uses query auth context", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-matrix-executive-dm-appservice-"));
  const agentHouse = path.join(root, "world", "house", "helper");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });

  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    if (String(url).includes("/joined_rooms")) {
      return {
        ok: true,
        async json() {
          return { joined_rooms: ["!dmexisting:matrix.liberit.ca"] };
        }
      };
    }
    if (String(url).includes("/account_data/m.direct")) {
      return {
        ok: true,
        async json() {
          return {
            "@admin:matrix.liberit.ca": ["!dmexisting:matrix.liberit.ca"]
          };
        }
      };
    }
    throw new Error(`unexpected fetch url: ${url}`);
  };

  const resolved = await ensureMatrixExecutiveDmRoom({
    agentHouse,
    homeserver: "https://matrix.liberit.ca",
    token: "as-token-123",
    user: "@agentbot:matrix.liberit.ca",
    mode: "appservice",
    executiveUser: "@admin:matrix.liberit.ca",
    fetchImpl
  });

  assert.equal(resolved, "!dmexisting:matrix.liberit.ca");
  assert.equal(calls.length, 2);
  const callUrl = new URL(calls.find((call) => call.url.includes("/account_data/m.direct")).url);
  assert.equal(callUrl.searchParams.get("access_token"), "as-token-123");
  assert.equal(callUrl.searchParams.get("user_id"), "@agentbot:matrix.liberit.ca");
  const accountCall = calls.find((call) => call.url.includes("/account_data/m.direct"));
  assert.equal(accountCall?.opts?.headers?.Authorization, undefined);
});

test("matrix credentials clears cached executive dm rooms when configured user changes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-matrix-user-switch-"));
  const agentHouse = path.join(root, "world", "house", "pyash-agent");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });
  await writeMatrixAuthCache(agentHouse, {
    homeserver: "https://matrix.liberit.ca",
    user: "@agentbot:matrix.liberit.ca",
    localpart: "agentbot",
    accessToken: "tok-cached",
    executiveDmRooms: {
      "@andrii:matrix.liberit.ca": "!old:matrix.liberit.ca"
    }
  });

  const resolved = await ensureMatrixCredentials({
    agentName: "pyash-agent",
    agentHouse,
    config: {
      homeserver: "https://matrix.liberit.ca",
      user: "@pyash-agent:matrix.liberit.ca",
      mode: "appservice"
    },
    fetchImpl: async () => {
      throw new Error("should not fetch with cached token");
    }
  });

  assert.equal(resolved.user, "@pyash-agent:matrix.liberit.ca");
  const persisted = await readMatrixAuthCache(agentHouse);
  assert.equal(persisted.user, "@pyash-agent:matrix.liberit.ca");
  assert.deepEqual(persisted.executiveDmRooms, {});
});

test("matrix executive dm bootstrap ignores stale cached room when not joined", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-matrix-dm-stale-room-"));
  const agentHouse = path.join(root, "world", "house", "pyash-agent");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });
  await writeMatrixAuthCache(agentHouse, {
    homeserver: "https://matrix.liberit.ca",
    user: "@agentbot:matrix.liberit.ca",
    accessToken: "tok",
    executiveDmRooms: {
      "@andrii:matrix.liberit.ca": "!stale:matrix.liberit.ca"
    }
  });

  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    if (String(url).includes("/joined_rooms")) {
      return {
        ok: true,
        async json() {
          return { joined_rooms: ["!active:matrix.liberit.ca"] };
        }
      };
    }
    if (String(url).includes("/account_data/m.direct")) {
      return {
        ok: true,
        async json() {
          return {
            "@andrii:matrix.liberit.ca": ["!stale:matrix.liberit.ca"]
          };
        }
      };
    }
    if (String(url).endsWith("/_matrix/client/v3/createRoom")) {
      return {
        ok: true,
        async json() {
          return { room_id: "!fresh:matrix.liberit.ca" };
        }
      };
    }
    throw new Error(`unexpected fetch url: ${url}`);
  };

  const resolved = await ensureMatrixExecutiveDmRoom({
    agentHouse,
    homeserver: "https://matrix.liberit.ca",
    token: "tok",
    user: "@agentbot:matrix.liberit.ca",
    executiveUser: "@andrii:matrix.liberit.ca",
    fetchImpl
  });
  assert.equal(resolved, "!fresh:matrix.liberit.ca");
  assert.ok(calls.some((call) => call.url.includes("/joined_rooms")));
  assert.ok(calls.some((call) => call.url.endsWith("/_matrix/client/v3/createRoom")));
});
