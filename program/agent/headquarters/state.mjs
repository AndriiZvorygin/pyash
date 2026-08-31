import fs from "node:fs/promises";
import path from "node:path";

import {
  canonicalJson,
  compareUtf8Bytes,
  isEvidenceSentence,
  normalizeLinkedClaimBundle
} from "../../library/knowledge_core.mjs";
import { splitSentences } from "../../library/sentenceSplitter.mjs";
import { parse } from "../../understand/index.mjs";
import { listChannelEnvelopes } from "../channel_core/queue.mjs";
import {
  HEADQUARTERS_ACTIVITY_POLICY,
  projectHeadquartersLayout
} from "./layout.mjs";
import { projectHeadquartersKnowledge } from "./knowledge.mjs";
import { listWorkTasks } from "../../runtime/work/operator.mjs";

const DEFAULT_NEWSPAPER_LIMIT = 50;
const DEFAULT_ACTIVITY_LIMIT = 20;
const DEFAULT_COLLECTION_LIMIT = 100;
const SKIPPED_ACTIVITY_ROOTS = new Set(["archived", "holding", "newspaper"]);
const KNOWN_KINDS = new Set(["bet", "company", "contacting", "duty", "person", "relations"]);

function text(value) {
  return String(value ?? "").trim();
}

function defect(message) {
  throw new Error(`headquarters state defective: ${message}`);
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) freeze(entry);
  return Object.freeze(value);
}

function boundedLimit(value, label, fallback) {
  if (value === undefined) return fallback;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 0) defect(`${label} must be a non-negative integer`);
  return limit;
}

function asOfIso(value) {
  const raw = value instanceof Date
    ? (Number.isFinite(value.getTime()) ? value.toISOString() : "")
    : text(value);
  const timestamp = Date.parse(raw);
  if (!raw || !Number.isFinite(timestamp)) defect("asOf must be a valid timestamp");
  return new Date(timestamp).toISOString();
}

