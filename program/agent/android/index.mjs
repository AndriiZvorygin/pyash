import {
  enqueueProduceEnvelope,
  claimOldestInputEnvelope,
  claimOldestProduceEnvelope,
  ackRuntimeEnvelopeSuccess,
  ackRuntimeEnvelopeFail,
  queueDepth
} from "../android_core/queue.mjs";
import { createAdbAdapter } from "./adapter_adb.mjs";
import { writeAndroidHandleState } from "./state.mjs";
import {
  acquireAndroidDeviceLease,
  heartbeatAndroidDeviceLease,
  releaseAndroidDeviceLease
} from "./lease.mjs";

function shortText(value, max = 220) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

export function resolveAndroidIntent(payloadSentence = {}) {
  const rawBe = String(payloadSentence?.be ?? "").trim().toLowerCase();
  if (!rawBe) return "";
  if (rawBe.startsWith("android ")) return rawBe.slice("android ".length).trim();
  return rawBe;
}

function outcomeSentence({ envelope, success, intent, summary } = {}) {
  const handle = String(
    envelope?.commandId
    || envelope?.payloadId
    || envelope?.eventId
    || `android-${Date.now()}`
  ).trim();
  return {
    mood: "ya",
    su: { name: handle },
    be: "android outcome",
    as: { name: intent || "unknown" },
    vyah: { name: success ? "success" : "fail" },
    ob: { text: shortText(summary || (success ? "ok" : "fail"), 280) }
  };
}

function retryCountFromEnvelope(envelope = {}) {
  return Math.max(0, Math.trunc(Number(envelope?.retryCount) || 0));
}

export async function runAndroidPollOnce({ worldRoot } = {}) {
  const depth = await queueDepth(worldRoot);
  return {
    received: 0,
    handled: 0,
    sent: 0,
    queueDepth: depth.total,
    lastInputAt: ""
  };
}

export async function runAndroidInputOnce({
  worldRoot,
  adapter,
  maxItems = 10,
  maxRetries = 2,
  leaseTtlMs = 30000
} = {}) {
  const runtimeAdapter = adapter || createAdbAdapter({ worldRoot });
  const max = Math.max(1, Math.trunc(Number(maxItems) || 10));
  const retryMax = Math.max(0, Math.trunc(Number(maxRetries) || 2));

  let received = 0;
  let handled = 0;
  let enqueued = 0;
  let lastInputAt = "";

  for (let index = 0; index < max; index += 1) {
    const claimed = await claimOldestInputEnvelope(worldRoot, { workerTag: "android-input" });
    if (!claimed) break;
    const envelope = claimed?.envelope ?? {};
    received += 1;
    const intent = resolveAndroidIntent(envelope.payloadSentence);
    const commandId = String(envelope.commandId || envelope.payloadId || "").trim();
    const leaseOwner = "android-input";
    const lease = await acquireAndroidDeviceLease(worldRoot, {
      deviceId: envelope.deviceId,
      owner: leaseOwner,
      commandId,
      ttlMs: leaseTtlMs
    });
    if (!lease?.acquired) {
      await ackRuntimeEnvelopeFail(worldRoot, {
        runtimePath: claimed.path,
        retryCount: retryCountFromEnvelope(envelope),
        maxRetries: retryMax,
        requeuePhase: "input"
      });
      continue;
    }
    try {
      if (commandId) {
        await writeAndroidHandleState(worldRoot, commandId, {
          status: "running",
          startedAt: new Date().toISOString(),
          summary: "running"
        });
      }
      await heartbeatAndroidDeviceLease(worldRoot, {
        deviceId: envelope.deviceId,
        owner: leaseOwner,
        commandId
      });
      const result = await runtimeAdapter.execute({
        worldRoot,
        envelope,
        intent,
        deviceId: envelope.deviceId,
        agentName: envelope.agentName,
        payloadSentence: envelope.payloadSentence
      });
      const success = result?.success !== false;
      const summary = result?.summary || (success ? "android ok" : "android fail");
      if (commandId) {
        await writeAndroidHandleState(worldRoot, commandId, {
          status: success ? "success" : "fail",
          finishedAt: new Date().toISOString(),
          summary
        });
      }
      await enqueueProduceEnvelope(worldRoot, {
        queuedAt: new Date().toISOString(),
        deviceId: envelope.deviceId,
        identity: envelope.identity,
        agentName: envelope.agentName,
        payloadId: envelope.payloadId || envelope.commandId || "",
        commandId: envelope.commandId || envelope.payloadId || "",
        payloadSentence: outcomeSentence({ envelope, success, intent, summary })
      });
      await ackRuntimeEnvelopeSuccess(worldRoot, { runtimePath: claimed.path });
      handled += 1;
      enqueued += 1;
      lastInputAt = new Date().toISOString();
    } catch (err) {
      if (commandId) {
        await writeAndroidHandleState(worldRoot, commandId, {
          status: "fail",
          finishedAt: new Date().toISOString(),
          summary: shortText(String(err?.message ?? err), 220) || "runtime fail"
        });
      }
      await ackRuntimeEnvelopeFail(worldRoot, {
        runtimePath: claimed.path,
        retryCount: retryCountFromEnvelope(envelope),
        maxRetries: retryMax,
        requeuePhase: "input"
      });
    } finally {
      await releaseAndroidDeviceLease(worldRoot, {
        deviceId: envelope.deviceId,
        owner: leaseOwner,
        commandId
      });
    }
  }

  const depth = await queueDepth(worldRoot);
  return {
    received,
    handled,
    sent: 0,
    enqueued,
    queueDepth: depth.total,
    lastInputAt
  };
}

export async function runAndroidProduceOnce({
  worldRoot,
  maxItems = 10,
  maxRetries = 1
} = {}) {
  const max = Math.max(1, Math.trunc(Number(maxItems) || 10));
  const retryMax = Math.max(0, Math.trunc(Number(maxRetries) || 1));

  let sent = 0;
  for (let index = 0; index < max; index += 1) {
    const claimed = await claimOldestProduceEnvelope(worldRoot, { workerTag: "android-produce" });
    if (!claimed) break;
    const envelope = claimed?.envelope ?? {};
    try {
      await ackRuntimeEnvelopeSuccess(worldRoot, { runtimePath: claimed.path });
      sent += 1;
    } catch {
      await ackRuntimeEnvelopeFail(worldRoot, {
        runtimePath: claimed.path,
        retryCount: retryCountFromEnvelope(envelope),
        maxRetries: retryMax,
        requeuePhase: "produce"
      });
    }
  }

  const depth = await queueDepth(worldRoot);
  return {
    received: 0,
    handled: 0,
    sent,
    queueDepth: depth.total,
    lastInputAt: ""
  };
}

export async function runAndroidOnce({
  worldRoot,
  adapter,
  inputMaxItems = 10,
  produceMaxItems = 10
} = {}) {
  const poll = await runAndroidPollOnce({ worldRoot });
  const input = await runAndroidInputOnce({
    worldRoot,
    adapter,
    maxItems: inputMaxItems
  });
  const produce = await runAndroidProduceOnce({
    worldRoot,
    maxItems: produceMaxItems
  });
  const depth = await queueDepth(worldRoot);
  return {
    received: Number(poll.received || 0) + Number(input.received || 0),
    handled: Number(input.handled || 0),
    sent: Number(produce.sent || 0),
    queueDepth: depth.total,
    lastInputAt: input.lastInputAt || ""
  };
}
