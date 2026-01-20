import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, doRemember } from "../program/remember/index.mjs";
import { setExchangeRecorder, clearExchangeRecorder } from "../program/bridge/exchange.mjs";
import { closeMcpServers } from "../program/motor/mcp.mjs";
import { clearSignatureHandlers } from "../program/bridge/signature.mjs";
import { builtInSignatures } from "../program/verbs/index.mjs";
import { signatures as compileSignatures } from "../program/verbs/exchange/compile.mjs";
import { registerSignatureHandler } from "../program/bridge/signature.mjs";

test("mcp crash vs clean exit recorded", async () => {
  forget();
  clearSignatureHandlers();
  for (const sig of [...builtInSignatures, ...compileSignatures]) {
    registerSignatureHandler(sig);
  }
  const records = [];
  setExchangeRecorder({ record: (sentence) => records.push(sentence) });

  doRemember({
    mood: "ya",
    su: { name: "clean" },
    be: "mcp",
    ob: { text: "bash" },
    by: { ve: { type: "text", values: ["-lc", "exit 0"] } }
  });
  await assert.rejects(
    () => interpret(parse("from name mcp clean to name mcp clean be import do")),
    (err) => err?.sentence?.su?.name === "mcp defective"
  );
  assert.ok(records.some(s => s?.be === "mcp exit" && s?.su?.name === "mcp server exit"));

  doRemember({
    mood: "ya",
    su: { name: "crash" },
    be: "mcp",
    ob: { text: "bash" },
    by: { ve: { type: "text", values: ["-lc", "exit 1"] } }
  });
  await assert.rejects(
    () => interpret(parse("from name mcp crash to name mcp crash be import do")),
    (err) => err?.sentence?.su?.name === "mcp defective"
  );
  assert.ok(records.some(s => s?.be === "error" && s?.su?.name === "mcp server crash"));

  closeMcpServers();
  clearExchangeRecorder();
});
