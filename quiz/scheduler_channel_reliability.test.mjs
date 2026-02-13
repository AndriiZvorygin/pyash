import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createScheduler } from "../program/agent/scheduler.mjs";
import { runChannelOnce } from "../program/agent/channels/index.mjs";

test("scheduler and channel run reliably across repeated poll cycles without fixtures", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-scheduler-channel-reliability-"));
  const worldRoot = path.join(root, "world");
  const agentHouse = path.join(worldRoot, "house", "channel-postmaster");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });
  await fs.mkdir(path.join(worldRoot, "newspaper"), { recursive: true });

  let receiveCount = 0;
  let sendCount = 0;
  const adapter = {
    async receive() {
      receiveCount += 1;
      return {
        events: [
          {
            channelType: "matrix",
            channelId: "!shared:server",
            eventId: "$shared-1",
            sender: "@user:server",
            text: "team status?"
          }
        ],
        checkpoint: { nextBatch: `tok-${receiveCount}` }
      };
    },
    async send() {
      sendCount += 1;
      return { eventId: `$out-${sendCount}` };
    }
  };

  const scheduler = createScheduler({
    jobs: [{
      jobName: "matrix probe",
      laneName: "matrix_probe",
      intervalMs: 60 * 1000,
      agentName: "channel-postmaster",
      prompt: "",
      withCase: { wo: "tools" }
    }],
    telemetryPath: path.join(worldRoot, "newspaper", "scheduler-reliability.pya"),
    runJob: async () => runChannelOnce({
      agentName: "channel-postmaster",
      channelType: "matrix",
      channelConfig: {
        user: "@channel-postmaster:server",
        publicTagAnswer: false,
        listeners: ["confederation-priest", "agent-helper"],
        roomListeners: {},
        dmRooms: []
      },
      adapter,
      interpretFn: async (sentence) => ({ ob: { text: `reply:${sentence?.for?.name}` } }),
      agentHouse
    })
  });

  await scheduler.runNow();
  await scheduler.runNow();
  await scheduler.flushTelemetry();

  const snap = scheduler.snapshot();
  assert.equal(snap.length, 1);
  assert.equal(snap[0]?.runs, 2);
  assert.equal(snap[0]?.errorCount, 0);
  assert.equal(snap[0]?.lastStatus, "ok");
  assert.equal(receiveCount, 2);
  assert.equal(sendCount, 2, "first cycle fans out to two listeners; second cycle dedups repeated event");

  const newspaperFiles = await fs.readdir(path.join(worldRoot, "newspaper"));
  const channelLog = newspaperFiles.find(name => /channel-matrix-channel-postmaster\.pya$/.test(name));
  assert.ok(channelLog, "channel telemetry log should exist");
  const channelText = await fs.readFile(path.join(worldRoot, "newspaper", channelLog), "utf8");
  assert.match(channelText, /be channel telemetry/);
  assert.match(channelText, /\\"handled\\":2/);
  assert.match(channelText, /\\"skippedDedup\\":1/);

  const schedulerText = await fs.readFile(path.join(worldRoot, "newspaper", "scheduler-reliability.pya"), "utf8");
  assert.match(schedulerText, /be scheduler telemetry/);
});
