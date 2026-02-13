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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

test("channel runtime lock prevents duplicate handling across concurrent polls", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-channel-lock-"));
  const agentHouse = path.join(root, "world", "house", "helper");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });

  let receives = 0;
  let sends = 0;
  let interprets = 0;
  const adapter = {
    async receive() {
      receives += 1;
      await sleep(120);
      return {
        events: [
          { channelType: "matrix", channelId: "!room:server", eventId: "$lock-1", sender: "@u:server", text: "hello" }
        ],
        checkpoint: { nextBatch: "tok-lock" }
      };
    },
    async send() {
      sends += 1;
      return { eventId: "$out-lock" };
    }
  };

  const interpretFn = async () => {
    interprets += 1;
    return { ob: { text: "reply" } };
  };

  const channelConfig = {
    user: "@self:server",
    mentionGate: false,
    roomLanes: {}
  };

  const [a, b] = await Promise.all([
    runChannelOnce({
      agentName: "helper",
      channelType: "matrix",
      channelConfig,
      adapter,
      interpretFn,
      agentHouse
    }),
    runChannelOnce({
      agentName: "helper",
      channelType: "matrix",
      channelConfig,
      adapter,
      interpretFn,
      agentHouse
    })
  ]);

  assert.equal(receives, 1);
  assert.equal(interprets, 1);
  assert.equal(sends, 1);
  assert.equal((a.handled ?? 0) + (b.handled ?? 0), 1);
  assert.equal((a.locked === true ? 1 : 0) + (b.locked === true ? 1 : 0), 1);
});

test("channel runtime marks matrix events seen before response generation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-channel-seen-"));
  const agentHouse = path.join(root, "world", "house", "helper");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });

  const order = [];
  const adapter = {
    async receive() {
      return {
        events: [
          {
            channelType: "matrix",
            channelId: "!room:server",
            eventId: "$seen-1",
            sender: "@u:server",
            text: "hello"
          }
        ],
        checkpoint: { nextBatch: "tok-seen" }
      };
    },
    async markSeen() {
      order.push("seen");
      await sleep(5);
      return { ok: true };
    },
    async send() {
      order.push("send");
      return { eventId: "$out-seen" };
    }
  };

  const interpretFn = async () => {
    order.push("interpret");
    return { ob: { text: "reply" } };
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
  assert.equal(order[0], "seen");
  assert.equal(order.includes("interpret"), true);
  assert.equal(order.includes("send"), true);
});

test("channel runtime clears stale lock when lock owner pid is not alive", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-channel-stale-lock-"));
  const agentHouse = path.join(root, "world", "house", "helper");
  const presenceDir = path.join(root, "world", "presence");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });
  await fs.mkdir(presenceDir, { recursive: true });
  const staleLockPath = path.join(presenceDir, "helper-matrix-channel-input.lock");
  await fs.writeFile(
    staleLockPath,
    "pid=999999999\nstartedAt=2026-02-12T00:00:00.000Z\nagent=helper\nchannel=matrix\n",
    "utf8"
  );

  let sends = 0;
  const adapter = {
    async receive() {
      return {
        events: [
          { channelType: "matrix", channelId: "!room:server", eventId: "$stale-1", sender: "@u:server", text: "hello" }
        ],
        checkpoint: { nextBatch: "tok-stale" }
      };
    },
    async send() {
      sends += 1;
      return { eventId: "$out-stale" };
    }
  };

  const result = await runChannelOnce({
    agentName: "helper",
    channelType: "matrix",
    channelConfig: { user: "@self:server", mentionGate: false, roomLanes: {} },
    adapter,
    interpretFn: async () => ({ ob: { text: "reply" } }),
    agentHouse
  });

  assert.equal(result.locked, undefined);
  assert.equal(result.handled, 1);
  assert.equal(sends, 1);
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

