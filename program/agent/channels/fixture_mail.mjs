import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import { parse } from "../../understand/index.mjs";
import { interpret as interpretPyash } from "../../bridge/index.mjs";
import { doRemember, remember } from "../../remember/index.mjs";
import { worldNewspaperLogPath } from "../newspaper_log.mjs";
import { recordArtifact } from "../../bridge/exchange.mjs";
import { projectHeadquartersBriefingInput } from "../headquarters/briefing.mjs";
import {
  addWorkTask,
  ensureWorkTaskDelegationEvent
} from "../../runtime/work/operator.mjs";
import { findWorkTaskEnvelope } from "../../runtime/work/queue.mjs";
import { appendWorkOutcome } from "../../runtime/work/outcome.mjs";
import { readWorkTaskStatus, workTaskStatusDir } from "../../runtime/work/status.mjs";
import { normalizeWorkTaskId } from "../../runtime/work/contract.mjs";

const FIXTURE_CHANNEL_TYPE = "fixture-mail";
const DEFAULT_OWNER = "correspondence worker";
const CHIEF_OF_STAFF = "chief of staff";
const CLASSIFICATIONS = new Set(["information", "work", "draft-response", "escalation"]);

function text(value) {
  return String(value ?? "").trim();
}
function boolean(value) {
  return value === true || /^(truth|true|yes|1)$/iu.test(text(value));
}

function mapValue(sentence) {
  if (sentence?.ob?.text !== undefined) return sentence.ob.text;
  if (sentence?.ob?.filename !== undefined) return sentence.ob.filename;
  if (sentence?.ob?.name !== undefined) return sentence.ob.name;
  if (sentence?.ob?.num !== undefined) return sentence.ob.num;
  if (sentence?.ob?.boolean !== undefined) return sentence.ob.boolean;
  return undefined;
}

async function readPyaFields(filename) {
  const source = await fs.readFile(filename, "utf8");
  const fields = {};
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (!line || line === "prah" || / be (?:map|series) def$/iu.test(line)) continue;
    let sentence;
    try {
      sentence = parse(line);
    } catch {
      continue;
    }
    const name = text(sentence?.su?.name);
    const value = mapValue(sentence);
    if (name && value !== undefined) fields[name] = value;
  }
  return fields;
}

function requireField(fields, key, label = key) {
  const value = text(fields[key]);
  if (!value) throw new Error(`fixture mail defective: missing ${label}`);
  return value;
}

export async function readFixtureMailRecord({ fixturePath, inboxIdentity } = {}) {
  const filename = path.resolve(String(fixturePath ?? ""));
  const fields = await readPyaFields(filename);
  const record = {
    provider: requireField(fields, "provider"),
    eventId: requireField(fields, "event id"),
    messageId: requireField(fields, "message id"),
    sender: requireField(fields, "sender"),
    subject: requireField(fields, "subject"),
    body: requireField(fields, "body"),
    receivedAt: requireField(fields, "received time"),
    domain: requireField(fields, "domain"),
    deadline: text(fields.deadline),
    decisionRequired: boolean(fields["decision required"]),
    draftResponseRequested: boolean(fields["draft response requested"]),
    mutationRequested: boolean(fields["mutation requested"]),
    sourceLocator: `${filename}#${requireField(fields, "message id")}`,
    channelId: requireField({ inbox: inboxIdentity }, "inbox", "inbox identity")
  };
  if (!Number.isFinite(Date.parse(record.receivedAt))) {
    throw new Error("fixture mail defective: invalid received time");
  }
  if (record.deadline && !Number.isFinite(Date.parse(record.deadline))) {
    throw new Error("fixture mail defective: invalid deadline");
  }
  return record;
}

export async function readFixtureMailPlan(policyPath) {
  const fields = await readPyaFields(path.resolve(String(policyPath ?? "")));
  const numberField = (key, fallback) => {
    const value = Number(fields[key]);
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    owner: text(fields.owner) || DEFAULT_OWNER,
    delegatedBy: text(fields["delegated by"]) || CHIEF_OF_STAFF,
    escalationTarget: text(fields["escalation target"]) || CHIEF_OF_STAFF,
    escalationReason: text(fields["escalation reason"]) || "decision requirement plus deadline",
    escalationClassification: text(fields["escalation classification"]) || "escalation",
    kind: text(fields["work kind"]) || "correspondence",
    acceptanceText: text(fields.acceptance) || "Preserve source evidence; propose no external send or mutation.",
    promptPrefix: text(fields["prompt prefix"]) || "Review",
    defaultPriority: numberField("default priority", 50),
    escalationPriority: numberField("escalation priority", 10),
    externalAction: text(fields["external action"]) || "none",
    stageOrder: text(fields["stage order"]) || "received routed classified work-created escalated briefing-visible channel-completed"
  };
}

