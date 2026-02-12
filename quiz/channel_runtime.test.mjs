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
  assert.equal(calls[0]?.at?.filename, path.join(root, "world", "house", "helper"));

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

test("channel runtime warm-start primes checkpoint and skips backlog on first poll", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-channel-warm-start-"));
  const agentHouse = path.join(root, "world", "house", "helper");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });

  let receiveCalls = 0;
  const sent = [];
  const adapter = {
    async receive() {
      receiveCalls += 1;
      if (receiveCalls === 1) {
        return {
          events: [
            { channelType: "matrix", channelId: "!pub:server", eventId: "$old1", sender: "@u:server", text: "old backlog message" }
          ],
          checkpoint: { nextBatch: "tok-after-warm" }
        };
      }
      return {
        events: [
          { channelType: "matrix", channelId: "!pub:server", eventId: "$new1", sender: "@u:server", text: "new message" }
        ],
        checkpoint: { nextBatch: "tok-after-new" }
      };
    },
    async send({ content }) {
      sent.push(content);
      return { eventId: "$out-warm" };
    }
  };

  const first = await runChannelOnce({
    agentName: "helper",
    channelType: "matrix",
    channelConfig: {
      user: "@helper:server",
      mentionGate: false,
      warmStart: true,
      roomLanes: {}
    },
    adapter,
    interpretFn: async () => ({ ob: { text: "reply" } }),
    agentHouse
  });
  assert.equal(first.warmed, true);
  assert.equal(first.handled, 0);
  assert.equal(first.sent, 0);

  const second = await runChannelOnce({
    agentName: "helper",
    channelType: "matrix",
    channelConfig: {
      user: "@helper:server",
      mentionGate: false,
      warmStart: true,
      roomLanes: {}
    },
    adapter,
    interpretFn: async () => ({ ob: { text: "reply" } }),
    agentHouse
  });
  assert.equal(second.warmed, undefined);
  assert.equal(second.handled, 1);
  assert.equal(second.sent, 1);
  assert.equal(sent.length, 1);
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
      listeners.push({
        name: sentence?.for?.name,
        cwd: sentence?.at?.filename ?? ""
      });
      return { ob: { text: `reply from ${sentence?.for?.name}` } };
    },
    agentHouse
  });
  assert.equal(receiveCalls, 1);
  assert.equal(result.received, 1);
  assert.equal(result.handled, 2);
  assert.equal(result.sent, 2);
  assert.deepEqual(
    listeners
      .slice()
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "en")),
    [
      { name: "agent-helper", cwd: path.join(root, "world", "house", "agent-helper") },
      { name: "confederation-priest", cwd: path.join(root, "world", "house", "confederation-priest") }
    ]
  );
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

test("channel runtime appends DM tool call and summary block when enabled", async () => {
  const originalMock = process.env.PYA_MIND_RESPONSE;
  const originalCommandResponse = process.env.PYA_COMMAND_RESPONSE;
  try {
    forget();
    resetMindLogs();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-channel-dm-tool-summary-"));
    const worldRoot = path.join(root, "world");
    const agentHouse = path.join(worldRoot, "house", "helper");
    await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });
    doRemember({ mood: "ya", su: { name: "world root" }, be: "root", ob: { filename: worldRoot } });
    await interpret(parse('exists su name helper be mind via state "qwen3" ya'));

    process.env.PYA_COMMAND_RESPONSE = "tool-ok";
    process.env.PYA_MIND_RESPONSE = JSON.stringify([
      {
        message: {
          content: "",
          tool_calls: [
            {
              id: "call-1",
              function: {
                name: "be_command_ob_text_to_name_text",
                arguments: JSON.stringify({ ob: "echo hi" })
              }
            }
          ]
        }
      },
      { message: { content: "done" } }
    ]);

    const sent = [];
    const adapter = {
      async receive() {
        return {
          events: [
            {
              channelType: "matrix",
              channelId: "!dm:server",
              eventId: "$dm-summary-1",
              sender: "@u:server",
              text: "run a tool"
            }
          ],
          checkpoint: { nextBatch: "tok-dm-summary" }
        };
      },
      async send({ content }) {
        sent.push(content);
        return { eventId: "$out-dm-summary" };
      }
    };

    const result = await runChannelOnce({
      agentName: "helper",
      channelType: "matrix",
      channelConfig: {
        user: "@helper:server",
        mentionGate: false,
        dmRooms: ["!dm:server"],
        dmToolSummary: true
      },
      adapter,
      interpretFn: interpret,
      agentHouse
    });

    assert.equal(result.handled, 1);
    assert.equal(result.sent, 3);
    assert.equal(sent.length, 3);
    assert.match(sent[0], /^tool call: be_command_ob_text_to_name_text$/);
    assert.match(sent[1], /^tool result: be_command_ob_text_to_name_text:/);
    assert.match(sent[1], /tool-ok/);
    assert.match(sent[2], /^done$/);
  } finally {
    if (originalMock === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = originalMock;
    if (originalCommandResponse === undefined) delete process.env.PYA_COMMAND_RESPONSE;
    else process.env.PYA_COMMAND_RESPONSE = originalCommandResponse;
    forget();
    resetMindLogs();
  }
});

