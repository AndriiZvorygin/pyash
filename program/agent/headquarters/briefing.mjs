import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getExchangeRunRoot, recordArtifact } from "../../bridge/exchange.mjs";
import { mapSentenceToPyash } from "../../verbs/exchange/json_map.mjs";
import { splitSentences } from "../../library/sentenceSplitter.mjs";
import { parse } from "../../understand/index.mjs";
import { compareUtf8Bytes } from "../../library/knowledge_core.mjs";
import { listAgents, readAgentOrganization } from "../admin.mjs";
import { resolveAgentOrganizationPath } from "../organization.mjs";
import { listChannelQueueEnvelopes } from "../channel_core/queue.mjs";
import { worldNewspaperLogPath } from "../newspaper_log.mjs";
import { listWorkTasks } from "../../runtime/work/operator.mjs";
import { findWorkTaskEnvelope } from "../../runtime/work/queue.mjs";
import { workTaskStatusPath } from "../../runtime/work/status.mjs";

const DEFAULT_POLICY_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../module/headquarters-briefing.pya"
);
const TERMINAL_STATUS_FALLBACK = new Set(["accepted", "failed"]);
const URI_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u;

function text(value) {
  return String(value ?? "").trim();
}

function lexicalCompare(left, right) {
  return compareUtf8Bytes(left, right);
}

function sortedKeys(value) {
  return Object.keys(value).sort(lexicalCompare);
}

function normalizedValue(value) {
  if (Array.isArray(value)) return value.map(entry => normalizedValue(entry));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(sortedKeys(value).map(key => [key, normalizedValue(value[key])]));
}

function canonical(value) {
  return JSON.stringify(normalizedValue(value));
}

function hashBytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function digest(value) {
  return hashBytes(Buffer.from(canonical(value), "utf8"));
}

function defect(message) {
  throw new Error(`headquarters briefing policy defective: ${message}`);
}

function parseIso(value, label) {
  const raw = text(value);
  const date = new Date(raw);
  if (!raw || !Number.isFinite(date.getTime())) {
    throw new Error(`headquarters briefing defective: invalid ${label}`);
  }
  return date;
}

function iso(value, label) {
  return parseIso(value, label).toISOString();
}

function primitive(sentence) {
  if (sentence?.ob?.text !== undefined) return sentence.ob.text;
  if (sentence?.ob?.filename !== undefined) return sentence.ob.filename;
  if (sentence?.ob?.name !== undefined) return sentence.ob.name;
  if (sentence?.ob?.num !== undefined) return sentence.ob.num;
  if (sentence?.ob?.boolean !== undefined) return sentence.ob.boolean;
  if (sentence?.ob?.ve?.values !== undefined) return sentence.ob.ve.values;
  return undefined;
}

function mapPolicyFields(parsed, policyName) {
  const definitions = parsed.filter(sentence => sentence?.mood === "def" && sentence?.be === "map");
  const matching = definitions.filter(sentence => sentence?.su?.name === policyName);
  if (matching.length === 0) defect(`missing policy map ${policyName}`);
  if (matching.length > 1) defect(`duplicate policy map ${policyName}`);
  const start = parsed.indexOf(matching[0]);
  const fields = {};
  let closed = false;
  for (const sentence of parsed.slice(start + 1)) {
    if (sentence?.mood === "prah") {
      closed = true;
      break;
    }
    if (sentence?.mood !== "ya" || !sentence?.su?.name || !sentence?.ob) {
      defect("malformed policy entry");
    }
    const name = text(sentence.su.name);
    if (Object.hasOwn(fields, name)) defect(`duplicate policy entry ${name}`);
    const value = primitive(sentence);
    if (value === undefined) defect(`malformed policy entry ${name}`);
    fields[name] = value;
  }
  if (!closed) defect("policy map is not closed");
  return fields;
}

function requiredText(fields, key) {
  const value = text(fields[key]);
  if (!value) defect(`missing ${key}`);
  return value;
}

function requiredNumber(fields, key) {
  const value = Number(fields[key]);
  if (!Number.isFinite(value) || Math.trunc(value) !== value || value < 0) {
    defect(`invalid ${key}`);
  }
  return value;
}

function requiredVector(fields, key) {
  const values = fields[key];
  if (!Array.isArray(values) || values.length === 0 || values.some(value => !text(value))) {
    defect(`invalid ${key}`);
  }
  const normalized = values.map(value => text(value));
  if (new Set(normalized).size !== normalized.length) defect(`duplicate ${key}`);
  return normalized;
}

