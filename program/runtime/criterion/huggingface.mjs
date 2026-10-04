import crypto from "node:crypto";
import path from "node:path";

import { enqueueInputEnvelope } from "../gpu/queue.mjs";
import { runGpuWorkerOnce } from "../gpu/worker.mjs";
import { createGpuHousekeeperAdapter } from "../gpu/housekeeper_adapter.mjs";
import {
  isTerminalHandleStatus,
  readGpuHandleStatus,
  writeGpuHandleStatus
} from "../gpu/handle_status.mjs";

export const HUGGING_FACE_MODEL_DEFAULTS = Object.freeze({
  "ahmeddeldalyyy/meeting-summarizer-meetingbank": Object.freeze({
    maxInputTokens: 1024,
    minOutputTokens: 56,
    maxOutputTokens: 142,
    numBeams: 4,
    lengthPenalty: 2.0
  }),
  "Shaelois/MeetingScript": Object.freeze({
    maxInputTokens: 4096,
    minOutputTokens: 56,
    maxOutputTokens: 142,
    numBeams: 4,
    lengthPenalty: 2.0,
    doSample: false,
    chunkLongInputs: true,
    chunkOverlapTokens: 128
  }),
  "MingZhong/DialogLED-large-5120": Object.freeze({
    maxInputTokens: 5120,
    minOutputTokens: 1,
    maxOutputTokens: 256,
    numBeams: 4,
    lengthPenalty: 1.0,
    doSample: false,
    chunkLongInputs: true,
    chunkOverlapTokens: 128
  }),
  "SUSTech-NLP/UniRRM-8B": Object.freeze({
    maxInputTokens: 32768,
    minOutputTokens: 1,
    maxOutputTokens: 4096,
    numBeams: 1,
    doSample: false,
    repetitionPenalty: 1.05,
    operation: "judge",
    vramRequiredMb: 20000
  })
});

export function huggingFaceModelDefaults(model) {
  return {
    ...(HUGGING_FACE_MODEL_DEFAULTS[model] ?? {
      maxInputTokens: 4096,
      minOutputTokens: 1,
      maxOutputTokens: 142,
      numBeams: 4,
      lengthPenalty: 1.0
    })
  };
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(1, Number(ms) || 1)));
}

function handleIdFor({ runId, model, sampleId, operation, requestId }) {
  const requestKey = requestId ? `${operation}\u0000${requestId}` : operation;
  const digest = crypto
    .createHash("sha256")
    .update(`${runId}\u0000${model}\u0000${sampleId}\u0000${requestKey}`)
    .digest("hex")
    .slice(0, 24);
  return `criterion-hf-${digest}`;
}

function payloadSentence({ model, sample }) {
  return {
    mood: "do",
    be: "gpu criterion",
    ob: { text: `${model}: ${String(sample?.id ?? "sample")}` },
    as: { name: "huggingface" }
  };
}

function parseHandleResult(status) {
  const raw = normalizeText(status?.result);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    throw new Error(`Hugging Face GPU result was not JSON: ${raw.slice(0, 300)}`);
  }
}

function handleFailure(status) {
  const error = normalizeText(status?.error) || normalizeText(status?.message) || "Hugging Face GPU job failed";
  return new Error(error);
}

async function waitForHandle({
  worldRoot,
  handleId,
  housekeeperUrl,
  gpuId,
  workerRunner,
  readStatus,
  timeoutMs,
  pollMs,
  workerTag
}) {
  const deadline = Date.now() + timeoutMs;
  const workerMaxPolls = Math.max(1200, Math.ceil(timeoutMs / 250) + 1);
  while (Date.now() <= deadline) {
    const status = await readStatus(worldRoot, handleId);
    if (status && isTerminalHandleStatus(status.status)) {
      if (status.status === "success") return parseHandleResult(status);
      throw handleFailure(status);
    }

    await workerRunner({
      worldRoot,
      housekeeperUrl,
      workerTag,
      owner: workerTag,
      gpuId,
      lane: "criterion",
      pollIntervalMs: 250,
      maxPolls: workerMaxPolls,
      leaseTtlMs: timeoutMs + 60000
    });
    await sleep(pollMs);
  }
  throw new Error(`Hugging Face GPU job timed out waiting for ${handleId}`);
}

