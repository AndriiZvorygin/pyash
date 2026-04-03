import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pyaFileToJson } from "../program/library/pya_to_json.mjs";

test("pya_to_json parses pya and emits index entries", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pya-to-json-"));
  const input = path.join(dir, "sample.pya");
  fs.writeFileSync(input, [
    "# managed by test:start",
    "exists su name ollama host ob text \"http://mriczo:11434\" be default ya",
    "exists su name speaker host ob text \"http://mriczo:8010\" be default ya",
    "# managed by test:end",
    "",
  ].join("\n"), "utf8");

  const out = await pyaFileToJson(input);
  assert.ok(Array.isArray(out.memory));
  assert.ok(out.index);
  assert.equal(out.index["ollama host"]?.ob, "http://mriczo:11434");
  assert.equal(out.index["speaker host"]?.ob, "http://mriczo:8010");
});

test("pya_to_json --memory-only excludes index", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pya-to-json-"));
  const input = path.join(dir, "memory-only.pya");
  fs.writeFileSync(input, "exists su name alpha ob text \"beta\" be text ya\n", "utf8");

  const out = await pyaFileToJson(input, { memoryOnly: true });
  assert.ok(Array.isArray(out.memory));
  assert.equal(Object.hasOwn(out, "index"), false);
});

test("pya_to_json handles large pya files (stress)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pya-to-json-stress-"));
  const input = path.join(dir, "stress.pya");
  const lines = [];
  lines.push("exists su name anchor ob text \"start\" be text ya");
  for (let i = 0; i < 2200; i += 1) {
    lines.push(`exists su name var_${String(i).padStart(4, "0")} ob num ${i} be number ya`);
  }
  lines.push("exists su name anchor ob text \"end\" be text ya");
  fs.writeFileSync(input, `${lines.join("\n")}\n`, "utf8");

  const out = await pyaFileToJson(input);
  assert.ok(Array.isArray(out.memory));
  assert.ok(out.memory.length >= 2201);
  assert.equal(out.index["anchor"]?.ob, "end");
  assert.equal(out.index["var_2199"]?.ob, 2199);
});
