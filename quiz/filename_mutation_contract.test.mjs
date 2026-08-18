import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import {
  deriveSignatureFromCall,
  joinSignatureWords,
  lookupSignatureHandler
} from "../program/bridge/signature.mjs";
import { builtInSignatures } from "../program/verbs/index.mjs";
import { doRemember, forget } from "../program/remember/index.mjs";

const canonicalSignatures = [
  ["be", "touch", "ob", "filename"],
  ["be", "touch", "ob", "name", "filename"],
  ["be", "copy", "ob", "filename", "to", "filename"],
  ["be", "copy", "ob", "name", "filename", "to", "filename"],
  ["be", "copy", "ob", "filename", "to", "name", "filename"],
  ["be", "copy", "ob", "name", "filename", "to", "name", "filename"],
  ["be", "rename", "ob", "filename", "to", "filename"],
  ["be", "rename", "ob", "name", "filename", "to", "filename"],
  ["be", "rename", "ob", "filename", "to", "name", "filename"],
  ["be", "rename", "ob", "name", "filename", "to", "name", "filename"],
  ["be", "delete", "as", "wo", "file", "ob", "filename"],
  ["be", "delete", "as", "wo", "file", "ob", "name", "filename"]
];

function signatureFor(line, remember = () => undefined) {
  return deriveSignatureFromCall(parse(line), { remember });
}

test("filename mutation canonical signatures are frozen and handler-backed", () => {
  const registered = new Set(
    builtInSignatures
      .filter(({ signatureWords }) => ["touch", "copy", "rename", "delete"].includes(signatureWords[1]))
      .map(({ signatureWords }) => joinSignatureWords(signatureWords))
  );
  for (const words of canonicalSignatures) {
    const key = joinSignatureWords(words);
    assert.equal(registered.has(key), true, `missing canonical signature: ${key}`);
    assert.equal(typeof lookupSignatureHandler(key), "function", `missing handler: ${key}`);
  }
});

test("filename mutation derives and dispatches literal and named filename calls", async () => {
  forget();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-contract-"));
  const source = path.join(root, "source.txt");
  const copy = path.join(root, "copy.txt");
  doRemember({ mood: "ya", su: { name: "source" }, be: "filename", ob: { filename: source } });
  doRemember({ mood: "ya", su: { name: "copy" }, be: "filename", ob: { filename: copy } });

  assert.deepEqual(signatureFor(`be touch ob filename "${source}" do`), canonicalSignatures[0]);
  assert.deepEqual(signatureFor("be touch ob name filename source do", name => {
    return name === "source" ? { be: "filename", ob: { filename: source } } : undefined;
  }), canonicalSignatures[1]);
  assert.deepEqual(signatureFor(`be copy ob filename "${source}" to filename "${copy}" do`), canonicalSignatures[2]);
  assert.deepEqual(signatureFor("be copy ob name filename source to name filename copy do", name => {
    return name === "source" || name === "copy" ? { be: "filename", ob: { filename: name === "source" ? source : copy } } : undefined;
  }), canonicalSignatures[5]);

  const touched = await interpret(parse("be touch ob name filename source do"));
  assert.equal(touched?.value?.filename, source);
  await fs.writeFile(source, "contract", "utf8");
  const copied = await interpret(parse("be copy ob name filename source to name filename copy do"));
  assert.equal(copied?.value?.filename, copy);
  assert.equal(await fs.readFile(copy, "utf8"), "contract");
  await fs.rm(root, { recursive: true, force: true });
});