export async function createHuggingFaceExecutor({
  root = process.cwd(),
  runId = "criterion",
  housekeeperUrl = process.env.PYA_GPU_HOUSEKEEPER_URL ?? "",
  gpuId = process.env.PYA_CRITERION_GPU_ID ?? process.env.PYA_GPU_ID ?? "gpu-0",
  revision = process.env.PYA_HUGGINGFACE_REVISION ?? null,
  dtype = process.env.PYA_HF_DTYPE ?? "auto",
  generation = {},
  operation = "generate",
  dischargeOnClose = false,
  dischargeProfileName = null,
  timeoutMs = Number(process.env.PYA_CRITERION_HF_TIMEOUT_MS || 1800000),
  pollMs = 50,
  enqueue = enqueueInputEnvelope,
  workerRunner = runGpuWorkerOnce,
  readStatus = readGpuHandleStatus,
  writeStatus = writeGpuHandleStatus,
  now = () => new Date()
} = {}) {
  const worldRoot = path.resolve(root, "world");
  const normalizedTimeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? Math.trunc(Number(timeoutMs)) : 1800000;
  const normalizedGpuId = normalizeText(gpuId) || "gpu-0";
  const normalizedHousekeeperUrl = normalizeText(housekeeperUrl);

  const metadataProvider = async ({ model }) => ({
    model,
    engine: "huggingface",
    operation,
    modelId: model,
    modelRevision: revision,
    tokenizerRevision: revision,
    ...huggingFaceModelDefaults(model)
  });

  const executor = async ({ model, prompt, messages, sample, identity, requestId }) => {
    if (!normalizedHousekeeperUrl) {
      throw new Error("Hugging Face GPU execution requires PYA_GPU_HOUSEKEEPER_URL");
    }
    const handleId = handleIdFor({
      runId,
      model,
      sampleId: sample?.id ?? prompt,
      operation,
      requestId: identity ?? requestId ?? ""
    });
    const queuedAt = now().toISOString();
    const { vramRequiredMb, ...generationDefaults } = { ...huggingFaceModelDefaults(model), ...generation };
    const payload = {
      model,
      revision,
      dtype,
      operation,
      prompt: String(prompt ?? ""),
      input: operation === "judge" ? String(prompt ?? "") : String(sample?.input ?? prompt ?? ""),
      ...(Array.isArray(messages) && messages.length ? { messages } : {}),
      generation: generationDefaults
    };
    const resourceRequest = Number(vramRequiredMb) > 0 ? { vramRequiredMb: Number(vramRequiredMb) } : null;

    await writeStatus(worldRoot, handleId, {
      status: "queued",
      agentName: "criterion-huggingface",
      gpuId: normalizedGpuId,
      intent: "criterion",
      lane: "criterion",
      queuedAt,
      startedAt: "",
      finishedAt: "",
      retryCount: 0,
      outcome: "queued",
      message: "queued",
      result: "",
      error: ""
    });
    await enqueue(worldRoot, {
      queuedAt,
      handleId,
      agentName: "criterion-huggingface",
      gpuId: normalizedGpuId,
      intent: "criterion",
      lane: "criterion",
      payloadSentence: payloadSentence({ model, sample }),
      serviceName: "huggingface",
      residencyName: model,
      residencyRequired: true,
      beginRequired: true,
      dischargeAllowed: true,
      jobSpec: {
        kind: "huggingface-generate",
        ...(resourceRequest ? { resourceRequest } : {}),
        payload
      }
    });

    const result = await waitForHandle({
      worldRoot,
      handleId,
      housekeeperUrl: normalizedHousekeeperUrl,
      gpuId: normalizedGpuId,
      workerRunner,
      readStatus,
      timeoutMs: normalizedTimeout,
      pollMs,
      workerTag: `criterion-hf-${process.pid}`
    });
    return {
      ...result,
      metadata: {
        ...(result.metadata ?? {}),
        modelMetadata: result.metadataRecord ?? result.metadata?.modelMetadata ?? null
      }
    };
  };

  const close = async () => {
    if (!dischargeOnClose || !normalizedHousekeeperUrl) return { success: false, skipped: true, reason: "discharge not requested" };
    const housekeeper = createGpuHousekeeperAdapter({ baseUrl: normalizedHousekeeperUrl });
    return housekeeper.discharge({ profileName: normalizeText(dischargeProfileName) || "" });
  };
  executor.close = close;
  executor.metadataProvider = metadataProvider;
  return { executor, metadataProvider, close };
}

export async function createHuggingFaceJudgeExecutor({
  model = "SUSTech-NLP/UniRRM-8B",
  ...options
} = {}) {
  const adapter = await createHuggingFaceExecutor({
    ...options,
    operation: "judge",
    dischargeOnClose: options.dischargeOnClose ?? true,
    dischargeProfileName: options.dischargeProfileName ?? model
  });
  const executor = async input => adapter.executor({ ...input, model });
  const metadataProvider = async input => ({
    ...(await adapter.metadataProvider({ ...input, model })),
    judgeModel: "judge:unirrm-8b",
    modelId: model,
    operation: "judge"
  });
  executor.close = adapter.close;
  return { ...adapter, executor, metadataProvider, model };
}
