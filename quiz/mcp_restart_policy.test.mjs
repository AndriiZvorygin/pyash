import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, doRemember } from "../program/remember/index.mjs";
import { setExchangeRecorder, clearExchangeRecorder } from "../program/bridge/exchange.mjs";
import { closeMcpServers } from "../program/motor/mcp.mjs";

test("mcp restart policy retries on crash and then denies", async () => {
  forget();
  const records = [];
  setExchangeRecorder({ record: (sentence) => records.push(sentence) });

  doRemember({
    mood: "ya",
    su: { name: "policy restart conservative" },
    be: "json map",
    ob: {
      map: {
        policy: { text: "on crash" },
        max: { num: 1 },
        "window sec": { num: 60 },
        backoff: { text: "exponential" },
        "base ms": { num: 0 },
        "cap ms": { num: 0 }
      }
    }
  });

  doRemember({
    mood: "ya",
    su: { name: "crash" },
    be: "mcp",
    ob: { text: "bash" },
    by: { ve: { type: "text", values: ["-lc", "exit 1"] } },
    with: { name: "policy restart conservative" }
  });

  await assert.rejects(
    () => interpret(parse("from name mcp crash to name mcp crash be import do")),
    (err) => err?.sentence?.su?.name === "mcp defective"
  );

  await new Promise(resolve => setTimeout(resolve, 50));

  assert.ok(records.some(s => s?.be === "mcp restart" && s?.ob?.name === "crash"));
  assert.ok(records.some(s => s?.be === "mcp restart denied" && s?.ob?.name === "crash"));
  assert.ok(records.some(s => s?.be === "error" && s?.su?.name === "mcp server restart denied"));

  closeMcpServers();
  clearExchangeRecorder();
});
