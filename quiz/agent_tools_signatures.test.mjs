import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";
import { buildToolSchemas } from "../program/verbs/mind/tooling.mjs";
import { deriveSignatureFromCall, joinSignatureWords } from "../program/bridge/signature.mjs";
import { status } from "../program/verbs/status.mjs";

async function defineToolMap(sentences) {
  for (const line of sentences) {
    await interpret(parse(line));
  }
}

test("agent tools map exposes standard tool signatures", async () => {
  forget();
  const toolSentences = [
    "su name agent tools be map def",
    "su name agent ob bool truth ya",
    "su name runtime status be status as wo runtime can",
    "su name read be read from filename input can",
    "su name read markdown be read from filename input fromstate wo html become wo markdown can",
    "su name write be write ob text input to filename input can",
    "su name list files be list from filename input can",
    "su name search be search ob text input fromstate wo web by num 3 can",
    "su name download be download from filename input as wo web to filename input can",
    "su name compile be compile from filename input to filename output can",
    "su name command be command ob text input to name text out can",
    "su name repair be repair ob text input to name map outcome can",
    "su name repair check be repair as wo check ob text input to name map outcome can",
    "su name exists be exists ob filename input can",
    "prah"
  ];
  await defineToolMap(toolSentences);

  const { toolMap } = buildToolSchemas("agent tools");
  const sentences = toolSentences
    .filter((line) => line.includes(" be ") && line.includes(" can"))
    .map((line) => parse(line));

  for (const sentence of sentences) {
    const sigWords = deriveSignatureFromCall(sentence);
    const sigKey = joinSignatureWords(sigWords);
    assert.ok(toolMap.has(sigKey), `missing signature: ${sigKey}`);
  }
});

test("runtime status reports the effective model settings for the current turn", async () => {
  forget();

  const result = await interpret(parse("be status as wo runtime do"), {
    runtimeContext: {
      model: "qwen3.8:27b",
      backend: "ollama",
      host: "http://mriczo:11434",
      reasoningEffort: "high",
      modelTuning: {
        think: false,
        temperature: 0.2,
        topP: 0.8,
        topK: 20,
        numPredict: 512
      },
      toolMap: "agent tools",
      agentName: "web assistant"
    }
  });

  assert.equal(result?.be, "map");
  assert.equal(result?.ob?.map?.model?.text, "qwen3.8:27b");
  assert.equal(result?.ob?.map?.backend?.text, "ollama");
  assert.equal(result?.ob?.map?.["runtime host"]?.text, "mriczo");
  assert.equal(result?.ob?.map?.think?.boolean, false);
  assert.equal(result?.ob?.map?.temperature?.num, 0.2);
  assert.equal(result?.ob?.map?.["top p"]?.num, 0.8);
  assert.equal(result?.ob?.map?.["max output tokens"]?.num, 512);
  assert.equal(result?.ob?.map?.["context length"]?.text, "unavailable");
});

test("runtime status fills missing settings from Ollama model metadata", async () => {
  const requests = [];
  const result = await status(parse("be status as wo runtime do"), {
    runtimeContext: {
      model: "swift-qwen3.8:27b",
      backend: "ollama command mind",
      host: "http://mriczo:11434",
      modelTuning: { think: false },
      probeProvider: true,
      toolMap: "agent tools",
      agentName: "web assistant"
    },
    fetchFn: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        async json() {
          return {
            model_info: {
              "qwen35.context_length": 262144,
              "general.architecture": "qwen35"
            },
            parameters: "temperature                    1\ntop_k                          20\ntop_p                          0.95\nmin_p                          0",
            details: {
              family: "qwen35",
              parameter_size: "27.3B",
              quantization_level: "Q4_K_M"
            },
            capabilities: ["completion", "tools", "thinking"]
          };
        }
      };
    }
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "http://mriczo:11434/api/show");
  assert.deepEqual(JSON.parse(requests[0].options.body), { model: "swift-qwen3.8:27b" });
  assert.equal(result?.ob?.map?.temperature?.num, 1);
  assert.equal(result?.ob?.map?.["top p"]?.num, 0.95);
  assert.equal(result?.ob?.map?.["top k"]?.num, 20);
  assert.equal(result?.ob?.map?.["context length"]?.num, 262144);
  assert.equal(result?.ob?.map?.["context length source"]?.text, "Ollama model maximum; no request override");
  assert.equal(result?.ob?.map?.["max output tokens"]?.text, "provider default");
  assert.equal(result?.ob?.map?.["parameter size"]?.text, "27.3B");
  assert.equal(result?.ob?.map?.quantization?.text, "Q4_K_M");
  assert.equal(result?.ob?.map?.capabilities?.text, "completion, tools, thinking");
});

test("agent tools map shortens long mcp tool names using readable subject words", async () => {
  forget();
  const toolSentences = [
    "su name agent tools be map def",
    "su name read markdown be read from filename input fromstate wo html become wo markdown can",
    "prah"
  ];
  await defineToolMap(toolSentences);

  const { tools, toolMap } = buildToolSchemas("agent tools");
  const names = tools.map((tool) => tool?.function?.name).filter(Boolean);
  assert.ok(names.includes("be_read_markdown_from_filename"));
  assert.ok(!names.includes("be_read_become_wo_markdown_from_filename_fromstate_wo_html"));
  assert.ok(toolMap.has("be_read_markdown_from_filename"));
});
