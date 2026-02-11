import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runChannelOnce, buildChannelMindSentence } from "../program/agent/channels/index.mjs";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, doRemember } from "../program/remember/index.mjs";
import { resetMindLogs } from "../program/verbs/mind/mind.mjs";

test("channel runtime routes to session lane and deduplicates by event id", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-channel-runtime-"));
  const agentHouse = path.join(root, "world", "house", "helper");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });

  const sent = [];
  const adapter = {
    async receive() {
      return {
        events: [
          {
            channelType: "matrix",
            channelId: "!room:server",
            eventId: "$1",
            sender: "@u:server",
            text: "hello"
          },
          {
            channelType: "matrix",
            channelId: "!room:server",
            eventId: "$1",
            sender: "@u:server",
            text: "hello duplicate"
          }
        ],
        checkpoint: { nextBatch: "abc" }
      };
    },
    async send({ content }) {
      sent.push(content);
      return { eventId: "$out1" };
    }
  };

  const calls = [];
  const interpretFn = async (sentence) => {
    calls.push(sentence);
    return { ob: { text: "reply" } };
  };

  const channelConfig = {
    user: "@self:server",
    mentionGate: false,
    roomLanes: { "!room:server": "matrix_main" },
    defaultLane: null
  };

  const first = await runChannelOnce({
    agentName: "helper",
    channelType: "matrix",
    channelConfig,
    adapter,
    interpretFn,
    agentHouse
  });
  assert.equal(first.received, 2);
  assert.equal(first.handled, 1);
  assert.equal(first.sent, 1);
  assert.equal(first.skippedDedup, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.fromtext?.name, "session name matrix_main");

  const second = await runChannelOnce({
    agentName: "helper",
    channelType: "matrix",
    channelConfig,
    adapter,
    interpretFn,
    agentHouse
  });
  assert.equal(second.handled, 0);
  assert.equal(second.skippedDedup, 2);
});

test("channel runtime mention gate skips non-mentions in public rooms and allows DM", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-channel-mention-"));
  const agentHouse = path.join(root, "world", "house", "helper");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });

  const adapter = {
    async receive() {
      return {
        events: [
          { channelType: "matrix", channelId: "!pub:server", eventId: "$1", sender: "@u:server", text: "hello all" },
          { channelType: "matrix", channelId: "!pub:server", eventId: "$2", sender: "@u:server", text: "@helper please respond" },
          { channelType: "matrix", channelId: "!dm:server", eventId: "$3", sender: "@u:server", text: "dm hello" }
        ],
        checkpoint: { nextBatch: "tok2" }
      };
    },
    async send() {
      return { eventId: "$out" };
    }
  };

  let calls = 0;
  const interpretFn = async () => {
    calls += 1;
    return { ob: { text: "reply" } };
  };

  const result = await runChannelOnce({
    agentName: "helper",
    channelType: "matrix",
    channelConfig: {
      user: "@helper:server",
      mentionGate: true,
      dmRooms: ["!dm:server"],
      roomLanes: {}
    },
    adapter,
    interpretFn,
    agentHouse
  });
  assert.equal(calls, 2);
  assert.equal(result.handled, 2);
  assert.equal(result.skippedMention, 1);
});

test("channel runtime sends configure-mind fallback when mind backend is missing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-channel-no-mind-"));
  const agentHouse = path.join(root, "world", "house", "helper");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });

  const sent = [];
  const adapter = {
    async receive() {
      return {
        events: [
          { channelType: "matrix", channelId: "!pub:server", eventId: "$1", sender: "@u:server", text: "hello" }
        ],
        checkpoint: { nextBatch: "tok-no-mind" }
      };
    },
    async send({ content }) {
      sent.push(content);
      return { eventId: "$out-no-mind" };
    }
  };

  const interpretFn = async () => {
    const err = new Error("mind backend missing for generate request");
    err.sentence = { mood: "do", be: "error", su: { name: "mind backend missing" } };
    throw err;
  };

  const result = await runChannelOnce({
    agentName: "helper",
    channelType: "matrix",
    channelConfig: {
      user: "@helper:server",
      mentionGate: false,
      roomLanes: {}
    },
    adapter,
    interpretFn,
    agentHouse
  });

  assert.equal(result.handled, 1);
  assert.equal(result.sent, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0], "no mind configured yet, run pyash configure mind to set a mind relay");
});

