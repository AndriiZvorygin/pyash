import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, doRemember } from "../program/remember/index.mjs";
import { clearSignatureHandlers, registerSignatureHandler } from "../program/bridge/signature.mjs";
import { builtInSignatures } from "../program/verbs/index.mjs";
import { signatures as compileSignatures } from "../program/verbs/exchange/compile.mjs";

test("mcp ws transport is rejected deterministically", async () => {
  forget();
  clearSignatureHandlers();
  for (const sig of [...builtInSignatures, ...compileSignatures]) {
    registerSignatureHandler(sig);
  }

  doRemember({
    mood: "ya",
    su: { name: "remote" },
    be: "mcp",
    from: { name: "http://localhost:3999/mcp" },
    by: { wo: "ws", text: "ws" }
  });

  await assert.rejects(
    () => interpret(parse("from name mcp remote to name mcp remote be import do")),
    (err) => err?.sentence?.su?.name === "mcp transport defective"
  );
});
