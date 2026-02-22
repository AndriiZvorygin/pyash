import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { clearExchangeRecorder, setExchangeRecorder } from "../program/bridge/exchange.mjs";
import { doRemember, forget, remember } from "../program/remember/index.mjs";

test("qwen say fixture records audio and metadata artifacts", async () => {
  forget();
  const records = [];
  setExchangeRecorder({
    runRoot: process.cwd(),
    record: (sentence) => records.push(sentence)
  });
  doRemember({ mood: "ya", su: { name: "say host" }, ob: { text: "http://localhost:8188" }, be: "default" });
  doRemember({ mood: "ya", su: { name: "say workflow root" }, ob: { text: "./say/" }, be: "default" });
  doRemember({ mood: "ya", su: { name: "say workflow default" }, ob: { text: "andrii_voice_qwen3_TTS" }, be: "default" });
  process.env.PYA_SAY_COMFYUI_FIXTURE_FILE = path.resolve("quiz/fixtures/pyash_raven.png");
  try {
    await interpret(parse('su name voice ob text "hello from qwen say" be qwen say do'));
    const stored = remember("voice");
    assert.equal(stored?.be, "say");
    assert.ok(stored?.ob?.name, "returns artifact name");
    const audio = records.find(s => s.be === "artifact" && s.as?.name === "say");
    const metadata = records.find(s => s.be === "artifact" && s.as?.name === "metadata");
    assert.ok(audio, "records audio artifact");
    assert.ok(metadata, "records metadata artifact");
  } finally {
    delete process.env.PYA_SAY_COMFYUI_FIXTURE_FILE;
    clearExchangeRecorder();
  }
});

test("qwen say fails fast when text path is unresolved", async () => {
  forget();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-qwen-say-"));
  const workflowRoot = path.join(tmp, "say");
  const backendRoot = path.join(workflowRoot, "comfyui");
  await fs.mkdir(backendRoot, { recursive: true });
  const workflow = {
    nodes: [
      {
        id: 1,
        type: "NodeWithoutText",
        inputs: [{ name: "seed", type: "INT", widget: { name: "seed" }, link: null }],
        widgets_values: [1]
      }
    ],
    links: []
  };
  await fs.writeFile(path.join(backendRoot, "missing_text.json"), JSON.stringify(workflow), "utf8");

  doRemember({ mood: "ya", su: { name: "say host" }, ob: { text: "http://localhost:8188" }, be: "default" });
  doRemember({ mood: "ya", su: { name: "say workflow root" }, ob: { text: workflowRoot }, be: "default" });
  doRemember({ mood: "ya", su: { name: "say workflow default" }, ob: { text: "missing_text" }, be: "default" });

  await assert.rejects(
    async () => interpret(parse('ob text "hello" be qwen say do')),
    /text path unresolved/
  );
});
