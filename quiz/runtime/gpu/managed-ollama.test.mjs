import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_TEXT_MODEL,
  requestManagedOllamaChat,
  resolveGpuHousekeeperUrl,
  submitManagedGpuJob,
} from "../../../program/runtime/gpu/managed-ollama.mjs";
import { resolveTextModel, resolveVisionModel } from "../../../program/runtime/gpu/text-model.mjs";

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "error",
    async json() { return payload; },
    async text() { return JSON.stringify(payload); },
  };
}

test("remote Ollama requests submit to the GPU housekeeper with Qwen resource demand", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    if (url.endsWith("/submit")) return response({ accepted: true, remoteJobId: "job-abc" });
    if (url.endsWith("/job/job-abc")) return response({ status: "success", result: { message: { content: "ok" } } });
    throw new Error(`unexpected URL ${url}`);
  };

  const result = await requestManagedOllamaChat({
    ollamaUrl: "http://mriczo:11434/api/chat",
    managerUrl: "http://mriczo:8090",
    messages: [{ role: "user", content: "Say ok" }],
    fetchImpl,
    pollIntervalMs: 1,
  });

  assert.equal(result.message.content, "ok");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "http://mriczo:8090/submit");
  assert.equal(calls[0].body.runtimeName, "ollama");
  assert.equal(calls[0].body.profileName, "hf.co/empero-ai/Qwen3.8-9B-Distill-GGUF:Q4_K_M");
  assert.equal(calls[0].body.jobSpec.kind, "ollama-chat");
  assert.equal(calls[0].body.jobSpec.resourceRequest.vramRequiredMb, 12000);
  assert.equal(calls[0].body.jobSpec.payload.model, "hf.co/empero-ai/Qwen3.8-9B-Distill-GGUF:Q4_K_M");
});

test("text and vision models are loaded from declarative pya configuration", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-model-config-"));
  const runtimePath = path.join(dir, "runtime.pya");
  await fs.writeFile(runtimePath, [
    'su name model ob text "runtime-text-model" ya',
    'su name see default mind ob text "runtime-vision-model" ya',
  ].join("\n"), "utf8");
  assert.equal(resolveTextModel("", { runtimePath, env: {} }), "runtime-text-model");
  assert.equal(resolveVisionModel("", { runtimePath, env: {} }), "runtime-vision-model");
  // The legacy environment-object call shape remains supported for callers
  // that have not migrated to the explicit options object.
  assert.equal(resolveTextModel("", { PYA_TEXT_MODEL: "env-text-model" }), "env-text-model");
  assert.equal(DEFAULT_TEXT_MODEL, "hf.co/empero-ai/Qwen3.8-9B-Distill-GGUF:Q4_K_M");
  assert.equal(resolveVisionModel(), "qwen3.5:9b");

  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, body: options.body ? JSON.parse(options.body) : null });
    if (url.endsWith("/submit")) return response({ remoteJobId: "configured-job" });
    return response({ status: "success", result: { message: { content: "configured" } } });
  };
  await requestManagedOllamaChat({
    ollamaUrl: "http://mriczo:11434/api/chat",
    managerUrl: "http://mriczo:8090",
    runtimePath,
    env: {},
    messages: [{ role: "user", content: "hello" }],
    fetchImpl,
    pollIntervalMs: 1,
  });
  assert.equal(calls[0].body.jobSpec.payload.model, "runtime-text-model");
});

test("housekeeper URL derives from remote provider ports and stays local-free", () => {
  assert.equal(resolveGpuHousekeeperUrl({ ollamaUrl: "http://mriczo:8188" }), "http://mriczo:8090");
  assert.equal(resolveGpuHousekeeperUrl({ ollamaUrl: "http://localhost:11434" }), "");
  assert.equal(resolveGpuHousekeeperUrl({ managerUrl: "http://gpu-manager:8090/" }), "http://gpu-manager:8090");
});

test("generic ComfyUI jobs use the same manager queue and return the remote result", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, body: options.body ? JSON.parse(options.body) : null });
    if (url.endsWith("/submit")) return response({ remoteJobId: "job-comfy" });
    return response({ status: "completed", result: { promptId: "prompt-1", history: { outputs: {} } } });
  };
  const result = await submitManagedGpuJob({
    runtimeName: "comfyui",
    profileName: "qwen3-asr",
    providerUrl: "http://mriczo:8188",
    managerUrl: "http://mriczo:8090",
    jobSpec: { kind: "comfyui-hear", prompt: { "1": { class_type: "LoadAudio", inputs: {} } } },
    fetchImpl,
    pollIntervalMs: 1,
  });
  assert.equal(result.promptId, "prompt-1");
  assert.equal(result.remoteJobId, "job-comfy");
  assert.equal(calls[0].url, "http://mriczo:8090/submit");
  assert.equal(calls[0].body.runtimeName, "comfyui");
  assert.equal(calls[0].body.jobSpec.resourceRequest.vramRequiredMb, 12000);
});