test("channel runtime mention gate allows direct-room events without configured dmRooms", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-channel-mention-direct-"));
  const agentHouse = path.join(root, "world", "house", "helper");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });

  const adapter = {
    async receive() {
      return {
        events: [
          { channelType: "matrix", channelId: "!pub:server", eventId: "$1", sender: "@u:server", text: "hello all" },
          { channelType: "matrix", channelId: "!dm:server", eventId: "$2", sender: "@u:server", text: "dm hello", dmRoom: true }
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
      dmRooms: [],
      roomLanes: {}
    },
    adapter,
    interpretFn,
    agentHouse
  });
  assert.equal(calls, 1);
  assert.equal(result.handled, 1);
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

test("channel runtime stores channel attachments and includes file hints in prompt", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-channel-attachments-"));
  const worldRoot = path.join(root, "world");
  const agentHouse = path.join(root, "world", "house", "helper");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });
  await fs.mkdir(path.join(worldRoot, "conduct"), { recursive: true });
  await fs.writeFile(path.join(worldRoot, "conduct", "import.pya"), [
    "su name import be map def",
    "  su name read tool ob text \"be read from filename <path> ...\" ya",
    "  su name see tool ob text \"be see from filename <photograph> ...\" ya",
    "  su name command tool ob text \"be command ...\" ya",
    "  su name repair tool ob text \"be repair ...\" ya",
    "prah",
    ""
  ].join("\n"), "utf8");

  const sent = [];
  const adapter = {
    async receive() {
      return {
        events: [
          {
            channelType: "matrix",
            channelId: "!room:server",
            eventId: "$f1",
            sender: "@u:server",
            text: "please inspect the attached file",
            timestamp: "2026-02-12T19:00:00.000Z",
            attachments: [
              {
                kind: "m.file",
                body: "notes.txt",
                mxcUrl: "mxc://matrix.example.org/abc123",
                mimetype: "text/plain"
              }
            ]
          }
        ],
        checkpoint: { nextBatch: "tok-file-1" }
      };
    },
    async downloadAttachments({ targetDir }) {
      const filePath = path.join(targetDir, "notes.txt");
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(filePath, "hello", "utf8");
      return [{
        filename: "notes.txt",
        path: filePath,
        mimeType: "text/plain",
        bytes: 5
      }];
    },
    async send({ content }) {
      sent.push(content);
      return { eventId: "$out-file-1" };
    }
  };

  const calls = [];
  const interpretFn = async (sentence) => {
    calls.push(sentence);
    return { ob: { text: "done" } };
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
  assert.equal(calls.length, 1);
  const prompt = String(calls[0]?.ob?.text ?? "");
  assert.match(prompt, /\[channel files saved\]/);
  assert.match(prompt, /artifacts\/20260212\/notes\.txt/);
  assert.match(prompt, /be read/);
  assert.match(prompt, /be see/);
  assert.match(prompt, /be command/);
  assert.match(prompt, /be repair/);
  assert.equal(sent[sent.length - 1], "done");
});

test("channel runtime omits attachment tool hints when import conduct has none", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-channel-attachments-no-hints-"));
  const agentHouse = path.join(root, "world", "house", "helper");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });

  const adapter = {
    async receive() {
      return {
        events: [
          {
            channelType: "matrix",
            channelId: "!room:server",
            eventId: "$f1-no-hints",
            sender: "@u:server",
            text: "inspect this",
            timestamp: "2026-02-12T19:00:00.000Z",
            attachments: [
              {
                kind: "m.file",
                body: "notes.txt",
                mxcUrl: "mxc://matrix.example.org/nohints",
                mimetype: "text/plain"
              }
            ]
          }
        ],
        checkpoint: { nextBatch: "tok-file-no-hints" }
      };
    },
    async downloadAttachments({ targetDir }) {
      const filePath = path.join(targetDir, "notes.txt");
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(filePath, "hello", "utf8");
      return [{
        filename: "notes.txt",
        path: filePath,
        mimeType: "text/plain",
        bytes: 5
      }];
    },
    async send() {
      return { eventId: "$out-file-no-hints" };
    }
  };

  const calls = [];
  const interpretFn = async (sentence) => {
    calls.push(sentence);
    return { ob: { text: "done" } };
  };

  await runChannelOnce({
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

  const prompt = String(calls[0]?.ob?.text ?? "");
  assert.match(prompt, /\[channel files saved\]/);
  assert.doesNotMatch(prompt, /\[tools for files\]/);
});