export function fixtureMailFacts(record) {
  return [
    boolean(record.decisionRequired),
    Boolean(text(record.deadline)),
    boolean(record.draftResponseRequested),
    boolean(record.mutationRequested)
  ].map(value => (value ? "truth" : "lie")).join(" ");
}

export async function classifyFixtureMailWithPyash(record, policyPath) {
  const source = path.resolve(String(policyPath ?? ""));
  const importSentence = parse(
    `ob name headquarters fixture mail classify from filename ${JSON.stringify(source)} `
      + "to name headquarters fixture mail classify be import do"
  );
  await interpretPyash(importSentence);
  const inputName = "headquarters fixture mail classification input";
  const outputName = "headquarters fixture mail classification output";
  doRemember({
    mood: "ya",
    su: { name: inputName },
    be: "map",
    ob: {
      map: {
        "classification facts": { text: fixtureMailFacts(record) }
      }
    }
  });
  const call = parse(
    `from name map ${inputName} to name text ${outputName} `
      + "be headquarters fixture mail classify do"
  );
  const result = await interpretPyash(call);
  const remembered = remember(outputName);
  const classification = text(
    result?.result?.text
      ?? result?.ob?.text
      ?? remembered?.ob?.text
  );
  if (classification === "rejected") {
    throw new Error("fixture mail classification defective: conflicting structured facts");
  }
  if (!CLASSIFICATIONS.has(classification)) {
    throw new Error(`fixture mail classification defective: no Pyash policy for ${fixtureMailFacts(record)}`);
  }
  return classification;
}

export function fixtureMailSourceIdentity(record) {
  return `${text(record.provider)}:${text(record.messageId)}`;
}

export function fixtureMailTaskId(record) {
  const taskId = normalizeWorkTaskId(`${text(record.provider)}-${text(record.messageId)}`);
  if (!taskId) throw new Error("fixture mail defective: stable task identity missing");
  return taskId;
}

function recordFromEvent(event, fallbackLocator = "") {
  return {
    provider: text(event?.provider),
    eventId: text(event?.eventId),
    messageId: text(event?.messageId),
    sender: text(event?.sender),
    subject: text(event?.subject),
    body: text(event?.text),
    receivedAt: text(event?.receivedAt || event?.timestamp),
    domain: text(event?.domain),
    deadline: text(event?.deadline),
    decisionRequired: event?.decisionRequired === true,
    draftResponseRequested: event?.draftResponseRequested === true,
    mutationRequested: event?.mutationRequested === true,
    sourceLocator: text(event?.sourceLocator || fallbackLocator),
    channelId: text(event?.channelId)
  };
}

function evidenceFields({ stage, record, task, classification, routerPayloadId, at }) {
  return [
    { key: "stage", value: stage },
    { key: "at", value: at },
    { key: "provider", value: record.provider },
    { key: "source identity", value: fixtureMailSourceIdentity(record) },
    { key: "event id", value: record.eventId },
    { key: "message id", value: record.messageId },
    { key: "sender", value: record.sender },
    { key: "subject", value: record.subject },
    { key: "received time", value: record.receivedAt },
    { key: "domain", value: record.domain },
    { key: "deadline", value: record.deadline },
    { key: "router payload id", value: routerPayloadId },
    { key: "task id", value: task?.taskId || fixtureMailTaskId(record) },
    { key: "classification", value: classification },
    { key: "owner", value: task?.owner },
    { key: "escalation reason", value: task?.escalation?.reason },
    { key: "escalation target", value: task?.escalation?.target },
    { key: "source locator", value: task?.source?.locator || record.sourceLocator }
  ];
}

function stageCursor(plan, initialStage = "received") {
  const stages = plan.stageOrder.split(/\s+/u).filter(Boolean);
  let cursor = stages.indexOf(initialStage);
  if (cursor < 0) throw new Error(`fixture mail policy defective: missing ${initialStage} stage`);
  return stage => {
    const normalized = stage === "work-reused" ? "work-created" : stage;
    const next = stages.indexOf(normalized);
    if (next < 0 || next <= cursor) {
      throw new Error(`fixture mail policy defective: stage order cannot advance to ${stage}`);
    }
    cursor = next;
  };
}

