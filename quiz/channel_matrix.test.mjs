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