test("channel runtime injects auto image task for upload-only events", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-channel-image-auto-task-"));
  const worldRoot = path.join(root, "world");
  const agentHouse = path.join(root, "world", "house", "helper");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });
  await fs.mkdir(path.join(worldRoot, "conduct"), { recursive: true });
  await fs.writeFile(path.join(worldRoot, "conduct", "import.pya"), [
    "su name import be map def",
    "  su name photograph ob text \"analyze photograph directly; if unavailable call be see from filename\" ya",
    "prah",
    ""
  ].join("\n"), "utf8");

  const adapter = {
    async receive() {
      return {
        events: [
          {
            channelType: "matrix",
            channelId: "!room:server",
            eventId: "$img1",
            sender: "@u:server",
            text: "photo.png",
            timestamp: "2026-02-12T19:00:00.000Z",
            attachments: [
              {
                kind: "m.image",
                body: "photo.png",
                mxcUrl: "mxc://matrix.example.org/def456",
                mimetype: "image/png"
              }
            ]
          }
        ],
        checkpoint: { nextBatch: "tok-img-auto-1" }
      };
    },
    async downloadAttachments({ targetDir }) {
      const filePath = path.join(targetDir, "photo.png");
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(filePath, "png", "utf8");
      return [{
        filename: "photo.png",
        path: filePath,
        mimeType: "image/png",
        bytes: 3
      }];
    },
    async send() {
      return { eventId: "$out-img-auto-1" };
    }
  };

  const calls = [];
  const interpretFn = async (sentence) => {
    calls.push(sentence);
    return { ob: { text: "done" } };
  };

  await runChannelOnce({
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

  const prompt = String(calls[0]?.ob?.text ?? "");
  assert.match(prompt, /\[channel auto task\]/);
  assert.match(prompt, /Photograph upload detected/);
  assert.match(prompt, /analyze photograph directly/);
  assert.match(prompt, /call be see from filename/);
});

test("channel runtime uses import conduct actions for image attachments", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-channel-import-map-"));
  const agentHouse = path.join(root, "world", "house", "helper");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });
  await fs.writeFile(path.join(agentHouse, "conduct", "import.pya"), [
    "su name import be map def",
    "  su name photograph ob text \"receipt photograph refine\" ya",
    "prah",
    ""
  ].join("\n"), "utf8");

  const adapter = {
    async receive() {
      return {
        events: [
          {
            channelType: "matrix",
            channelId: "!room:server",
            eventId: "$img-import-1",
            sender: "@u:server",
            text: "receipt.png",
            timestamp: "2026-02-12T19:00:00.000Z",
            attachments: [
              {
                kind: "m.image",
                body: "receipt.png",
                mxcUrl: "mxc://matrix.example.org/xyz123",
                mimetype: "image/png"
              }
            ]
          }
        ],
        checkpoint: { nextBatch: "tok-img-import-1" }
      };
    },
    async downloadAttachments({ targetDir }) {
      const filePath = path.join(targetDir, "receipt.png");
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(filePath, "png", "utf8");
      return [{
        filename: "receipt.png",
        path: filePath,
        mimeType: "image/png",
        bytes: 3
      }];
    },
    async send() {
      return { eventId: "$out-img-import-1" };
    }
  };

  const calls = [];
  const interpretFn = async (sentence) => {
    calls.push(sentence);
    return { ob: { text: "done" } };
  };

  await runChannelOnce({
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

  const prompt = String(calls[0]?.ob?.text ?? "");
  assert.match(prompt, /\[channel auto task\]/);
  assert.match(prompt, /do receipt photograph refine/);
  assert.match(prompt, /\[import do\]/);
  assert.match(prompt, /do receipt photograph refine/);
});

