import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";
import { registerSignatureHandler, clearSignatureHandlers, deriveSignatureFromCall, joinSignatureWords, lookupSignatureHandler } from "../program/bridge/signature.mjs";
import { builtInSignatures } from "../program/verbs/index.mjs";
import { signatures as compileSignatures } from "../program/verbs/exchange/compile.mjs";
import { splitSentences } from "../program/library/sentenceSplitter.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

test("run_pya_program handles compile conditional example", async () => {
  const text = await fs.readFile(
    path.join(root, "examples/pyash/compile-conditional-to-js-text.pya"),
    "utf8"
  );

  forget();
  clearSignatureHandlers();
  for (const sig of [...builtInSignatures, ...compileSignatures]) {
    registerSignatureHandler(sig);
  }

  const sentences = splitSentences(text);
  let lastOutput = "";
  for (const raw of sentences) {
    const s = parse(raw.trim());

    if (s.mood === "do" && s.be === "compile") {
      const key = joinSignatureWords(deriveSignatureFromCall(s, { remember: () => null }));
      assert.ok(lookupSignatureHandler(key), `missing handler for ${key}`);
    }

    const res = await interpret(s);
    if (s?.mood === "que" && typeof res === "string") {
      lastOutput = res;
    }
  }

  assert.match(lastOutput, /if \(3 < 5\)/);
  assert.match(lastOutput, /total\.obj\.num = \(total\.obj\.num \?\? 0\) \+ 1;/);
});