export async function appendFixtureMailEvidence(worldRoot, input = {}) {
  const record = input.record ?? {};
  const at = text(input.at) || new Date().toISOString();
  const fields = evidenceFields({ ...input, record, at });
  const lines = [
    "su name headquarters fixture mail evidence be map def",
    ...fields.map(field => `  su name ${field.key} ob text ${JSON.stringify(text(field.value))} ya`),
    "prah",
    ""
  ].join("\n");
  const filename = worldNewspaperLogPath({
    worldRoot,
    name: "headquarters-fixture-mail",
    now: new Date(at)
  });
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.appendFile(filename, lines, "utf8");
  return filename;
}

function eventToRecord(event, sourceLocator = "") {
  return recordFromEvent(event, sourceLocator);
}

export async function runFixtureMailWorkflow({
  channelProcessingContext,
  worldRoot,
  fixturePath,
  policyPath,
  owner = DEFAULT_OWNER
} = {}) {
  const event = channelProcessingContext?.event;
  if (!event) throw new Error("fixture mail workflow defective: channel event missing");
  const record = eventToRecord(event, `${path.resolve(String(fixturePath ?? ""))}#${text(event.messageId)}`);
  const plan = await readFixtureMailPlan(policyPath);
  const classification = await classifyFixtureMailWithPyash(record, policyPath);
  const isEscalation = classification === plan.escalationClassification;
  const advanceStage = stageCursor(plan);
  const sourceIdentity = fixtureMailSourceIdentity(record);
  const routerPayloadId = text(channelProcessingContext?.routerPayloadId || event.routerPayloadId);
  advanceStage("routed");
  await appendFixtureMailEvidence(worldRoot, {
    stage: "routed",
    record,
    routerPayloadId,
    at: record.receivedAt
  });
  advanceStage("classified");
  await appendFixtureMailEvidence(worldRoot, {
    stage: "classified",
    record,
    classification,
    routerPayloadId,
    at: record.receivedAt
  });

  if (isEscalation && !(record.decisionRequired && record.deadline)) {
    throw new Error("fixture mail escalation defective: decision and deadline facts required");
  }
  const taskId = fixtureMailTaskId(record);
  let task = await readWorkTaskStatus(worldRoot, taskId);
  const reused = Boolean(task);
  let workEnvelopePath = "";
  if (!task) {
    const queuedWork = await addWorkTask(worldRoot, {
      taskId,
      owner,
      kind: plan.kind,
      title: record.subject,
      priority: isEscalation ? plan.escalationPriority : plan.defaultPriority,
      queuedAt: record.receivedAt,
      acceptanceText: plan.acceptanceText,
      promptText: `${plan.promptPrefix} ${classification} correspondence from ${record.sender}.`,
      contextText: record.body,
      source: {
        identity: sourceIdentity,
        kind: FIXTURE_CHANNEL_TYPE,
        locator: record.sourceLocator,
        provider: record.provider,
        eventId: record.eventId,
        messageId: record.messageId,
        sender: record.sender,
        subject: record.subject,
        receivedAt: record.receivedAt,
        routerPayloadId
      },
      domain: record.domain,
      deadline: record.deadline,
      delegatedBy: plan.delegatedBy,
      workSpec: {
        classification,
        externalAction: plan.externalAction,
        stageOrder: plan.stageOrder
      }
    });
    workEnvelopePath = text(queuedWork?.path);
    task = await readWorkTaskStatus(worldRoot, taskId);
  } else {
    workEnvelopePath = text((await findWorkTaskEnvelope(worldRoot, taskId))?.path);
  }
  await ensureWorkTaskDelegationEvent(worldRoot, taskId, {
    type: "assigned",
    actor: plan.delegatedBy,
    recipient: owner,
    note: "Correspondence Worker owns fixture-mail organizational work.",
    sourceIdentity
  }, { now: record.receivedAt });
  const afterAssignment = await readWorkTaskStatus(worldRoot, taskId);
  const hadEscalation = afterAssignment.delegationEvents.some(eventEntry => eventEntry.type === "escalated");
  if (isEscalation) {
    await ensureWorkTaskDelegationEvent(worldRoot, taskId, {
      type: "escalated",
      actor: owner,
      recipient: plan.escalationTarget,
      note: "Decision requirement and deadline require Chief of Staff review.",
      sourceIdentity
    }, {
      now: record.receivedAt,
      escalation: {
        state: "escalated",
        target: plan.escalationTarget,
        reason: plan.escalationReason,
        timestamp: record.receivedAt,
        sourceIdentity
      }
    });
  }
  task = await readWorkTaskStatus(worldRoot, taskId);
  if (!task) throw new Error(`fixture mail work missing after upsert: ${taskId}`);
  await appendWorkOutcome(worldRoot, task, {
    action: reused ? "work-reused" : "work-created",
    reason: `Fixture mail ${classification} work is durable and idempotent for ${sourceIdentity}.`
  });
  advanceStage(reused ? "work-reused" : "work-created");
  await appendFixtureMailEvidence(worldRoot, {
    stage: reused ? "work-reused" : "work-created",
    record,
    task,
    classification,
    routerPayloadId,
    at: record.receivedAt
  });
  if (isEscalation && !hadEscalation) {
    advanceStage("escalated");
    await appendFixtureMailEvidence(worldRoot, {
      stage: "escalated",
      record,
      task,
      classification,
      routerPayloadId,
      at: record.receivedAt
    });
  }
  const briefing = await projectHeadquartersBriefingInput(worldRoot);
  const briefingCandidate = briefing.find(candidate => candidate.taskId === taskId);
  if (!briefingCandidate) throw new Error(`fixture mail briefing missing task: ${taskId}`);
  advanceStage("briefing-visible");
  await appendFixtureMailEvidence(worldRoot, {
    stage: "briefing-visible",
    record,
    task,
    classification,
    routerPayloadId,
    at: record.receivedAt
  });
  return {
    taskId,
    classification,
    sourceIdentity,
    routerPayloadId,
    reused,
    task,
    briefing: briefingCandidate,
    workEnvelopePath,
    taskStatusPath: path.join(await workTaskStatusDir(worldRoot), `${taskId}.pya`),
    artifactPaths: [
      worldNewspaperLogPath({ worldRoot, name: "headquarters-fixture-mail", now: new Date(record.receivedAt) }),
      worldNewspaperLogPath({ worldRoot, name: "channel-fixture-mail-correspondence-worker" }),
      worldNewspaperLogPath({ worldRoot, name: `work-${taskId}` }),
      path.join(await workTaskStatusDir(worldRoot), `${taskId}.pya`),
      workEnvelopePath
    ].filter(Boolean)
  };
}

