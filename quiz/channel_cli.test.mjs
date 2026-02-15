import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createCliAdapter,
  enqueueCliInbound
} from "../program/agent/channels/cli.mjs";
import { runChannelOnce } from "../program/agent/channels/index.mjs";

test("cli adapter receives from inbound with checkpoint cursor", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-cli-adapter-"));
  const worldRoot = path.join(root, "world");
  await enqueueCliInbound({
    worldRoot,
    agentName: "ccrc",
    channelId: "terminal",
    sender: "andrii",
    text: "hello one"
  });
  await enqueueCliInbound({
    worldRoot,
    agentName: "ccrc",
    channelId: "terminal",
    sender: "andrii",
    text: "hello two"
  });

  const adapter = createCliAdapter({ worldRoot, agentName: "ccrc" });
  const first = await adapter.receive({ config: {}, checkpoint: {} });
  assert.equal(first.events.length, 2);
  assert.equal(first.events[0].channelType, "cli");
  assert.equal(first.events[0].channelId, "terminal");
  assert.equal(first.events[0].sender, "andrii");
  assert.equal(first.events[0].text, "hello one");
  assert.equal(first.checkpoint.nextBatch, "2");

  const second = await adapter.receive({ config: {}, checkpoint: first.checkpoint });
  assert.equal(second.events.length, 0);
  assert.equal(second.checkpoint.nextBatch, "2");
});

test("cli adapter send integrates with channel runtime", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-cli-runtime-"));
  const worldRoot = path.join(root, "world");
  const agentHouse = path.join(worldRoot, "house", "ccrc");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });

  await enqueueCliInbound({
    worldRoot,
    agentName: "ccrc",
    channelId: "terminal",
    sender: "andrii",
    text: "hi"
  });

  const adapter = createCliAdapter({ worldRoot, agentName: "ccrc" });
  const result = await runChannelOnce({
    agentName: "ccrc",
    channelType: "cli",
    channelConfig: {
      user: "ccrc",
      publicTagAnswer: false,
      roomLanes: {}
    },
    adapter,
    interpretFn: async () => ({ ob: { text: "hello back" } }),
    agentHouse
  });

  assert.equal(result.received, 1);
  assert.equal(result.handled, 1);
  assert.equal(result.sent, 1);
});