test("channel runtime sends configure-mind fallback when mind answer is empty and mind configure is missing", async () => {
  forget();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-channel-empty-no-mind-"));
  const agentHouse = path.join(root, "world", "house", "helper");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });

  const sent = [];
  const adapter = {
    async receive() {
      return {
        events: [
          { channelType: "matrix", channelId: "!pub:server", eventId: "$1", sender: "@u:server", text: "hello" }
        ],
        checkpoint: { nextBatch: "tok-empty-no-mind" }
      };
    },
    async send({ content }) {
      sent.push(content);
      return { eventId: "$out-empty-no-mind" };
    }
  };

  const interpretFn = async () => ({ be: "answer", ob: { text: "" } });

  const result = await runChannelOnce({
    agentName: "helper",
    channelType: "matrix",
    channelConfig: {
      user: "@helper:server",
      mentionGate: false,
      roomLanes: {}
    },
    adapter,
    interpretFn,
    agentHouse
  });

  assert.equal(result.handled, 1);
  assert.equal(result.sent, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0], "no mind configured yet, run pyash configure mind to set a mind relay");
});

test("channel runtime fans out to configured listeners and routes mention to named agent", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-channel-listeners-"));
  const agentHouse = path.join(root, "world", "house", "postmaster");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });

  const calls = [];
  const adapter = {
    async receive() {
      return {
        events: [
          {
            channelType: "matrix",
            channelId: "!pub:server",
            eventId: "$1",
            sender: "@u:server",
            text: "@confederation-priest please help"
          }
        ],
        checkpoint: { nextBatch: "tok3" }
      };
    },
    async send() {
      return { eventId: "$out" };
    }
  };

  const result = await runChannelOnce({
    agentName: "channel-postmaster",
    channelType: "matrix",
    channelConfig: {
      user: "@channel-postmaster:server",
      mentionGate: true,
      listeners: ["confederation-priest", "agent-helper"],
      roomListeners: {},
      dmRooms: []
    },
    adapter,
    interpretFn: async (sentence) => {
      calls.push(sentence);
      return { ob: { text: "reply" } };
    },
    agentHouse
  });
  assert.equal(result.received, 1);
  assert.equal(result.handled, 1);
  assert.equal(result.sent, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.for?.name, "confederation-priest");
});

test("channel runtime shared fanout dispatches one event to multiple listeners in one poll cycle", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-channel-shared-fanout-"));
  const agentHouse = path.join(root, "world", "house", "postmaster");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });

  let receiveCalls = 0;
  const sent = [];
  const listeners = [];
  const adapter = {
    async receive() {
      receiveCalls += 1;
      return {
        events: [
          {
            channelType: "matrix",
            channelId: "!pub:server",
            eventId: "$fanout-1",
            sender: "@u:server",
            text: "status?"
          }
        ],
        checkpoint: { nextBatch: "tok-fanout" }
      };
    },
    async send({ content }) {
      sent.push(content);
      return { eventId: `$out-${sent.length}` };
    }
  };

  const result = await runChannelOnce({
    agentName: "channel-postmaster",
    channelType: "matrix",
    channelConfig: {
      user: "@channel-postmaster:server",
      mentionGate: false,
      listeners: ["confederation-priest", "agent-helper"],
      roomListeners: {},
      dmRooms: []
    },
    adapter,
    interpretFn: async (sentence) => {
      listeners.push(sentence?.for?.name);
      return { ob: { text: `reply from ${sentence?.for?.name}` } };
    },
    agentHouse
  });
  assert.equal(receiveCalls, 1);
  assert.equal(result.received, 1);
  assert.equal(result.handled, 2);
  assert.equal(result.sent, 2);
  assert.deepEqual(listeners.slice().sort(), ["agent-helper", "confederation-priest"]);
});

test("channel sentence builder uses default tools and lane from event", () => {
  const sentence = buildChannelMindSentence({
    agentName: "helper",
    event: {
      channelType: "matrix",
      channelId: "!a:server",
      eventId: "$1",
      sender: "@u:server",
      text: "hi",
      laneName: "room_main"
    },
    channelConfig: {}
  });
  assert.equal(sentence.for?.name, "helper");
  assert.equal(sentence.with?.wo, "tools");
  assert.equal(sentence.fromtext?.name, "session name room_main");
});

