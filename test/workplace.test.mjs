// test/workplace.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runWorkplace } from "../workplace.mjs";
import { dumpMemory, resetMemory } from "../memory.mjs";
import motor from "../motor/ollama.mjs";

// Helper: create a small temp JSONL file
async function makeTempJsonl(lines) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-"));
  const file = path.join(dir, "chips.jsonl");
  const body = lines.map(l => JSON.stringify(l)).join("\n") + "\n";
  await fs.writeFile(file, body, "utf8");
  return file;
}

test("workplace runs chip then mind in dependency order", async () => {
  resetMemory();

  // Stub motor.generate so we don't hit real Ollama during tests
  const originalGenerate = motor.generate;
  motor.generate = async (model, prompt) =>
    `MODEL=${model}\nPROMPT=${prompt.slice(0, 40)}`;

  const jsonlPath = await makeTempJsonl([
    { text: "first line" },
    { text: "second line" }
  ]);

  const workplace = {
    workplace: {
      sentences: [
        {
          mood: "ya",
          verb: "chip",
          subj: { name: "chiper" },
          obj: { name: "chip" },
          be: { kind: "library" },
          by: { format: "jsonl" },
          from: { path: jsonlPath }
        },
        {
          mood: "ya",
          verb: "mind",
          subj: { name: "question" },
          obj: { model: "mock-model" },
          be: { kind: "text" },
          with: {
            text: "You are a dataset-creation assistant."
          },
          from: { name: "chiper" }
        }
      ]
    }
  };

  await runWorkplace(workplace);

  const mem = dumpMemory();

  // We expect two facts: chiper, question
  const chiper = mem.find(s => s.subj?.name === "chiper");
  const question = mem.find(s => s.subj?.name === "question");

  assert.ok(chiper, "chiper sentence should be in memory");
  assert.ok(question, "question sentence should be in memory");

  // chiper.result.chips should be an array of 2 items
  assert.ok(Array.isArray(chiper.result?.chips), "chiper.result.chips should be an array");
  assert.equal(chiper.result.chips.length, 2);

  // question.result.text should come from our stubbed motor.generate
  assert.ok(typeof question.result?.text === "string");
  assert.ok(
    question.result.text.startsWith("MODEL=mock-model"),
    "mind node should use obj.model via motor.generate"
  );

  // restore original generate
  motor.generate = originalGenerate;
});

test("workplace resolves dependency order even if sentences are shuffled", async () => {
  resetMemory();

  // Stub motor again
  const originalGenerate = motor.generate;
  motor.generate = async (model, prompt) => `MODEL=${model}`;

  const jsonlPath = await makeTempJsonl([{ text: "only line" }]);

  // Intentionally place 'mind' before 'chip' in the array
  const workplace = {
    workplace: {
      sentences: [
        {
          mood: "ya",
          verb: "mind",
          subj: { name: "question" },
          obj: { model: "mock-model" },
          be: { kind: "text" },
          with: { text: "Prompt." },
          from: { name: "chiper" }
        },
        {
          mood: "ya",
          verb: "chip",
          subj: { name: "chiper" },
          obj: { name: "chip" },
          be: { kind: "library" },
          by: { format: "jsonl" },
          from: { path: jsonlPath }
        }
      ]
    }
  };

  await runWorkplace(workplace);

  const mem = dumpMemory();
  const chiper = mem.find(s => s.subj?.name === "chiper");
  const question = mem.find(s => s.subj?.name === "question");

  assert.ok(chiper, "chip node should still have run");
  assert.ok(question, "mind node should still have run");

  assert.ok(Array.isArray(chiper.result?.chips));
  assert.equal(chiper.result.chips.length, 1);

  assert.equal(question.result?.text, "MODEL=mock-model");

  motor.generate = originalGenerate;
});