test("channel runtime emits tool call none when tool-expected prompt returns no tool calls", async () => {
  const originalMock = process.env.PYA_MIND_RESPONSE;
  try {
    forget();
    resetMindLogs();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-channel-dm-tool-none-"));
    const worldRoot = path.join(root, "world");
    const agentHouse = path.join(worldRoot, "house", "helper");
    await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });
    doRemember({ mood: "ya", su: { name: "world root" }, be: "root", ob: { filename: worldRoot } });
    await interpret(parse('exists su name helper be mind via state "qwen3" ya'));

    process.env.PYA_MIND_RESPONSE = JSON.stringify([
      { message: { content: "done" } }
    ]);

    const sent = [];
    const adapter = {
      async receive() {
        return {
          events: [
            {
              channelType: "matrix",
              channelId: "!dm:server",
              eventId: "$dm-none-1",
              sender: "@u:server",
              text: "please do a web search for pyash"
            }
          ],
          checkpoint: { nextBatch: "tok-dm-none" }
        };
      },
      async send({ content }) {
        sent.push(content);
        return { eventId: "$out-dm-none" };
      }
    };

    const result = await runChannelOnce({
      agentName: "helper",
      channelType: "matrix",
      channelConfig: {
        user: "@helper:server",
        mentionGate: false,
        dmRooms: ["!dm:server"],
        dmToolSummary: true
      },
      adapter,
      interpretFn: interpret,
      agentHouse
    });

    assert.equal(result.handled, 1);
    assert.equal(result.sent, 2);
    assert.equal(sent.length, 2);
    assert.equal(sent[0], "tool call: none");
    assert.equal(sent[1], "done");
  } finally {
    if (originalMock === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = originalMock;
    forget();
    resetMindLogs();
  }
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

    const outDenied = path.join(agentHouse, "denied.txt");
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

    const outAllowed = path.join(agentHouse, "allowed.txt");
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

test("channel runtime migrates legacy json state into managed .pya state", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-channel-state-migrate-"));
  const agentHouse = path.join(root, "world", "house", "helper");
  const conductDir = path.join(agentHouse, "conduct");
  await fs.mkdir(conductDir, { recursive: true });

  await fs.writeFile(
    path.join(conductDir, "checkpoint-matrix.json"),
    JSON.stringify({ nextBatch: "tok-legacy" }, null, 2)
  );
  await fs.writeFile(
    path.join(conductDir, "dedup-matrix.json"),
    JSON.stringify({ order: ["$legacy-1"] }, null, 2)
  );
  await fs.writeFile(
    path.join(conductDir, "self-events-matrix.json"),
    JSON.stringify({ order: ["$self-legacy-1"] }, null, 2)
  );

  const adapter = {
    async receive() {
      return {
        events: [
          { channelType: "matrix", channelId: "!pub:server", eventId: "$legacy-1", sender: "@u:server", text: "legacy dedup" }
        ],
        checkpoint: { nextBatch: "tok-new" }
      };
    },
    async send() {
      return { eventId: "$out-unused" };
    }
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
    interpretFn: async () => ({ ob: { text: "reply" } }),
    agentHouse
  });

  assert.equal(result.received, 1);
  assert.equal(result.handled, 0);
  assert.equal(result.skippedDedup, 1);

  const newStatePath = path.join(conductDir, "channel-state-matrix.pya");
  const newStateText = await fs.readFile(newStatePath, "utf8");
  assert.match(newStateText, /su name matrix channel state be map def/);
  assert.match(newStateText, /su name checkpoint next batch ob text "tok-new" ya/);
  assert.match(newStateText, /su name dedup event ob text "\$legacy-1" ya/);
  assert.match(newStateText, /su name self event ob text "\$self-legacy-1" ya/);

  await assert.rejects(fs.access(path.join(conductDir, "checkpoint-matrix.json")), { code: "ENOENT" });
  await assert.rejects(fs.access(path.join(conductDir, "dedup-matrix.json")), { code: "ENOENT" });
  await assert.rejects(fs.access(path.join(conductDir, "self-events-matrix.json")), { code: "ENOENT" });
});