test("channel debug mode logs per-event routing decisions", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-channel-debug-"));
  const agentHouse = path.join(root, "world", "house", "helper");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });

  const adapter = {
    async receive() {
      return {
        events: [
          { channelType: "matrix", channelId: "!pub:server", eventId: "$1", sender: "@u:server", text: "no mention here" }
        ],
        checkpoint: { nextBatch: "tok-debug" }
      };
    },
    async send() {
      return { eventId: "$out" };
    }
  };

  await runChannelOnce({
    agentName: "helper",
    channelType: "matrix",
    channelConfig: {
      user: "@helper:server",
      mentionGate: true,
      debug: true,
      dmRooms: [],
      roomLanes: {}
    },
    adapter,
    interpretFn: async () => ({ ob: { text: "" } }),
    agentHouse
  });

  const newspaperDir = path.join(root, "world", "newspaper");
  const files = await fs.readdir(newspaperDir);
  const logFile = files.find(name => /channel-matrix-helper\.pya$/.test(name));
  assert.ok(logFile);
  const text = await fs.readFile(path.join(newspaperDir, logFile), "utf8");
  assert.match(text, /decision\\\":\\\"mention_skip\\\"/);
});

test("channel mention gate allows replies to self messages without explicit mention", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-channel-reply-self-"));
  const agentHouse = path.join(root, "world", "house", "helper");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });

  let callCount = 0;
  const adapter = {
    async receive() {
      return {
        events: [
          {
            channelType: "matrix",
            channelId: "!pub:server",
            eventId: "$self1",
            sender: "@helper:server",
            text: "prior bot reply"
          },
          {
            channelType: "matrix",
            channelId: "!pub:server",
            eventId: "$reply1",
            sender: "@u:server",
            text: "thanks",
            inReplyToEventId: "$self1"
          }
        ],
        checkpoint: { nextBatch: "tok-reply" }
      };
    },
    async send() {
      return { eventId: "$out2" };
    }
  };

  const result = await runChannelOnce({
    agentName: "helper",
    channelType: "matrix",
    channelConfig: {
      user: "@helper:server",
      mentionGate: true,
      dmRooms: [],
      roomLanes: {}
    },
    adapter,
    interpretFn: async () => {
      callCount += 1;
      return { ob: { text: "replying to thread" } };
    },
    agentHouse
  });
  assert.equal(result.received, 2);
  assert.equal(result.skippedSelf, 1);
  assert.equal(result.handled, 1);
  assert.equal(callCount, 1);
  assert.equal(result.sent, 1);
});

test("channel runtime skips agent canonical sender when configured user differs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-channel-self-canonical-"));
  const agentHouse = path.join(root, "world", "house", "pyash-agent");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });

  const adapter = {
    async receive() {
      return {
        events: [
          {
            channelType: "matrix",
            channelId: "!pub:matrix.liberit.ca",
            eventId: "$self-canonical",
            sender: "@pyash-agent:matrix.liberit.ca",
            text: "hello from legacy identity"
          }
        ],
        checkpoint: { nextBatch: "tok-self-canonical" }
      };
    },
    async send() {
      return { eventId: "$out-self-canonical" };
    }
  };

  const result = await runChannelOnce({
    agentName: "pyash-agent",
    channelType: "matrix",
    channelConfig: {
      user: "@agentbot:matrix.liberit.ca",
      homeserver: "https://matrix.liberit.ca",
      mentionGate: false,
      dmRooms: [],
      roomLanes: {}
    },
    adapter,
    interpretFn: async () => ({ ob: { text: "reply" } }),
    agentHouse
  });

  assert.equal(result.received, 1);
  assert.equal(result.skippedSelf, 1);
  assert.equal(result.handled, 0);
  assert.equal(result.sent, 0);
});

test("channel mention matching uses token boundaries and avoids substring false positives", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-channel-mention-boundary-"));
  const agentHouse = path.join(root, "world", "house", "helper");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });

  const calls = [];
  const adapter = {
    async receive() {
      return {
        events: [
          {
            channelType: "matrix",
            channelId: "!pub:server",
            eventId: "$boundary-1",
            sender: "@u:server",
            text: "the helpering process failed"
          },
          {
            channelType: "matrix",
            channelId: "!pub:server",
            eventId: "$boundary-2",
            sender: "@u:server",
            text: "@helper, can you check this?"
          }
        ],
        checkpoint: { nextBatch: "tok-boundary" }
      };
    },
    async send() {
      return { eventId: "$out-boundary" };
    }
  };

  const result = await runChannelOnce({
    agentName: "helper",
    channelType: "matrix",
    channelConfig: {
      user: "@helper:server",
      mentionGate: true,
      dmRooms: [],
      roomLanes: {}
    },
    adapter,
    interpretFn: async (sentence) => {
      calls.push(sentence);
      return { ob: { text: "reply" } };
    },
    agentHouse
  });

  assert.equal(result.received, 2);
  assert.equal(result.handled, 1);
  assert.equal(result.sent, 1);
  assert.equal(result.skippedMention, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.for?.name, "helper");
});