export async function recordFixtureMailArtifactLinks({ worldRoot, taskId, at, artifactPaths = [] } = {}) {
  const links = [];
  for (const filename of [...new Set(artifactPaths.filter(Boolean))]) {
    let bytes;
    try {
      bytes = await fs.readFile(filename);
    } catch {
      continue;
    }
    const locator = path.relative(process.cwd(), filename).replace(/[\\]+/g, "/");
    const hash = crypto.createHash("sha256").update(bytes).digest("hex");
    const artifact = recordArtifact({
      locator,
      producer: "headquarters",
      bytes,
      kind: "fixture mail evidence"
    });
    links.push({
      locator,
      hash: artifact?.fromtext?.text || hash
    });
  }
  return links;
}

export function createFixtureMailAdapter({ fixturePath, policyPath, inboxIdentity, worldRoot } = {}) {
  return {
    suppressResponse: true,
    async receive() {
      const record = await readFixtureMailRecord({ fixturePath, inboxIdentity });
      await appendFixtureMailEvidence(worldRoot, {
        stage: "received",
        record,
        at: record.receivedAt
      });
      return {
        events: [{
          channelType: FIXTURE_CHANNEL_TYPE,
          channelId: record.channelId,
          eventId: record.eventId,
          sender: record.sender,
          text: record.body,
          timestamp: record.receivedAt,
          provider: record.provider,
          messageId: record.messageId,
          subject: record.subject,
          receivedAt: record.receivedAt,
          domain: record.domain,
          deadline: record.deadline,
          decisionRequired: record.decisionRequired,
          draftResponseRequested: record.draftResponseRequested,
          mutationRequested: record.mutationRequested,
          sourceLocator: record.sourceLocator
        }],
        checkpoint: { nextBatch: `${record.provider}:${record.messageId}` }
      };
    },
    async markSeen() {},
    async recordCompleted({ event, worldRoot: completedWorldRoot }) {
      const record = eventToRecord(event);
      const task = await readWorkTaskStatus(completedWorldRoot, fixtureMailTaskId(record));
      await appendFixtureMailEvidence(completedWorldRoot, {
        stage: "channel-completed",
        record,
        task,
        routerPayloadId: event.routerPayloadId || task?.source?.routerPayloadId,
        at: record.receivedAt
      });
    },
    async send() {
      throw new Error("fixture mail adapter does not send external messages");
    },
    policyPath
  };
}
