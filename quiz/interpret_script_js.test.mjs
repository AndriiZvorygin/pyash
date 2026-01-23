import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";

const wasmtimePath = fileURLToPath(new URL("../caterer/wasmtime/bin/wasmtime", import.meta.url));
const qjsPath = fileURLToPath(new URL("../caterer/quickjs-wasi/qjs.wasm", import.meta.url));

function hasExecutable(filepath) {
  if (!fs.existsSync(filepath)) return false;
  try {
    fs.accessSync(filepath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

const hasRuntime = process.platform !== "win32" && hasExecutable(wasmtimePath) && fs.existsSync(qjsPath);

test("interpret javascript executes in WASM sandbox", { skip: !hasRuntime }, async () => {
  const sentence = parse(
    "ob text quoted.javascript.console.log(\"ok\");.javascript.quoted as wo javascript be interpret do"
  );
  const result = await interpret(sentence);
  assert.equal(result?.be, "interpret");
  assert.equal(result?.su?.name, "result");
  assert.equal(result?.ob?.text, "ok\n");
});

test("interpret rejects unsupported languages", async () => {
  const sentence = parse(
    "ob text quoted.javascript.console.log(\"ok\");.javascript.quoted as wo lua be interpret do"
  );
  await assert.rejects(
    () => interpret(sentence),
    (err) => {
      assert.equal(err?.sentence?.su?.name, "interpret defective");
      assert.match(String(err?.message ?? ""), /unsupported language/);
      return true;
    }
  );
});