test("channel runtime enforces ratify policy for propose tools (deny then allow)", async () => {
  const originalMock = process.env.PYA_MIND_RESPONSE;
  try {
    forget();
    resetMindLogs();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-channel-ratify-"));
    const worldRoot = path.join(root, "world");
    const agentName = "helper";
    const agentHouse = path.join(worldRoot, "house", agentName);
    const conductDir = path.join(agentHouse, "conduct");
    await fs.mkdir(conductDir, { recursive: true });

    doRemember({ mood: "ya", su: { name: "world root" }, be: "root", ob: { filename: worldRoot } });
    await interpret(parse("exists su name helper be mind via state \"qwen3\" ya"));
    await interpret(parse("su name tools be map def"));
    await interpret(parse("su name run shell be command ob text input propose"));
    await interpret(parse("prah"));

    const makeAdapter = (eventId, text = "do the command") => ({
      async receive() {
        return {
          events: [
            {
              channelType: "matrix",
              channelId: "!room:server",
              eventId,
              sender: "@u:server",
              text
            }
          ],
          checkpoint: { nextBatch: eventId }
        };
      },
      async send() {
        return { eventId: `$out-${eventId}` };
      }
    });

    const outDenied = path.join(root, "denied.txt");
    await fs.writeFile(
      path.join(conductDir, "ratify.pya"),
      "su name be_command_ob_text ob bool lie ya\n",
      "utf8"
    );
    process.env.PYA_MIND_RESPONSE = JSON.stringify([
      {
        message: {
          content: "",
          tool_calls: [
            {
              id: "call-1",
              function: {
                name: "be_command_ob_text",
                arguments: JSON.stringify({ ob: `echo hello > "${outDenied}"` })
              }
            }
          ]
        }
      },
      { message: { content: "done" } }
    ]);
    const denyAdapter = makeAdapter("$deny", "run command");
    const denyResult = await runChannelOnce({
      agentName,
      channelType: "matrix",
      channelConfig: { user: "@helper:server", mentionGate: false },
      adapter: denyAdapter,
      interpretFn: async (sentence) => {
        const patched = {
          ...sentence,
          with: { name: "tools" }
        };
        return interpret(patched);
      },
      agentHouse
    });
    assert.equal(denyResult.handled, 1);
    assert.equal(denyResult.sent, 1);
    await assert.rejects(fs.access(outDenied), { code: "ENOENT" });

    const outAllowed = path.join(root, "allowed.txt");
    await fs.writeFile(
      path.join(conductDir, "ratify.pya"),
      "su name be_command_ob_text ob bool truth ya\n",
      "utf8"
    );
    process.env.PYA_MIND_RESPONSE = JSON.stringify([
      {
        message: {
          content: "",
          tool_calls: [
            {
              id: "call-1",
              function: {
                name: "be_command_ob_text",
                arguments: JSON.stringify({ ob: `echo hello > "${outAllowed}"` })
              }
            }
          ]
        }
      },
      { message: { content: "done" } }
    ]);
    const allowAdapter = makeAdapter("$allow", "run command");
    const allowResult = await runChannelOnce({
      agentName,
      channelType: "matrix",
      channelConfig: { user: "@helper:server", mentionGate: false },
      adapter: allowAdapter,
      interpretFn: async (sentence) => {
        const patched = {
          ...sentence,
          with: { name: "tools" }
        };
        return interpret(patched);
      },
      agentHouse
    });
    assert.equal(allowResult.handled, 1);
    assert.equal(allowResult.sent, 1);
    const content = await fs.readFile(outAllowed, "utf8");
    assert.match(content, /hello/);
  } finally {
    if (originalMock === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = originalMock;
    forget();
    resetMindLogs();
  }
});