export async function readHeadquartersBriefingPolicy(policyPath = DEFAULT_POLICY_PATH) {
  const filename = path.resolve(String(policyPath));
  let source;
  try {
    source = await fs.readFile(filename, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") defect(`policy module unavailable: ${filename}`);
    throw error;
  }
  const parsed = [];
  for (const raw of splitSentences(source, { includeThen: true })) {
    try {
      parsed.push(parse(raw.trim()));
    } catch (error) {
      defect(`module is not parseable: ${filename}`);
    }
  }
  const fields = mapPolicyFields(parsed, "headquarters briefing policy");
  const expected = new Set([
    "identity",
    "maximum items",
    "imminent horizon hours",
    "category precedence",
    "terminal statuses excluded",
    "audience identity",
    "tie-break fields",
    "source evidence required",
    "integration states"
  ]);
  for (const name of Object.keys(fields)) {
    if (!expected.has(name)) defect(`unknown policy entry ${name}`);
  }
  for (const name of expected) {
    if (!Object.hasOwn(fields, name)) defect(`missing ${name}`);
  }
  const categoryPrecedence = requiredVector(fields, "category precedence");
  const canonicalCategories = [
    "pending approval/decision",
    "explicit escalation",
    "overdue deadline",
    "deadline within horizon",
    "explicit reconciliation/conflict",
    "blocked or queued response work"
  ];
  if (canonical(categoryPrecedence) !== canonical(canonicalCategories)) {
    defect("category precedence must declare the canonical categories exactly once");
  }
  const terminalStatuses = requiredVector(fields, "terminal statuses excluded");
  if (canonical(terminalStatuses) !== canonical(["accepted", "failed"])) {
    defect("terminal statuses must declare the canonical terminal statuses exactly once");
  }
  const evidenceRequired = requiredVector(fields, "source evidence required");
  if (canonical(evidenceRequired) !== canonical(["source identity", "source locator"])) {
    defect("source evidence requirement is not canonical");
  }
  const integrationStates = requiredVector(fields, "integration states");
  if (canonical(integrationStates) !== canonical(["reconciliation", "conflict"])) {
    defect("integration states are not canonical");
  }
  const policy = {
    identity: requiredText(fields, "identity"),
    maximumItems: requiredNumber(fields, "maximum items"),
    imminentHorizonHours: requiredNumber(fields, "imminent horizon hours"),
    categoryPrecedence,
    terminalStatuses,
    audienceIdentity: requiredText(fields, "audience identity"),
    tieBreakFields: requiredVector(fields, "tie-break fields"),
    sourceEvidenceRequired: evidenceRequired,
    integrationStates,
    sourcePath: filename
  };
  const canonicalTieBreakFields = [
    "category precedence",
    "normalized deadline (missing last)",
    "existing numeric work priority (descending)",
    "evidence timestamp (missing last)",
    "stable identity (locale-independent lexical)"
  ];
  if (canonical(policy.tieBreakFields) !== canonical(canonicalTieBreakFields)) {
    defect("tie-break fields are not canonical");
  }
  if (policy.maximumItems !== 5) defect("maximum items must be 5");
  if (policy.imminentHorizonHours !== 24) defect("imminent horizon must be 24 hours");
  if (!policy.terminalStatuses.every(status => TERMINAL_STATUS_FALLBACK.has(status))) {
    defect("terminal statuses are not canonical");
  }
  return {
    ...policy,
    hash: digest({ ...policy, sourcePath: undefined })
  };
}

function filePart(locator) {
  const value = text(locator);
  const index = value.indexOf("#");
  return index < 0 ? value : value.slice(0, index);
}

function isUri(locator) {
  return URI_PATTERN.test(text(locator));
}

async function snapshotFor({ kind, identity, locator } = {}) {
  const snapshot = {
    kind: text(kind),
    identity: text(identity),
    locator: text(locator),
    hash: ""
  };
  const filename = filePart(snapshot.locator);
  if (!filename || isUri(filename)) return snapshot;
  try {
    snapshot.hash = hashBytes(await fs.readFile(filename));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return snapshot;
}

function uniqueSnapshots(values) {
  const byKey = new Map();
  for (const value of values) {
    const entry = {
      kind: text(value.kind),
      identity: text(value.identity),
      locator: text(value.locator),
      hash: text(value.hash)
    };
    if (!entry.locator) continue;
    const key = `${entry.kind}\u0000${entry.locator}`;
    const prior = byKey.get(key);
    if (prior && prior.hash && entry.hash && prior.hash !== entry.hash) {
      throw new Error(`headquarters briefing defective: conflicting source hash at ${entry.locator}`);
    }
    byKey.set(key, prior?.hash ? prior : entry);
  }
  return [...byKey.values()].sort((left, right) => (
    lexicalCompare(`${left.kind}\u0000${left.locator}`, `${right.kind}\u0000${right.locator}`)
  ));
}

function valueFromRecordSentence(sentence) {
  const value = primitive(sentence);
  if (Array.isArray(value)) return JSON.stringify(value);
  return value;
}

function recordFieldName(sentence) {
  if (sentence?.su?.name) return text(sentence.su.name);
  for (const name of ["at", "during", "since", "until", "from", "to", "as", "with", "for", "by", "via"]) {
    if (Object.hasOwn(sentence ?? {}, name)) return name;
  }
  return "";
}

async function readNewspaperState(worldRoot, asOfDate) {
  const directory = path.join(worldRoot, "newspaper");
  let names;
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    if (error?.code === "ENOENT") return { records: [], snapshots: [] };
    throw error;
  }
  const files = names
    .filter(name => name.endsWith(".pya") && !name.includes("-headquarters-briefing-"))
    .sort(lexicalCompare);
  const records = [];
  const snapshots = [];
  for (const name of files) {
    const filename = path.join(directory, name);
    const source = await fs.readFile(filename, "utf8");
    snapshots.push(await snapshotFor({ kind: "newspaper", identity: name, locator: filename }));
    let current = null;
    for (const raw of splitSentences(source, { includeThen: true })) {
      let sentence;
      try {
        sentence = parse(raw.trim());
      } catch (error) {
        throw new Error(`headquarters briefing defective: newspaper is not parseable: ${filename}`);
      }
      if (sentence?.mood === "def" && sentence?.be === "map" && sentence?.su?.name) {
        current = {
          name: text(sentence.su.name),
          fields: {},
          locator: "",
          file: filename,
          fileName: name,
          index: records.length
        };
        continue;
      }
      if (sentence?.mood === "prah" && current) {
        current.locator = `${filename}#record-${String(current.index + 1).padStart(4, "0")}`;
        current.identity = current.locator;
        current.timestamp = [
          current.fields.at,
          current.fields.timestamp,
          current.fields["received time"],
          current.fields["requested at"],
          current.fields["decision timestamp"]
        ].map(text).find(value => Number.isFinite(Date.parse(value))) || "";
        records.push(current);
        current = null;
        continue;
      }
      if (!current) continue;
      if (sentence?.mood !== "ya" || !sentence?.ob) continue;
      const fieldName = recordFieldName(sentence);
      if (!fieldName) continue;
      const value = valueFromRecordSentence(sentence);
      if (value !== undefined) current.fields[fieldName] = value;
    }
    if (current) throw new Error(`headquarters briefing defective: newspaper map is not closed: ${filename}`);
  }
  const visibleRecords = records.filter(record => {
    const timestamp = Date.parse(record.timestamp);
    return !Number.isFinite(timestamp) || timestamp <= asOfDate.getTime();
  });
  return { records: visibleRecords, snapshots };
}

function matchNewspaper(record, {
  taskId,
  sourceIdentity,
  sourceLocator,
  messageId,
  eventId,
  requestId,
  checkpointIdentity
} = {}) {
  const fields = record.fields ?? {};
  const identifiers = [
    { expected: taskId, fields: ["task id"] },
    { expected: sourceIdentity, fields: ["source identity", "escalation source identity"] },
    { expected: sourceLocator, fields: ["source locator", "escalation source locator"] },
    { expected: messageId, fields: ["message id", "source message id"] },
    { expected: eventId, fields: ["event id", "source event id"] },
    { expected: requestId, fields: ["request id"] },
    { expected: checkpointIdentity, fields: ["checkpoint identity"] }
  ];
  const matches = identifiers
    .filter(identifier => text(identifier.expected))
    .some(identifier => identifier.fields.some(field => text(fields[field]) === text(identifier.expected)));
  if (!matches) return false;
  for (const identifier of identifiers) {
    const expected = text(identifier.expected);
    if (!expected) continue;
    for (const field of identifier.fields) {
      const actual = text(fields[field]);
      if (actual && actual !== expected) {
        throw new Error(`headquarters briefing defective: conflicting newspaper evidence for ${field}`);
      }
    }
  }
  return true;
}

function recordsForSubject(records, subject) {
  return records
    .filter(record => matchNewspaper(record, subject))
    .map(record => ({
      identity: record.identity,
      locator: record.locator,
      file: record.file,
      stage: text(record.fields.stage || record.fields.state || record.fields.action),
      timestamp: record.timestamp,
      fields: normalizedValue(record.fields),
      hash: ""
    }));
}

function eventFromEnvelope(envelope) {
  const payload = envelope?.payloadSentence?.ob?.text;
  if (!payload) return {};
  try {
    const event = JSON.parse(payload);
    return event && typeof event === "object" && !Array.isArray(event) ? event : {};
  } catch {
    return {};
  }
}

function sourceIdentityForEvent(event, envelope) {
  const provider = text(event.provider);
  const messageId = text(event.messageId);
  if (provider && messageId) return `${provider}:${messageId}`;
  const eventId = text(event.eventId || envelope?.eventId);
  if (eventId && text(envelope?.channelType)) return `${text(envelope.channelType)}:${eventId}`;
  return "";
}

function signal(name, evidence = {}) {
  return { name, evidence: normalizedValue(evidence) };
}

function validDeadline(value) {
  const raw = text(value);
  if (!raw || !Number.isFinite(Date.parse(raw))) return null;
  return new Date(raw);
}

function visibleAtAsOf(value, asOfDate) {
  const timestamp = Date.parse(text(value));
  return !Number.isFinite(timestamp) || timestamp <= asOfDate.getTime();
}

function taskSignals(task, policy, asOfDate, workEnvelopePhase = "") {
  const signals = [];
  const approval = task.checkpoint?.approval ?? {};
  if (text(approval.state).toLowerCase() === "pending"
    && visibleAtAsOf(approval.requestedAt, asOfDate)) {
    signals.push(signal("pending approval/decision", {
      requestId: approval.requestId,
      checkpointIdentity: approval.checkpointIdentity,
      action: approval.action
    }));
  }
  if (text(task.escalation?.state).toLowerCase() === "escalated"
    && visibleAtAsOf(task.escalation.timestamp, asOfDate)) {
    signals.push(signal("explicit escalation", {
      target: task.escalation.target,
      reason: task.escalation.reason,
      timestamp: task.escalation.timestamp
    }));
  }
  const deadline = validDeadline(task.deadline);
  if (deadline && deadline.getTime() < asOfDate.getTime()) {
    signals.push(signal("overdue deadline", { deadline: deadline.toISOString() }));
  } else if (deadline) {
    const horizon = asOfDate.getTime() + policy.imminentHorizonHours * 60 * 60 * 1000;
    if (deadline.getTime() >= asOfDate.getTime() && deadline.getTime() <= horizon) {
      signals.push(signal("deadline within horizon", { deadline: deadline.toISOString() }));
    }
  }
  const integrationStatus = text(task.checkpoint?.integration?.status).toLowerCase();
  if (policy.integrationStates.includes(integrationStatus)) {
    signals.push(signal("explicit reconciliation/conflict", { integrationStatus }));
  }
  if (text(task.status).toLowerCase() === "blocked"
    || text(task.status).toLowerCase() === "ready"
    || ["input", "runtime"].includes(workEnvelopePhase)) {
    signals.push(signal("blocked or queued response work", {
      status: task.status,
      workEnvelopePhase
    }));
  }
  return signals;
}

function channelCandidateSignals(envelope) {
  return [signal("blocked or queued response work", {
    phase: envelope.phase,
    queueState: envelope.phase === "runtime" ? "claimed" : "queued"
  })];
}

function initialCandidate({
  task = null,
  channel = null,
  organization = {},
  statusPath = "",
  envelopePath = "",
  workEnvelopePhase = "",
  newspaperRecords = [],
  snapshotByLocator
} = {}) {
  const event = channel ? eventFromEnvelope(channel.envelope) : {};
  const source = task?.source ?? {};
  const channelSourceIdentity = sourceIdentityForEvent(event, channel?.envelope);
  const sourceIdentity = text(source.identity) || channelSourceIdentity;
  const canonicalSourceLocator = text(source.locator) || text(event.sourceLocator);
  const sourceLocator = canonicalSourceLocator || text(channel?.path);
  const taskId = text(task?.taskId || event.taskId);
  const messageId = text(source.messageId) || text(event.messageId);
  const eventId = text(source.eventId) || text(event.eventId) || text(channel?.envelope?.eventId);
  const newspaperEvidence = recordsForSubject(newspaperRecords, {
    taskId,
    sourceIdentity,
    sourceLocator,
    messageId,
    eventId,
    requestId: text(task?.checkpoint?.approval?.requestId),
    checkpointIdentity: text(task?.checkpoint?.approval?.checkpointIdentity)
  });
  const taskEscalation = text(task?.escalation?.state).toLowerCase() === "escalated"
    ? normalizedValue(task.escalation)
    : null;
  const newspaperEscalations = newspaperEvidence.filter(record => record.stage.toLowerCase() === "escalated");
  const newspaperEscalation = newspaperEscalations[0]
    ? {
      state: "escalated",
      target: text(newspaperEscalations[0].fields["escalation target"]),
      reason: text(newspaperEscalations[0].fields["escalation reason"]),
      timestamp: newspaperEscalations[0].timestamp,
      sourceIdentity: text(newspaperEscalations[0].fields["source identity"])
    }
    : null;
  if (taskEscalation && newspaperEscalation) {
    for (const key of ["target", "reason", "sourceIdentity"]) {
      if (text(taskEscalation[key]) && text(newspaperEscalation[key])
        && text(taskEscalation[key]) !== text(newspaperEscalation[key])) {
        throw new Error(`headquarters briefing defective: conflicting escalation evidence for ${key}`);
      }
    }
  }
  const evidenceTimes = [
    source.receivedAt,
    task?.queuedAt,
    task?.checkpoint?.approval?.requestedAt,
    task?.escalation?.timestamp,
    channel?.envelope?.queuedAt,
    event.timestamp,
    event.receivedAt,
    ...newspaperEvidence.map(record => record.timestamp)
  ].map(value => text(value)).filter(value => Number.isFinite(Date.parse(value)));
  const evidenceTimestamp = evidenceTimes
    .map(value => new Date(value).toISOString())
    .filter(value => visibleAtAsOf(value, organization.asOfDate))
    .sort(lexicalCompare)
    .at(-1) || "";
  const statusLocators = [statusPath, envelopePath].filter(Boolean);
  const channelLocators = channel ? [channel.path] : [];
  const sourceEvidence = uniqueSnapshots([
    sourceLocator ? snapshotByLocator.get(sourceLocator) : null,
    ...statusLocators.map(locator => snapshotByLocator.get(locator)),
    ...channelLocators.map(locator => snapshotByLocator.get(locator)),
    ...newspaperEvidence.map(record => snapshotByLocator.get(record.file))
  ].filter(Boolean));
  const signals = task
    ? taskSignals(task, organization.policy, organization.asOfDate, workEnvelopePhase)
    : channelCandidateSignals(channel);
  if (newspaperEscalation && !signals.some(entry => entry.name === "explicit escalation")) {
    signals.push(signal("explicit escalation", newspaperEscalation));
  }
  return {
    itemType: task ? "work task" : "channel message",
    subjectIdentity: sourceIdentity,
    taskId,
    messageId,
    eventId,
    owner: text(task?.owner) || text(channel?.envelope?.agentName),
    organizationalRole: text(organization.role),
    organization: {
      role: text(organization.role),
      supervisor: text(organization.supervisor),
      responsibilities: [...(organization.responsibilities ?? [])],
      domains: [...(organization.domains ?? [])]
    },
    status: text(task?.status) || (channel?.phase === "runtime" ? "claimed" : "queued"),
    channelStatus: channel ? (channel.phase === "runtime" ? "claimed" : "queued") : "",
    domain: text(task?.domain) || text(event.domain),
    deadline: task?.deadline ? iso(task.deadline, "deadline") : (validDeadline(event.deadline)?.toISOString() || ""),
    priority: Number.isFinite(Number(task?.priority)) ? Number(task.priority) : 0,
    sourceIdentity,
    sourceLocator,
    source: normalizedValue(task?.source ?? {
      identity: sourceIdentity,
      kind: text(channel?.envelope?.channelType),
      locator: sourceLocator,
      provider: text(event.provider),
      eventId,
      messageId,
      sender: text(event.sender),
      subject: text(event.subject),
      receivedAt: text(event.receivedAt || event.timestamp)
    }),
    approval: task?.checkpoint?.approval && text(task.checkpoint.approval.state)
      ? normalizedValue(task.checkpoint.approval)
      : null,
    escalation: taskEscalation || newspaperEscalation,
    signals,
    reasons: signals.map(entry => entry.name),
    statusLocators,
    channelLocators,
    newspaperLocators: newspaperEvidence.map(record => record.locator),
    newspaperEvidence,
    evidence: sourceEvidence,
    evidenceTimestamp,
    hasTask: Boolean(task),
    title: text(task?.title) || text(event.subject),
    sourceLocatorIsQueue: Boolean(channel && !canonicalSourceLocator)
  };
}

function mergeList(left, right) {
  const out = [...left];
  for (const value of right) {
    if (!out.some(entry => canonical(entry) === canonical(value))) out.push(value);
  }
  return out;
}

function mergeCandidate(existing, incoming) {
  for (const key of ["taskId", "messageId", "sourceIdentity", "sourceLocator"]) {
    if (existing[key] && incoming[key] && existing[key] !== incoming[key]) {
      if (key === "sourceLocator" && (existing.sourceLocatorIsQueue || incoming.sourceLocatorIsQueue)) continue;
      throw new Error(`headquarters briefing defective: conflicting ${key} for ${existing.subjectIdentity}`);
    }
  }
  const preferred = incoming.hasTask && !existing.hasTask ? incoming : existing;
  const merged = {
    ...existing,
    ...preferred,
    taskId: existing.taskId || incoming.taskId,
    messageId: existing.messageId || incoming.messageId,
    eventId: existing.eventId || incoming.eventId,
    owner: existing.owner || incoming.owner,
    organizationalRole: existing.organizationalRole || incoming.organizationalRole,
    organization: existing.hasTask ? existing.organization : incoming.organization,
    status: existing.hasTask ? existing.status : incoming.status,
    channelStatus: existing.channelStatus || incoming.channelStatus,
    domain: existing.domain || incoming.domain,
    deadline: existing.deadline || incoming.deadline,
    priority: existing.hasTask ? existing.priority : incoming.priority,
    source: existing.hasTask ? existing.source : incoming.source,
    approval: existing.approval || incoming.approval,
    escalation: existing.escalation || incoming.escalation,
    signals: mergeList(existing.signals, incoming.signals),
    statusLocators: mergeList(existing.statusLocators, incoming.statusLocators),
    channelLocators: mergeList(existing.channelLocators, incoming.channelLocators),
    newspaperLocators: mergeList(existing.newspaperLocators, incoming.newspaperLocators),
    newspaperEvidence: mergeList(existing.newspaperEvidence, incoming.newspaperEvidence),
    evidence: mergeList(existing.evidence, incoming.evidence),
    evidenceTimestamp: [existing.evidenceTimestamp, incoming.evidenceTimestamp]
      .filter(Boolean)
      .sort(lexicalCompare)
      .at(-1) || "",
    hasTask: existing.hasTask || incoming.hasTask,
    title: existing.title || incoming.title,
    sourceLocatorIsQueue: existing.hasTask
      ? existing.sourceLocatorIsQueue
      : incoming.sourceLocatorIsQueue
  };
  merged.reasons = [...new Set(merged.signals.map(entry => entry.name))];
  return merged;
}

function finalizeCandidate(candidate, policy) {
  const categoryIndex = new Map(policy.categoryPrecedence.map((name, index) => [name, index]));
  candidate.signals = candidate.signals
    .filter(signalEntry => categoryIndex.has(signalEntry.name))
    .sort((left, right) => categoryIndex.get(left.name) - categoryIndex.get(right.name));
  candidate.reasons = candidate.signals.map(signalEntry => signalEntry.name);
  candidate.category = candidate.reasons[0] || "";
  candidate.rankTuple = [
    categoryIndex.get(candidate.category),
    candidate.deadline || null,
    candidate.priority,
    candidate.evidenceTimestamp || null,
    candidate.subjectIdentity
  ];
  const { sourceLocatorIsQueue, ...visibleCandidate } = candidate;
  return normalizedValue(visibleCandidate);
}

function compareRank(left, right, policy) {
  const category = policy.categoryPrecedence;
  const leftCategory = category.indexOf(left.category);
  const rightCategory = category.indexOf(right.category);
  if (leftCategory !== rightCategory) return leftCategory - rightCategory;
  const leftDeadline = validDeadline(left.deadline);
  const rightDeadline = validDeadline(right.deadline);
  if (leftDeadline && rightDeadline && leftDeadline.getTime() !== rightDeadline.getTime()) {
    return leftDeadline.getTime() - rightDeadline.getTime();
  }
  if (leftDeadline && !rightDeadline) return -1;
  if (!leftDeadline && rightDeadline) return 1;
  if (Number(left.priority) !== Number(right.priority)) return Number(right.priority) - Number(left.priority);
  const leftEvidence = validDeadline(left.evidenceTimestamp);
  const rightEvidence = validDeadline(right.evidenceTimestamp);
  if (leftEvidence && rightEvidence && leftEvidence.getTime() !== rightEvidence.getTime()) {
    return leftEvidence.getTime() - rightEvidence.getTime();
  }
  if (leftEvidence && !rightEvidence) return -1;
  if (!leftEvidence && rightEvidence) return 1;
  return lexicalCompare(left.subjectIdentity, right.subjectIdentity);
}

function itemWithHashes(item, snapshotByLocator) {
  return {
    ...item,
    evidence: item.evidence.map(entry => ({
      ...entry,
      hash: text(entry.hash || snapshotByLocator.get(entry.locator)?.hash)
    })),
    newspaperEvidence: item.newspaperEvidence.map(entry => ({
      ...entry,
      hash: text(entry.hash || snapshotByLocator.get(entry.file)?.hash)
    }))
  };
}

export async function projectHeadquartersBriefing(worldRoot, {
  asOf,
  policyPath = DEFAULT_POLICY_PATH
} = {}) {
  if (!worldRoot) throw new Error("headquarters briefing defective: world root is required");
  const asOfIso = iso(asOf, "asOf");
  const asOfDate = new Date(asOfIso);
  const policy = await readHeadquartersBriefingPolicy(policyPath);
  const [agentNames, tasks, channelEntries, newspaper] = await Promise.all([
    listAgents({ worldRoot }),
    listWorkTasks(worldRoot, { includeTerminal: true, readOnly: true }),
    listChannelQueueEnvelopes(worldRoot),
    readNewspaperState(worldRoot, asOfDate)
  ]);
  const organizations = new Map();
  const sourceSnapshots = [await snapshotFor({
    kind: "policy",
    identity: policy.identity,
    locator: policy.sourcePath
  }), ...newspaper.snapshots];
  for (const agentName of agentNames) {
    const organization = await readAgentOrganization({ worldRoot, agentName });
    const organizationPath = resolveAgentOrganizationPath({ worldRoot, agentName });
    organizations.set(agentName, organization);
    sourceSnapshots.push(await snapshotFor({
      kind: "agent organization",
      identity: agentName,
      locator: organizationPath
    }));
  }
  const statusPaths = new Map();
  const envelopePaths = new Map();
  const envelopePhases = new Map();
  for (const task of tasks) {
    const statusPath = await workTaskStatusPath(worldRoot, task.taskId, { readOnly: true });
    const envelope = await findWorkTaskEnvelope(worldRoot, task.taskId, {
      owner: task.owner,
      readOnly: true
    });
    statusPaths.set(task.taskId, statusPath);
    envelopePaths.set(task.taskId, envelope?.path || "");
    envelopePhases.set(task.taskId, envelope ? (envelope.runtime ? "runtime" : "input") : "");
    sourceSnapshots.push(await snapshotFor({ kind: "work status", identity: task.taskId, locator: statusPath }));
    if (envelope?.path) sourceSnapshots.push(await snapshotFor({ kind: "work envelope", identity: task.taskId, locator: envelope.path }));
    sourceSnapshots.push(await snapshotFor({
      kind: "work source",
      identity: task.source?.identity,
      locator: task.source?.locator
    }));
  }
  for (const entry of channelEntries) {
    sourceSnapshots.push(await snapshotFor({
      kind: "channel queue",
      identity: entry.envelope.eventId || entry.filename,
      locator: entry.path
    }));
  }
  const sourceSnapshot = uniqueSnapshots(sourceSnapshots);
  const snapshotByLocator = new Map(sourceSnapshot.map(entry => [entry.locator, entry]));
  const organizationFor = task => organizations.get(task.owner) ?? {
    role: "",
    supervisor: "",
    responsibilities: [],
    domains: []
  };
  const rawCandidates = [];
  for (const task of tasks) {
    if (!visibleAtAsOf(task.queuedAt, asOfDate)) continue;
    if (policy.terminalStatuses.includes(text(task.status).toLowerCase())) continue;
    if (!text(task.taskId) || !text(task.source?.identity) || !text(task.source?.locator)) continue;
    const candidate = initialCandidate({
      task,
      organization: { ...organizationFor(task), policy, asOfDate },
      statusPath: statusPaths.get(task.taskId),
      envelopePath: envelopePaths.get(task.taskId),
      workEnvelopePhase: envelopePhases.get(task.taskId),
      newspaperRecords: newspaper.records,
      snapshotByLocator
    });
    if (candidate.signals.length > 0) rawCandidates.push(candidate);
  }
  for (const entry of channelEntries) {
    if (!visibleAtAsOf(entry.envelope.queuedAt, asOfDate)) continue;
    const event = eventFromEnvelope(entry.envelope);
    const sourceIdentity = sourceIdentityForEvent(event, entry.envelope);
    const sourceLocator = text(event.sourceLocator) || entry.path;
    if (!sourceIdentity || !sourceLocator) continue;
    const organization = organizations.get(entry.envelope.agentName) ?? {
      role: "",
      supervisor: "",
      responsibilities: [],
      domains: []
    };
    rawCandidates.push(initialCandidate({
      channel: entry,
      organization: { ...organization, policy, asOfDate },
      newspaperRecords: newspaper.records,
      snapshotByLocator
    }));
  }
  const merged = [];
  for (const candidate of rawCandidates) {
    if (!candidate.subjectIdentity) continue;
    const matches = merged.filter(existing => (
      (candidate.taskId && existing.taskId === candidate.taskId)
      || (candidate.sourceIdentity && existing.sourceIdentity === candidate.sourceIdentity)
    ));
    if (matches.length > 1) {
      throw new Error(`headquarters briefing defective: ambiguous subject correlation for ${candidate.subjectIdentity}`);
    }
    if (matches.length === 1) {
      const index = merged.indexOf(matches[0]);
      merged[index] = mergeCandidate(matches[0], candidate);
    } else {
      merged.push(candidate);
    }
  }
  const items = merged
    .map(candidate => finalizeCandidate(itemWithHashes(candidate, snapshotByLocator), policy))
    .sort((left, right) => compareRank(left, right, policy));
  const limited = items.slice(0, policy.maximumItems);
  return {
    asOf: asOfIso,
    policy: {
      identity: policy.identity,
      hash: policy.hash,
      sourcePath: policy.sourcePath
    },
    metadata: {
      asOf: asOfIso,
      audienceIdentity: policy.audienceIdentity,
      maximumItems: policy.maximumItems,
      imminentHorizonHours: policy.imminentHorizonHours,
      policyIdentity: policy.identity,
      policyHash: policy.hash,
      candidateCount: items.length,
      returnedCount: limited.length,
      categoryPrecedence: [...policy.categoryPrecedence],
      tieBreakFields: [...policy.tieBreakFields]
    },
    candidateCount: items.length,
    sourceSnapshot,
    items: limited
  };
}

function nonEmptyText(value) {
  return { text: text(value) };
}

function itemMap(item) {
  return {
    "item type": nonEmptyText(item.itemType),
    "subject identity": nonEmptyText(item.subjectIdentity),
    "task id": nonEmptyText(item.taskId),
    "message id": nonEmptyText(item.messageId),
    category: nonEmptyText(item.category),
    reasons: { ve: { type: "text", values: item.reasons } },
    owner: nonEmptyText(item.owner),
    "organizational role": nonEmptyText(item.organizationalRole),
    status: nonEmptyText(item.status),
    domain: nonEmptyText(item.domain),
    deadline: nonEmptyText(item.deadline),
    priority: { num: Number(item.priority) || 0 },
    "source identity": nonEmptyText(item.sourceIdentity),
    "source locator": nonEmptyText(item.sourceLocator),
    approval: nonEmptyText(item.approval ? canonical(item.approval) : ""),
    escalation: nonEmptyText(item.escalation ? canonical(item.escalation) : ""),
    "status locators": { ve: { type: "text", values: item.statusLocators } },
    "channel locators": { ve: { type: "text", values: item.channelLocators } },
    "newspaper locators": { ve: { type: "text", values: item.newspaperLocators } },
    evidence: nonEmptyText(canonical(item.evidence)),
    "evidence timestamp": nonEmptyText(item.evidenceTimestamp)
  };
}

export function serializeHeadquartersBriefing(projection) {
  const itemNames = projection.items.map((item, index) => (
    `headquarters briefing item ${String(index + 1).padStart(3, "0")}`
  ));
  const root = {
    "as-of": nonEmptyText(projection.asOf),
    audience: nonEmptyText(projection.metadata.audienceIdentity),
    "candidate count": { num: projection.candidateCount },
    "category precedence": { ve: { type: "text", values: projection.metadata.categoryPrecedence } },
    items: { ve: { type: "name", values: itemNames } },
    "maximum items": { num: projection.metadata.maximumItems },
    "policy hash": nonEmptyText(projection.policy.hash),
    "policy identity": nonEmptyText(projection.policy.identity),
    "returned count": { num: projection.metadata.returnedCount },
    "source snapshot": nonEmptyText(canonical(projection.sourceSnapshot)),
    "tie-break fields": { ve: { type: "text", values: projection.metadata.tieBreakFields } }
  };
  const sentences = [
    mapSentenceToPyash({ mood: "def", su: { name: "headquarters briefing" }, be: "map", ob: { map: root } })
  ];
  projection.items.forEach((item, index) => {
    sentences.push(mapSentenceToPyash({
      mood: "def",
      su: { name: itemNames[index] },
      be: "map",
      ob: { map: itemMap(item) }
    }));
  });
  return `${sentences.join("\n")}\n`;
}

function portableLocator(filename, runRoot) {
  const relative = path.relative(runRoot, filePart(filename));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return "";
  return relative.replace(/[\\]+/g, "/");
}

function eventSentence(projection, recording) {
  return mapSentenceToPyash({
    mood: "def",
    su: { name: "headquarters briefing projection" },
    be: "map",
    ob: {
      map: {
        "as-of": nonEmptyText(projection.asOf),
        "artifact hash": nonEmptyText(recording.artifact.hash),
        "artifact locator": nonEmptyText(recording.artifact.locator),
        "input links": nonEmptyText(canonical(recording.inputs)),
        "item identities": { ve: { type: "text", values: projection.items.map(item => item.subjectIdentity) } },
        "policy hash": nonEmptyText(projection.policy.hash),
        "projection hash": nonEmptyText(recording.projectionHash)
      }
    }
  });
}

export async function recordHeadquartersBriefing(worldRoot, projection) {
  if (!projection?.asOf || !Array.isArray(projection.items)) {
    throw new Error("headquarters briefing defective: projection is required");
  }
  const serialized = serializeHeadquartersBriefing(projection);
  const projectionHash = hashBytes(Buffer.from(serialized, "utf8"));
  const artifactPath = path.join(
    worldRoot,
    "holding",
    "headquarters",
    "artifacts",
    `briefing-${projectionHash}.pya`
  );
  await fs.mkdir(path.dirname(artifactPath), { recursive: true });
  await fs.writeFile(artifactPath, serialized, "utf8");
  const runRoot = getExchangeRunRoot() ?? process.cwd();
  const inputs = [];
  for (const snapshot of projection.sourceSnapshot) {
    const filename = filePart(snapshot.locator);
    let bytes = null;
    try {
      if (filename && !isUri(filename)) bytes = await fs.readFile(filename);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const link = {
      kind: snapshot.kind,
      identity: snapshot.identity,
      locator: snapshot.locator,
      hash: snapshot.hash
    };
    const portable = portableLocator(snapshot.locator, runRoot);
    if (bytes && portable) {
      const artifact = recordArtifact({
        locator: portable,
        producer: "headquarters briefing",
        bytes,
        kind: "briefing input"
      });
      if (artifact?.fromtext?.text) link.hash = artifact.fromtext.text;
      if (artifact?.su?.name) link.artifact = artifact.su.name;
    }
    inputs.push(link);
  }
  const artifactLocator = portableLocator(artifactPath, runRoot) || artifactPath;
  const artifactSentence = recordArtifact({
    locator: artifactLocator,
    producer: "headquarters briefing",
    bytes: Buffer.from(serialized, "utf8"),
    kind: "derived headquarters briefing"
  });
  const artifact = {
    locator: artifactLocator,
    hash: artifactSentence?.fromtext?.text || projectionHash,
    name: artifactSentence?.su?.name || ""
  };
  const orderedInputs = inputs.sort((left, right) => (
    lexicalCompare(`${left.kind}\u0000${left.locator}`, `${right.kind}\u0000${right.locator}`)
  ));
  const newspaperPath = worldNewspaperLogPath({
    worldRoot,
    name: `headquarters-briefing-${projectionHash.slice(0, 16)}`,
    now: new Date(projection.asOf)
  });
  const recording = {
    artifact,
    inputs: orderedInputs,
    newspaper: { locator: newspaperPath, hash: "" },
    projectionHash
  };
  const eventText = `${eventSentence(projection, recording)}\n`;
  await fs.mkdir(path.dirname(newspaperPath), { recursive: true });
  await fs.writeFile(newspaperPath, eventText, "utf8");
  recording.newspaper.hash = hashBytes(Buffer.from(eventText, "utf8"));
  return recording;
}

// Naming-compatible alias; it resolves to the same complete projector.
export const projectHeadquartersBriefingInput = projectHeadquartersBriefing;
