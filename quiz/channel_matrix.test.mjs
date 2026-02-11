import test from "node:test";
import assert from "node:assert/strict";

import { createMatrixAdapter } from "../program/agent/channels/matrix.mjs";

test("matrix adapter receive normalizes room events", async () => {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (String(url).includes("/_matrix/client/v3/join/")) {
      return { ok: true, status: 200, async json() { return { room_id: "!room:server" }; } };
    }
    return {
      ok: true,
      async json() {
        return {
          next_batch: "tok2",
          rooms: {
            join: {
              "!room:server": {
                timeline: {
                  events: [
                    {
                      type: "m.room.message",
                      event_id: "$ev1",
                      sender: "@u:server",
                      origin_server_ts: 1700000000000,
                      content: { body: "hello", msgtype: "m.text" }
                    }
                  ]
                }
              }
            }
          }
        };
      }
    };
  };
  const adapter = createMatrixAdapter({ fetchImpl });
  const received = await adapter.receive({
    config: {
      homeserver: "https://matrix.example.org",
      token: "secret",
      rooms: [{ id: "!room:server", lane: "main" }]
    },
    checkpoint: { nextBatch: "tok1" }
  });
  assert.equal(received.events.length, 1);
  assert.equal(received.events[0]?.eventId, "$ev1");
  assert.equal(received.events[0]?.laneName, "main");
  assert.equal(received.checkpoint?.nextBatch, "tok2");
  assert.ok(calls.some(call => String(call.url).includes("/join/")));
  assert.ok(calls.some(call => String(call.url).includes("/sync?")));
});

test("matrix adapter receive resolves alias room ids from join diagnostics", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("/_matrix/client/v3/join/")) {
      return { ok: true, status: 200, async json() { return { room_id: "!room:server" }; } };
    }
    return {
      ok: true,
      async json() {
        return {
          next_batch: "tok2",
          rooms: {
            join: {
              "!room:server": {
                timeline: {
                  events: [
                    {
                      type: "m.room.message",
                      event_id: "$ev1",
                      sender: "@u:server",
                      origin_server_ts: 1700000000000,
                      content: { body: "hello alias", msgtype: "m.text" }
                    }
                  ]
                }
              }
            }
          }
        };
      }
    };
  };
  const adapter = createMatrixAdapter({ fetchImpl });
  const received = await adapter.receive({
    config: {
      homeserver: "https://matrix.example.org",
      token: "secret",
      rooms: [{ id: "#pyash:server", lane: "main" }]
    },
    checkpoint: { nextBatch: "tok1" }
  });
  assert.equal(received.events.length, 1);
  assert.equal(received.events[0]?.eventId, "$ev1");
  assert.equal(received.events[0]?.channelId, "!room:server");
  assert.equal(received.events[0]?.laneName, "main");
});

test("matrix adapter send posts m.room.message", async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: true,
      async json() {
        return { event_id: "$out1" };
      }
    };
  };
  const adapter = createMatrixAdapter({ fetchImpl });
  const sent = await adapter.send({
    config: {
      homeserver: "https://matrix.example.org",
      token: "secret"
    },
    event: { channelId: "!room:server" },
    content: "reply text"
  });
  assert.equal(sent.eventId, "$out1");
  assert.equal(calls.length, 1);
  assert.match(String(calls[0].url), /\/rooms\//);
  assert.equal(calls[0].opts?.method, "PUT");
});

test("matrix adapter receive includes m.direct room events", async () => {
  const fetchImpl = async (url) => {
    const text = String(url);
    if (text.includes("/_matrix/client/v3/join/")) {
      return { ok: true, status: 200, async json() { return { room_id: "!room:server" }; } };
    }
    if (text.includes("/account_data/m.direct")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            "@friend:server": ["!dm:server"]
          };
        }
      };
    }
    if (text.includes("/joined_rooms")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { joined_rooms: ["!room:server", "!dm:server"] };
        }
      };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          next_batch: "tok2",
          rooms: {
            join: {
              "!room:server": { timeline: { events: [] } },
              "!dm:server": {
                timeline: {
                  events: [
                    {
                      type: "m.room.message",
                      event_id: "$dm1",
                      sender: "@friend:server",
                      origin_server_ts: 1700000000100,
                      content: { body: "hello dm", msgtype: "m.text" }
                    }
                  ]
                }
              }
            }
          }
        };
      }
    };
  };
  const adapter = createMatrixAdapter({ fetchImpl });
  const received = await adapter.receive({
    config: {
      homeserver: "https://matrix.example.org",
      token: "secret",
      user: "@bot:server",
      rooms: [{ id: "!room:server", lane: "main" }]
    },
    checkpoint: { nextBatch: "tok1" }
  });
  assert.equal(received.events.length, 1);
  assert.equal(received.events[0]?.eventId, "$dm1");
  assert.equal(received.events[0]?.channelId, "!dm:server");
  assert.equal(received.events[0]?.laneName, null);
  assert.deepEqual(received.diagnostics?.directRoomsSnapshot?.rooms, ["!dm:server"]);
});

test("matrix adapter receive includes joined sync rooms even when not configured or in m.direct", async () => {
  const fetchImpl = async (url) => {
    const text = String(url);
    if (text.includes("/_matrix/client/v3/join/")) {
      return { ok: true, status: 200, async json() { return { room_id: "!room:server" }; } };
    }
    if (text.includes("/account_data/m.direct")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {};
        }
      };
    }
    if (text.includes("/joined_rooms")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { joined_rooms: ["!room:server", "!dm2:server"] };
        }
      };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          next_batch: "tok2",
          rooms: {
            join: {
              "!room:server": { timeline: { events: [] } },
              "!dm2:server": {
                timeline: {
                  events: [
                    {
                      type: "m.room.message",
                      event_id: "$dm2",
                      sender: "@friend:server",
                      origin_server_ts: 1700000000200,
                      content: { body: "hello dm2", msgtype: "m.text" }
                    }
                  ]
                }
              }
            }
          }
        };
      }
    };
  };
  const adapter = createMatrixAdapter({ fetchImpl });
  const received = await adapter.receive({
    config: {
      homeserver: "https://matrix.example.org",
      token: "secret",
      user: "@bot:server",
      rooms: [{ id: "!room:server", lane: "main" }]
    },
    checkpoint: { nextBatch: "tok1" }
  });
  assert.equal(received.events.length, 1);
  assert.equal(received.events[0]?.eventId, "$dm2");
  assert.equal(received.events[0]?.channelId, "!dm2:server");
});