test("channel runtime surfaces attachment download defects into prompt context", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-channel-attachment-defect-"));
  const agentHouse = path.join(root, "world", "house", "helper");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });

  const adapter = {
    async receive() {
      return {
        events: [
          {
            channelType: "matrix",
            channelId: "!room:server",
            eventId: "$f2",
            sender: "@u:server",
            text: "please inspect image",
            timestamp: "2026-02-12T19:00:00.000Z",
            attachments: [
              { kind: "m.image", body: "photo.png", mxcUrl: "mxc://matrix.example.org/def456", mimetype: "image/png" }
            ]
          }
        ],
        checkpoint: { nextBatch: "tok-file-2" }
      };
    },
    async downloadAttachments() {
      throw new Error("matrix media download failed: source=mxc://matrix.example.org/def456");
    },
    async send() {
      return { eventId: "$out-file-2" };
    }
  };

  const calls = [];
  const interpretFn = async (sentence) => {
    calls.push(sentence);
    return { ob: { text: "done" } };
  };

  await runChannelOnce({
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

  const prompt = String(calls[0]?.ob?.text ?? "");
  assert.match(prompt, /\[channel file download defects\]/);
  assert.match(prompt, /photo\.png/);
  assert.match(prompt, /matrix media download failed/);
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

test("channel runtime pins listeners to self when self is in configured listener vector", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-channel-self-listener-"));
  const agentHouse = path.join(root, "world", "house", "mricge");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });

  const listeners = [];
  const adapter = {
    async receive() {
      return {
        events: [
          {
            channelType: "matrix",
            channelId: "!pub:server",
            eventId: "$self-1",
            sender: "@u:server",
            text: "status"
          }
        ],
        checkpoint: { nextBatch: "tok-self" }
      };
    },
    async send() {
      return { eventId: "$out-self" };
    }
  };

  const result = await runChannelOnce({
    agentName: "mricge",
    channelType: "matrix",
    channelConfig: {
      user: "@mricge:server",
      mentionGate: false,
      listeners: ["mricge", "accountant"],
      roomListeners: {},
      dmRooms: []
    },
    adapter,
    interpretFn: async (sentence) => {
      listeners.push({
        name: sentence?.for?.name,
        cwd: sentence?.at?.filename ?? ""
      });
      return { ob: { text: "reply" } };
    },
    agentHouse
  });

  assert.equal(result.received, 1);
  assert.equal(result.handled, 1);
  assert.equal(result.sent, 1);
  assert.deepEqual(listeners, [
    { name: "mricge", cwd: path.join(root, "world", "house", "mricge") }
  ]);
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
    assert.match(sent[0], /^tool call: be_command_ob_text_to_name_text args: /);
    assert.match(sent[0], /"ob":"echo hi"/);
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

test("channel runtime see tool summary uses ceremony return instead of stale result memory", async () => {
  const originalMock = process.env.PYA_MIND_RESPONSE;
  const originalSeeFixture = process.env.PYA_SEE_VL_FIXTURE;
  try {
    forget();
    resetMindLogs();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-channel-dm-see-summary-"));
    const worldRoot = path.join(root, "world");
    const agentHouse = path.join(worldRoot, "house", "helper");
    await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });
    doRemember({ mood: "ya", su: { name: "world root" }, be: "root", ob: { filename: worldRoot } });
    await interpret(parse("from name ./module/see_vl.pya to name see vl be import do"));
    await interpret(parse("exists su name helper be mind via state \"qwen3\" ya"));

    process.env.PYA_SEE_VL_FIXTURE = "fixture vision text";
    process.env.PYA_MIND_RESPONSE = JSON.stringify([
      {
        message: {
          content: "",
          tool_calls: [
            {
              id: "call-see-1",
              function: {
                name: "be_see_from_filename",
                arguments: JSON.stringify({ from: "/workplace/quiz/fixtures/pyash_raven.png" })
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
              eventId: "$dm-see-1",
              sender: "@u:server",
              text: "please check this image"
            }
          ],
          checkpoint: { nextBatch: "tok-dm-see" }
        };
      },
      async send({ content }) {
        sent.push(content);
        return { eventId: "$out-dm-see" };
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
    assert.match(sent[0], /^tool call: be_see_from_filename args: /);
    assert.match(sent[1], /^tool result: be_see_from_filename:/);
    assert.doesNotMatch(sent[1], /please check this image/);
    assert.match(sent[2], /^done$/);
  } finally {
    if (originalMock === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = originalMock;
    if (originalSeeFixture === undefined) delete process.env.PYA_SEE_VL_FIXTURE;
    else process.env.PYA_SEE_VL_FIXTURE = originalSeeFixture;
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