function asOfMilliseconds(asOf) {
  const timestamp = Date.parse(asOf);
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

function scalarText(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  return text(value.text ?? value.name ?? value.wo ?? value.filename);
}

function sentenceDateValue(value) {
  if (!value || typeof value !== "object") return "";
  return scalarText(value.date ?? value.text ?? value.name ?? value.wo);
}

function sentenceTimestamp(sentence) {
  for (const key of ["at", "during", "since", "until"]) {
    const value = sentenceDateValue(sentence?.[key]);
    if (value && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  }
  const subject = text(sentence?.su?.name).toLowerCase();
  if (subject === "timestamp" || subject === "queued at" || subject.endsWith(" timestamp")) {
    const value = scalarText(sentence?.ob);
    if (value && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  }
  return "";
}

function filenameDate(filename) {
  const match = text(filename).match(/(?:^|[\\/])(\d{4})(\d{2})(\d{2})(?:-|$)/u);
  if (!match) return Number.NaN;
  const value = `${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

function recordTimestamp(record) {
  const timestamp = Date.parse(text(record?.timestamp));
  if (Number.isFinite(timestamp)) return timestamp;
  return filenameDate(record?.source?.filename ?? record?.filename);
}

function recordSourceCompare(left, right) {
  return compareUtf8Bytes(left?.source?.filename ?? left?.filename, right?.source?.filename ?? right?.filename)
    || finiteNumber(left?.source?.sentenceOrdinal ?? left?.sentenceOrdinal)
      - finiteNumber(right?.source?.sentenceOrdinal ?? right?.sentenceOrdinal)
    || compareUtf8Bytes(left?.sentenceText, right?.sentenceText)
    || compareUtf8Bytes(
      JSON.stringify(canonicalJson(left?.sentence)),
      JSON.stringify(canonicalJson(right?.sentence))
    )
    || compareUtf8Bytes(
      JSON.stringify(canonicalJson(left)),
      JSON.stringify(canonicalJson(right))
    );
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function recentRecordCompare(left, right) {
  const leftTimestamp = recordTimestamp(left);
  const rightTimestamp = recordTimestamp(right);
  if (Number.isFinite(leftTimestamp) && Number.isFinite(rightTimestamp) && leftTimestamp !== rightTimestamp) {
    return rightTimestamp - leftTimestamp;
  }
  if (Number.isFinite(leftTimestamp) !== Number.isFinite(rightTimestamp)) {
    return Number.isFinite(rightTimestamp) ? 1 : -1;
  }
  return recordSourceCompare(right, left);
}

function recordBeforeAsOf(record, asOfMs) {
  const timestamp = recordTimestamp(record);
  return !Number.isFinite(timestamp) || timestamp <= asOfMs;
}

function taskBeforeAsOf(task, asOfMs) {
  const queuedAt = Date.parse(text(task?.queuedAt));
  return !Number.isFinite(queuedAt) || queuedAt <= asOfMs;
}

async function listPyaFiles(root, current = root, output = []) {
  let entries = [];
  try {
    entries = await fs.readdir(current, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return output;
    throw error;
  }
  entries.sort((left, right) => compareUtf8Bytes(left.name, right.name));
  for (const entry of entries) {
    const target = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await listPyaFiles(root, target, output);
    } else if (entry.isFile() && entry.name.endsWith(".pya")) {
      output.push(target);
    }
  }
  return output;
}

function relativeLocator(worldRoot, target) {
  return path.relative(worldRoot, target).split(path.sep).join("/");
}

async function parsePyaRecords(filePath, worldRoot) {
  let source;
  try {
    source = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const records = [];
  const lines = splitSentences(source, { includeThen: true });
  for (const [index, line] of lines.entries()) {
    const sentenceText = text(line);
    if (!sentenceText) continue;
    let sentence;
    try {
      sentence = parse(sentenceText);
    } catch {
      continue;
    }
    records.push({
      source: {
        filename: relativeLocator(worldRoot, filePath),
        sentenceOrdinal: index + 1
      },
      sentence,
      sentenceText,
      timestamp: sentenceTimestamp(sentence)
    });
  }
  return records;
}

async function readNewspaperState(worldRoot, asOf, newspaperLimit) {
  const newspaperRoot = path.join(worldRoot, "newspaper");
  const files = await listPyaFiles(newspaperRoot);
  const all = [];
  for (const filePath of files) {
    all.push(...await parsePyaRecords(filePath, worldRoot));
  }
  const asOfMs = asOfMilliseconds(asOf);
  const visible = all.filter(record => recordBeforeAsOf(record, asOfMs));
  const recent = visible
    .sort(recentRecordCompare)
    .slice(0, newspaperLimit)
    .map(clone);
  return { all: visible, recent };
}

async function readActivityState(worldRoot, asOf, activityLimit) {
  const files = await listPyaFiles(worldRoot);
  const grouped = new Map();
  const asOfMs = asOfMilliseconds(asOf);
  for (const filePath of files) {
    const relativeFile = relativeLocator(worldRoot, filePath);
    const firstPart = relativeFile.split("/")[0];
    if (path.basename(filePath) !== ".activity.pya" || SKIPPED_ACTIVITY_ROOTS.has(firstPart)) continue;
    const name = path.posix.dirname(relativeFile) || "world";
    const visible = (await parsePyaRecords(filePath, worldRoot))
      .filter(record => recordBeforeAsOf(record, asOfMs))
      .sort(recentRecordCompare);
    grouped.set(name, {
      name,
      source: { filename: relativeFile },
      activity: visible.slice(0, activityLimit),
      activityTotal: visible.length
    });
  }
  return [...grouped.values()].sort((left, right) => compareUtf8Bytes(left.name, right.name));
}

function kindForSentences(sentences) {
  const facets = new Set(sentences.map(sentence => text(sentence?.be)));
  const candidates = ["bet", "person", "company", "duty", "relations", "contacting"];
  return candidates.find(kind => facets.has(kind)) ?? "";
}

function bundlesFromNewspaper(records) {
  const grouped = new Map();
  for (const record of records) {
    const sentence = record?.sentence;
    if (!isEvidenceSentence(sentence) || !sentence?.su?.name) continue;
    const subject = text(sentence.su.name);
    const list = grouped.get(subject) ?? [];
    list.push(sentence);
    grouped.set(subject, list);
  }
  const bundles = [];
  for (const [subject, sentences] of grouped.entries()) {
    const kind = kindForSentences(sentences);
    if (!KNOWN_KINDS.has(kind)) continue;
    bundles.push({ kind, bundle: normalizeLinkedClaimBundle(sentences) });
  }
  return bundles.sort((left, right) => (
    compareUtf8Bytes(left.bundle.subjectKey, right.bundle.subjectKey)
      || compareUtf8Bytes(left.kind, right.kind)
  ));
}

function suppliedBundles(options, source) {
  if (options.bundles !== undefined) return options.bundles;
  if (options.knowledgeBundles !== undefined) return options.knowledgeBundles;
  if (source?.bundles !== undefined) return source.bundles;
  return bundlesFromNewspaper(
    source?.newspaperAll
      ?? source?.newspaper
      ?? options.newspaper
      ?? []
  );
}

function subjectName(subjectKey) {
  const match = text(subjectKey).match(/^su name (.+)$/u);
  return match?.[1] ?? text(subjectKey);
}

function facetView(bundle, facet) {
  return clone(bundle.facets?.[facet] ?? null);
}

function commitmentEvidence(bundle) {
  const evidence = [];
  for (const facet of Object.keys(bundle.provenance ?? {}).sort(compareUtf8Bytes)) {
    const view = bundle.provenance[facet];
    for (const record of view?.records ?? []) {
      evidence.push({ facet, ...clone(record) });
    }
  }
  return evidence.sort((left, right) => (
    compareUtf8Bytes(left.facet, right.facet)
      || compareUtf8Bytes(left.key, right.key)
      || compareUtf8Bytes(left.anchorId, right.anchorId)
      || compareUtf8Bytes(left.sentence, right.sentence)
      || compareUtf8Bytes(
        JSON.stringify(canonicalJson(left)),
        JSON.stringify(canonicalJson(right))
      )
  ));
}

function recordPayloadText(view) {
  const record = view?.record ?? view?.records?.[0];
  return text(record?.payload?.text ?? record?.payload?.name ?? record?.payload?.date);
}

function commitmentDescription(bundle) {
  const bet = bundle.facets?.bet;
  if (bet?.status === "current") {
    return {
      description: recordPayloadText(bet),
      descriptionCandidates: []
    };
  }
  const candidates = (bet?.records ?? [])
    .map(clone)
    .sort((left, right) => (
      compareUtf8Bytes(left.key, right.key)
        || compareUtf8Bytes(left.anchorId, right.anchorId)
        || compareUtf8Bytes(left.sentence, right.sentence)
        || compareUtf8Bytes(
          JSON.stringify(canonicalJson(left)),
          JSON.stringify(canonicalJson(right))
        )
    ));
  return {
    description: null,
    descriptionCandidates: candidates
  };
}

function projectCommitments(knowledge) {
  return knowledge.bundles
    .filter(bundle => bundle.kind === "bet")
    .map(bundle => ({
      id: subjectName(bundle.subjectKey),
      subjectKey: bundle.subjectKey,
      status: bundle.status,
      ...commitmentDescription(bundle),
      person: facetView(bundle, "person"),
      company: facetView(bundle, "company"),
      deadline: facetView(bundle, "deadline"),
      duty: facetView(bundle, "duty"),
      evidence: commitmentEvidence(bundle),
      provenance: clone(bundle.provenance)
    }))
    .sort((left, right) => (
      compareUtf8Bytes(left.subjectKey, right.subjectKey)
        || compareUtf8Bytes(left.id, right.id)
    ));
}

function projectWork(workTasks) {
  return workTasks
    .map(clone)
    .sort((left, right) => compareUtf8Bytes(left.taskId, right.taskId)
      || compareUtf8Bytes(
        JSON.stringify(canonicalJson(left)),
        JSON.stringify(canonicalJson(right))
      ));
}

function projectApprovals(workTasks) {
  return workTasks
    .filter(task => text(task?.checkpoint?.approval?.state))
    .map(task => ({
      ...clone(task.checkpoint.approval),
      taskId: text(task.taskId)
    }))
    .sort((left, right) => (
      compareUtf8Bytes(left.taskId, right.taskId)
        || compareUtf8Bytes(left.requestId, right.requestId)
        || compareUtf8Bytes(left.state, right.state)
        || compareUtf8Bytes(
          JSON.stringify(canonicalJson(left)),
          JSON.stringify(canonicalJson(right))
        )
    ));
}

function projectChannels(channels, asOf) {
  const asOfMs = asOfMilliseconds(asOf);
  return channels
    .map(entry => {
      const envelope = entry?.envelope && typeof entry.envelope === "object"
        ? entry.envelope
        : entry;
      return {
        location: text(entry?.location),
        filename: text(entry?.filename),
        path: text(entry?.path),
        ...clone(envelope)
      };
    })
    .filter(channel => {
      const queuedAt = Date.parse(text(channel.queuedAt));
      return !Number.isFinite(queuedAt) || queuedAt <= asOfMs;
    })
    .sort((left, right) => (
      compareUtf8Bytes(left.queuedAt, right.queuedAt)
        || compareUtf8Bytes(left.location, right.location)
        || compareUtf8Bytes(left.channelType, right.channelType)
        || compareUtf8Bytes(left.agentName, right.agentName)
        || compareUtf8Bytes(left.identity, right.identity)
        || compareUtf8Bytes(left.filename, right.filename)
        || compareUtf8Bytes(left.payloadId, right.payloadId)
        || compareUtf8Bytes(left.eventId, right.eventId)
        || compareUtf8Bytes(left.path, right.path)
        || compareUtf8Bytes(
          JSON.stringify(canonicalJson(left)),
          JSON.stringify(canonicalJson(right))
        )
    ));
}

function projectNewspaper(records, asOf) {
  const asOfMs = asOfMilliseconds(asOf);
  return records
    .map(clone)
    .filter(record => recordBeforeAsOf(record, asOfMs))
    .sort(recentRecordCompare);
}

function projectSpaces(spaces, activityLimit) {
  const seen = new Set();
  const projected = [];
  for (const space of spaces) {
    const name = text(space?.name);
    if (!name) continue;
    if (seen.has(name)) defect(`duplicate space name: ${name}`);
    seen.add(name);
    const activity = Array.isArray(space?.activity) ? space.activity : [];
    projected.push({
      name,
      source: clone(space?.source ?? {}),
      activity: activity
        .map(clone)
        .sort(recentRecordCompare)
        .slice(0, activityLimit)
    });
  }
  return projected.sort((left, right) => compareUtf8Bytes(left.name, right.name));
}

function statusActivityMarker(status) {
  return HEADQUARTERS_ACTIVITY_POLICY.statusActivity[status] ?? status;
}

function workMarker(task, marker, extra = {}) {
  const taskId = text(task?.taskId);
  const space = text(task?.domain) ? `workplace/${text(task.domain)}` : "workplace";
  return {
    space,
    marker,
    source: { kind: "work", taskId },
    identity: taskId,
    ...extra
  };
}

function activityMarkersForTask(task) {
  const status = text(task?.status);
  const markers = [workMarker(task, "status", {
    signal: "work-status",
    status
  })];
  const statusMarker = statusActivityMarker(status);
  if (statusMarker) {
    markers.push(workMarker(task, statusMarker, {
      signal: "work-status",
      status
    }));
  }
  const approval = task?.checkpoint?.approval;
  if (text(approval?.state) === "pending") {
    markers.push(workMarker(task, "approval-wait", {
      signal: "approval",
      approvalState: text(approval.state)
    }));
  }
  if (text(task?.escalation?.state)) {
    markers.push(workMarker(task, "escalation", {
      signal: "escalation",
      escalation: clone(task.escalation)
    }));
  }
  for (const event of task?.delegationEvents ?? []) {
    const eventType = text(event?.type);
    const timestamp = text(event?.timestamp);
    const marker = HEADQUARTERS_ACTIVITY_POLICY.handoffEvents.includes(eventType)
      ? "handoff"
      : "delegation";
    markers.push(workMarker(task, marker, {
      signal: "delegation",
      eventType,
      identity: `${text(task.taskId)}:${eventType}:${timestamp}`,
      delegation: clone(event)
    }));
  }
  return markers;
}

function channelActivityMarker(location) {
  return HEADQUARTERS_ACTIVITY_POLICY.channelLifecycle[location] ?? "";
}

function activityMarkerCompare(left, right) {
  return compareUtf8Bytes(left.space, right.space)
    || compareUtf8Bytes(left.marker, right.marker)
    || compareUtf8Bytes(left.signal, right.signal)
    || compareUtf8Bytes(left.status, right.status)
    || compareUtf8Bytes(left.eventType, right.eventType)
    || compareUtf8Bytes(left.identity, right.identity)
    || compareUtf8Bytes(left.source?.kind, right.source?.kind)
    || compareUtf8Bytes(left.source?.filename, right.source?.filename)
    || compareUtf8Bytes(left.source?.location, right.source?.location)
    || compareUtf8Bytes(left.source?.path, right.source?.path)
    || compareUtf8Bytes(left.source?.taskId, right.source?.taskId)
    || finiteNumber(left.source?.sentenceOrdinal) - finiteNumber(right.source?.sentenceOrdinal)
    || compareUtf8Bytes(
      JSON.stringify(canonicalJson(left)),
      JSON.stringify(canonicalJson(right))
    );
}

function projectActivityMarkers({ work, channels, spaces }) {
  const markers = [];
  for (const channel of channels) {
    const marker = channelActivityMarker(channel.location);
    if (!marker) continue;
    markers.push({
      space: "mailroom",
      marker,
      signal: "channel-lifecycle",
      source: {
        kind: "channel",
        filename: channel.filename,
        location: channel.location,
        path: channel.path
      },
      identity: text(channel.identity || channel.payloadId || channel.eventId)
    });
  }
  for (const task of work) {
    markers.push(...activityMarkersForTask(task));
  }
  for (const space of spaces) {
    for (const entry of space.activity ?? []) {
      markers.push({
        space: space.name,
        marker: text(entry?.sentence?.be),
        signal: "space-activity",
        source: clone(entry?.source ?? {}),
        identity: text(entry?.sentence?.su?.name ?? entry?.sentence?.su?.text)
      });
    }
  }
  return markers
    .filter(marker => marker.space && marker.marker)
    .sort(activityMarkerCompare);
}

function attachActivityMarkers(spaces, markers) {
  const bySpace = new Map();
  for (const marker of markers) {
    const list = bySpace.get(marker.space) ?? [];
    list.push(clone(marker));
    bySpace.set(marker.space, list);
  }
  const names = new Set(spaces.map(space => space.name));
  for (const name of bySpace.keys()) names.add(name);
  return [...names]
    .sort(compareUtf8Bytes)
    .map(name => {
      const source = spaces.find(space => space.name === name);
      return {
        name,
        source: clone(source?.source ?? {}),
        activity: clone(source?.activity ?? []),
        activityMarkers: (bySpace.get(name) ?? []).sort(activityMarkerCompare)
      };
    });
}

function collectionLimit(options, name, fallback) {
  const configuredGroups = [options.collectionLimits, options.limits]
    .filter(value => value !== undefined);
  for (const group of configuredGroups) {
    if (!group || typeof group !== "object" || Array.isArray(group)) {
      defect("collection limits must be maps");
    }
  }
  const directName = name === "spaceActivity" ? "activityLimit" : `${name}Limit`;
  const configured = configuredGroups
    .map(group => group[name])
    .find(value => value !== undefined)
    ?? options[directName];
  return boundedLimit(configured, `${name} limit`, fallback);
}

function pageCollection(values, limit, total = values.length) {
  const reportedTotal = Number.isInteger(Number(total)) && Number(total) >= values.length
    ? Number(total)
    : values.length;
  const items = values.slice(0, limit);
  return {
    items,
    limit,
    total: reportedTotal,
    returned: items.length,
    truncated: items.length < reportedTotal
  };
}

function pageMeta(page) {
  return {
    limit: page.limit,
    total: page.total,
    returned: page.returned,
    truncated: page.truncated
  };
}

function spaceActivityPagination(sourceSpaces, returnedSpaces, activityLimit) {
  const sourceByName = new Map(
    sourceSpaces
      .map(space => [text(space?.name), space])
      .filter(([name]) => name)
  );
  return returnedSpaces
    .map(space => {
      const name = text(space?.name);
      if (!name) return null;
      const source = sourceByName.get(name);
      const activity = Array.isArray(source?.activity) ? source.activity : [];
      const sourceTotal = Number(source?.activityTotal);
      const total = Number.isInteger(sourceTotal) && sourceTotal >= activity.length
        ? sourceTotal
        : activity.length;
      return {
        name,
        limit: activityLimit,
        total,
        returned: Math.min(activity.length, activityLimit),
        truncated: activity.length > activityLimit || total > activityLimit
      };
    })
    .filter(Boolean)
    .sort((left, right) => compareUtf8Bytes(left.name, right.name));
}

/**
 * Read only the canonical filesystem inputs used by the Headquarters state
 * snapshot. This function deliberately does not prepare queues or write any
 * missing world directories.
 */
export async function readHeadquartersStateSources({
  worldRoot,
  asOf,
  newspaperLimit = DEFAULT_NEWSPAPER_LIMIT,
  activityLimit = DEFAULT_ACTIVITY_LIMIT,
  collectionLimits,
  limits,
  bundles,
  knowledgeBundles
} = {}) {
  const root = text(worldRoot);
  if (!root) defect("worldRoot is required");
  const resolvedRoot = path.resolve(root);
  const normalizedAsOf = asOfIso(asOf);
  const asOfMs = asOfMilliseconds(normalizedAsOf);
  const boundedNewspaperLimit = collectionLimit(
    { collectionLimits, limits, newspaperLimit },
    "newspaper",
    DEFAULT_NEWSPAPER_LIMIT
  );
  const boundedActivityLimit = collectionLimit(
    { collectionLimits, limits, activityLimit },
    "spaceActivity",
    DEFAULT_ACTIVITY_LIMIT
  );
  const [workTasks, channels, newspaperState, spaces] = await Promise.all([
    listWorkTasks(resolvedRoot, { includeTerminal: true, readOnly: true })
      .then(tasks => tasks.filter(task => taskBeforeAsOf(task, asOfMs))),
    listChannelEnvelopes(resolvedRoot),
    readNewspaperState(resolvedRoot, normalizedAsOf, boundedNewspaperLimit),
    readActivityState(resolvedRoot, normalizedAsOf, boundedActivityLimit)
  ]);
  const source = {
    bundles: bundles ?? knowledgeBundles,
    newspaperAll: newspaperState.all
  };
  return {
    asOf: normalizedAsOf,
    bundles: source.bundles ?? bundlesFromNewspaper(source.newspaperAll),
    workTasks,
    channels,
    newspaper: newspaperState.recent,
    newspaperLimit: boundedNewspaperLimit,
    newspaperTotal: newspaperState.all.length,
    activityLimit: boundedActivityLimit,
    spaces
  };
}

/**
 * Purely shape the supplied canonical inputs. Knowledge Core remains the only
 * validator, conflict resolver, and provenance view used for commitments.
 */
export async function projectHeadquartersState(options = {}) {
  const source = options.sources ?? {};
  const asOf = asOfIso(options.asOf ?? source.asOf);
  const limits = {
    commitments: collectionLimit(options, "commitments", DEFAULT_COLLECTION_LIMIT),
    work: collectionLimit(options, "work", DEFAULT_COLLECTION_LIMIT),
    approvals: collectionLimit(options, "approvals", DEFAULT_COLLECTION_LIMIT),
    channels: collectionLimit(options, "channels", DEFAULT_COLLECTION_LIMIT),
    newspaper: collectionLimit(options, "newspaper", options.newspaperLimit ?? DEFAULT_NEWSPAPER_LIMIT),
    spaces: collectionLimit(options, "spaces", DEFAULT_COLLECTION_LIMIT),
    activityMarkers: collectionLimit(options, "activityMarkers", DEFAULT_COLLECTION_LIMIT)
  };
  const activityLimit = collectionLimit(
    options,
    "spaceActivity",
    options.activityLimit ?? source.activityLimit ?? DEFAULT_ACTIVITY_LIMIT
  );
  const bundles = suppliedBundles(options, source);
  const workTasks = options.workTasks ?? source.workTasks ?? [];
  const channels = options.channels ?? source.channels ?? [];
  const newspaper = options.newspaper ?? source.newspaper ?? [];
  const spaces = options.spaces ?? source.spaces ?? [];
  if (!Array.isArray(workTasks)) defect("workTasks must be an array");
  if (!Array.isArray(channels)) defect("channels must be an array");
  if (!Array.isArray(newspaper)) defect("newspaper must be an array");
  if (!Array.isArray(spaces)) defect("spaces must be an array");

  const asOfMs = asOfMilliseconds(asOf);
  const visibleWorkTasks = workTasks.filter(task => taskBeforeAsOf(task, asOfMs));
  const knowledge = await projectHeadquartersKnowledge({
    bundles,
    workTasks: visibleWorkTasks,
    modulePath: options.modulePath
  });
  const projectedWork = projectWork(visibleWorkTasks);
  const projectedApprovals = projectApprovals(visibleWorkTasks);
  const projectedChannels = projectChannels(channels, asOf);
  const projectedSpaces = projectSpaces(spaces, activityLimit);
  const allActivityMarkers = projectActivityMarkers({
    work: projectedWork,
    channels: projectedChannels,
    spaces: projectedSpaces
  });
  const allCommitments = projectCommitments(knowledge);
  const allNewspaper = projectNewspaper(newspaper, asOf);
  const commitmentPage = pageCollection(allCommitments, limits.commitments);
  const workPage = pageCollection(projectedWork, limits.work);
  const approvalPage = pageCollection(projectedApprovals, limits.approvals);
  const channelPage = pageCollection(projectedChannels, limits.channels);
  const newspaperPage = pageCollection(
    allNewspaper,
    limits.newspaper,
    options.newspaperTotal ?? source.newspaperTotal ?? allNewspaper.length
  );
  const activityPage = pageCollection(allActivityMarkers, limits.activityMarkers);
  const spacePage = pageCollection(
    attachActivityMarkers(projectedSpaces, activityPage.items),
    limits.spaces
  );
  const spaceActivityPages = spaceActivityPagination(spaces, spacePage.items, activityLimit);
  const snapshot = {
    asOf,
    commitments: commitmentPage.items,
    work: workPage.items,
    approvals: approvalPage.items,
    channels: channelPage.items,
    newspaper: newspaperPage.items,
    spaces: spacePage.items,
    activityMarkers: activityPage.items,
    pagination: {
      commitments: pageMeta(commitmentPage),
      work: pageMeta(workPage),
      approvals: pageMeta(approvalPage),
      channels: pageMeta(channelPage),
      newspaper: pageMeta(newspaperPage),
      spaces: pageMeta(spacePage),
      activityMarkers: pageMeta(activityPage),
      spaceActivity: spaceActivityPages
    },
    layout: projectHeadquartersLayout({
      commitments: commitmentPage.items,
      work: workPage.items,
      approvals: approvalPage.items,
      channels: channelPage.items,
      spaces: spacePage.items
    })
  };
  return freeze(snapshot);
}

/**
 * Read the canonical world and return one immutable Headquarters snapshot.
 */
export async function readHeadquartersState(options = {}) {
  const sources = await readHeadquartersStateSources(options);
  return projectHeadquartersState({
    ...options,
    ...sources,
    sources
  });
}
