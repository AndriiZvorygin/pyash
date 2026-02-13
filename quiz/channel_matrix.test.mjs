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
  assert.equal(received.diagnostics?.timeoutMs, 10000);
  assert.ok(calls.some(call => String(call.url).includes("/join/")));
  assert.ok(calls.some(call => String(call.url).includes("/sync?")));
  assert.ok(calls.some(call => String(call.url).includes("timeout=10000")));
});

test("matrix adapter receive keeps attachment metadata for m.file events", async () => {
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
                      event_id: "$evf1",
                      sender: "@u:server",
                      origin_server_ts: 1700000000000,
                      content: {
                        msgtype: "m.file",
                        body: "notes.txt",
                        url: "mxc://matrix.example.org/abc123",
                        info: { mimetype: "text/plain", size: 5 }
                      }
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
  assert.equal(received.events[0]?.text, "notes.txt");
  assert.equal(received.events[0]?.attachments?.length, 1);
  assert.equal(received.events[0]?.attachments?.[0]?.mxcUrl, "mxc://matrix.example.org/abc123");
});

test("matrix adapter receive accepts long poll timeout override", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
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
                  events: []
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
      longPollMs: 45000,
      rooms: [{ id: "!room:server", lane: "main" }]
    },
    checkpoint: { nextBatch: "tok1" }
  });
  assert.equal(received.diagnostics?.timeoutMs, 45000);
  assert.ok(calls.some(url => url.includes("timeout=45000")));
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
  const payload = JSON.parse(String(calls[0].opts?.body ?? "{}"));
  assert.equal(payload.msgtype, "m.text");
  assert.equal(payload.body, "reply text");
  assert.equal(payload.format, "org.matrix.custom.html");
  assert.match(payload.formatted_body, /<p>reply text<\/p>/);
});

test("matrix adapter downloads attachments into target directory", async () => {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    if (String(url).includes("/_matrix/media/v3/download/")) {
      return {
        ok: true,
        async arrayBuffer() {
          return new TextEncoder().encode("hello").buffer;
        }
      };
    }
    return {
      ok: true,
      async json() {
        return { event_id: "$out1" };
      }
    };
  };
  const adapter = createMatrixAdapter({ fetchImpl });
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-matrix-media-"));
  const outDir = path.join(root, "artifacts", "20260212");
  const files = await adapter.downloadAttachments({
    config: {
      homeserver: "https://matrix.example.org",
      token: "secret"
    },
    event: {
      attachments: [
        {
          kind: "m.file",
          body: "notes.txt",
          mxcUrl: "mxc://matrix.example.org/abc123",
          mimetype: "text/plain"
        }
      ]
    },
    targetDir: outDir
  });
  assert.equal(files.length, 1);
  assert.equal(files[0]?.filename, "notes.txt");
  assert.equal(files[0]?.bytes, 5);
  const saved = await fs.readFile(files[0]?.path, "utf8");
  assert.equal(saved, "hello");
  assert.ok(calls.some(call => call.url.includes("/_matrix/media/v3/download/matrix.example.org/abc123")));
});

test("matrix adapter send converts markdown into formatted_body html", async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: true,
      async json() {
        return { event_id: "$out2" };
      }
    };
  };
  const adapter = createMatrixAdapter({ fetchImpl });
  await adapter.send({
    config: {
      homeserver: "https://matrix.example.org",
      token: "secret"
    },
    event: { channelId: "!room:server" },
    content: "**bold** _italic_ `code`"
  });
  const payload = JSON.parse(String(calls[0].opts?.body ?? "{}"));
  assert.equal(payload.body, "**bold** _italic_ `code`");
  assert.equal(payload.format, "org.matrix.custom.html");
  assert.match(payload.formatted_body, /<strong>bold<\/strong>/);
  assert.match(payload.formatted_body, /<em>italic<\/em>/);
  assert.match(payload.formatted_body, /<code>code<\/code>/);
});

test("matrix adapter appservice mode sends auth via query params", async () => {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    if (String(url).includes("/_matrix/client/v3/join/")) {
      return { ok: true, status: 200, async json() { return { room_id: "!room:server" }; } };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          next_batch: "tok2",
          rooms: { join: { "!room:server": { timeline: { events: [] } } } }
        };
      }
    };
  };
  const adapter = createMatrixAdapter({ fetchImpl });
  await adapter.receive({
    config: {
      homeserver: "https://matrix.example.org",
      token: "appservice-token",
      user: "@agentbot:matrix.example.org",
      mode: "appservice",
      rooms: [{ id: "!room:server", lane: "main" }]
    },
    checkpoint: { nextBatch: "tok1" }
  });

  const syncCall = calls.find((call) => call.url.includes("/_matrix/client/v3/sync?"));
  assert.ok(syncCall);
  const syncUrl = new URL(syncCall.url);
  assert.equal(syncUrl.searchParams.get("access_token"), "appservice-token");
  assert.equal(syncUrl.searchParams.get("user_id"), "@agentbot:matrix.example.org");
  assert.equal(syncCall.opts?.headers?.Authorization, undefined);
});

