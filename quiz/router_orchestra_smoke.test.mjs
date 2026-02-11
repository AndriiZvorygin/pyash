import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runChannelOnce } from "../program/agent/channels/index.mjs";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("channel run routes input through router, executes orchestrator+saddle path, then routes produce", async () => {
  forget();
  const originalMindResponse = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "orchestra reply";
  try {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-router-orchestra-smoke-"));
    const agentHouse = path.join(root, "world", "house", "pyash-agent");
    await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });

    await interpret(parse('exists su name pyash-agent be mind as name "qwen3-vl:8b-instruct" ya'));

    const sent = [];
    const adapter = {
      async receive() {
        return {
          events: [{
            channelType: "matrix",
            channelId: "!pyash:server",
            eventId: "$in-1",
            sender: "@user:server",
            text: "hi orchestra"
          }],
          checkpoint: { nextBatch: "tok-router-smoke" }
        };
      },
      async send({ content }) {
        sent.push(String(content));
        return { eventId: "$out-1" };
      }
    };

    const routerTrace = [];
    const routerInterpretFn = async (sentence) => {
      const result = await interpret(sentence);
      routerTrace.push({ sentence, result });
      return result;
    };

    const result = await runChannelOnce({
      agentName: "pyash-agent",
      channelType: "matrix",
      channelConfig: {
        user: "@pyash-agent:server",
        mentionGate: false,
        roomLanes: { "!pyash:server": "matrix_main" }
      },
      adapter,
      interpretFn: interpret,
      routerInterpretFn,
      agentHouse
    });

    assert.equal(result.received, 1);
    assert.equal(result.handled, 1);
    assert.equal(result.sent, 1);
    assert.equal(sent.length, 1);
    assert.match(sent[0], /orchestra reply/);

    assert.equal(routerTrace.length, 2);
    assert.equal(routerTrace[0]?.sentence?.as?.wo, "input");
    assert.equal(routerTrace[0]?.result?.be, "input");
    assert.equal(routerTrace[1]?.sentence?.as?.wo, "produce");
    assert.equal(routerTrace[1]?.result?.be, "produce");
    assert.equal(
      routerTrace[1]?.sentence?.accordingto?.text,
      routerTrace[0]?.result?.su?.name
    );
  } finally {
    if (originalMindResponse === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = originalMindResponse;
    forget();
  }
});