test("matrix adapter receive auto-joins invited rooms", async () => {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    const text = String(url);
    calls.push({ url: text, opts });
    if (text.includes("/_matrix/client/v3/join/")) {
      return { ok: true, status: 200, async json() { return { room_id: "!joined:server" }; } };
    }
    if (text.includes("/joined_rooms")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { joined_rooms: ["!room:server", "!joined:server"] };
        }
      };
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
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          next_batch: "tok2",
          rooms: {
            join: {
              "!room:server": { timeline: { events: [] } }
            },
            invite: {
              "!invite:server": {}
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

  assert.equal(received.checkpoint?.nextBatch, "tok2");
  assert.ok(calls.some((call) => call.url.includes("/join/!invite%3Aserver")));
  assert.ok(Array.isArray(received.diagnostics?.inviteJoinDiagnostics));
  assert.equal(received.diagnostics?.inviteJoinDiagnostics?.length, 1);
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
  assert.equal(received.events[0]?.dmRoom, true);
  assert.deepEqual(received.diagnostics?.directRoomsSnapshot?.rooms, ["!dm:server"]);
});

test("matrix adapter receive infers dm rooms from sync summary when m.direct is missing", async () => {
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
                summary: {
                  "m.joined_member_count": 2,
                  "m.invited_member_count": 0
                },
                timeline: {
                  events: [
                    {
                      type: "m.room.message",
                      event_id: "$dm2",
                      sender: "@friend:server",
                      origin_server_ts: 1700000000200,
                      content: { body: "hello inferred dm", msgtype: "m.text" }
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
  assert.equal(received.events[0]?.dmRoom, true);
  assert.deepEqual(received.diagnostics?.inferredDmRooms, ["!dm2:server"]);
});

test("matrix adapter receive infers dm rooms from joined member count when summary is missing", async () => {
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
          return { joined_rooms: ["!room:server", "!dm3:server"] };
        }
      };
    }
    if (text.includes("/rooms/!dm3%3Aserver/joined_members")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            joined: {
              "@bot:server": { display_name: "bot" },
              "@friend:server": { display_name: "friend" }
            }
          };
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
              "!dm3:server": {
                timeline: {
                  events: [
                    {
                      type: "m.room.message",
                      event_id: "$dm3",
                      sender: "@friend:server",
                      origin_server_ts: 1700000000201,
                      content: { body: "hello inferred dm membership", msgtype: "m.text" }
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
  assert.equal(received.events[0]?.eventId, "$dm3");
  assert.equal(received.events[0]?.channelId, "!dm3:server");
  assert.equal(received.events[0]?.dmRoom, true);
  assert.deepEqual(received.diagnostics?.inferredDmRooms, ["!dm3:server"]);
  assert.deepEqual(received.diagnostics?.inferredDmMembershipProbes, [
    { roomId: "!dm3:server", memberCount: 2 }
  ]);
});

test("matrix adapter receive includes joined sync rooms when includeJoinedRooms is enabled", async () => {
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
      includeJoinedRooms: true,
      rooms: [{ id: "!room:server", lane: "main" }]
    },
    checkpoint: { nextBatch: "tok1" }
  });
  assert.equal(received.events.length, 1);
  assert.equal(received.events[0]?.eventId, "$dm2");
  assert.equal(received.events[0]?.channelId, "!dm2:server");
});

test("matrix adapter receive excludes joined sync rooms by default", async () => {
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
  assert.equal(received.events.length, 0);
  assert.equal(received.diagnostics?.includeJoinedRooms, false);
});

test("matrix adapter appservice mode includes joined sync rooms by default", async () => {
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
          return { joined_rooms: ["!room:server", "!dm-app:server"] };
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
              "!dm-app:server": {
                timeline: {
                  events: [
                    {
                      type: "m.room.message",
                      event_id: "$dm-app",
                      sender: "@friend:server",
                      origin_server_ts: 1700000000200,
                      content: { body: "hello appservice dm", msgtype: "m.text" }
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
      mode: "appservice",
      rooms: [{ id: "!room:server", lane: "main" }]
    },
    checkpoint: { nextBatch: "tok1" }
  });
  assert.equal(received.events.length, 1);
  assert.equal(received.events[0]?.eventId, "$dm-app");
  assert.equal(received.diagnostics?.includeJoinedRooms, true);
});
