import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson, compareUtf8Bytes } from "../../library/knowledge_core.mjs";
import { splitSentences } from "../../library/sentenceSplitter.mjs";
import { parse } from "../../understand/index.mjs";

const DEFAULT_LAYOUT_MODULE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../module/headquarters-layout.pya"
);

// Geometry and activity policy are authored as Pyash facts. JavaScript only
// reads and validates that module, then assembles transient coordinates.

function text(value) {
  return String(value ?? "").trim();
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

function layoutDefect(message) {
  throw new Error(`headquarters layout defective: ${message}`);
}

function readLayoutEntries(source, modulePath) {
  const entries = [];
  for (const raw of splitSentences(source, { includeThen: true })) {
    if (!raw.trim()) continue;
    try {
      entries.push(parse(raw.trim()));
    } catch (error) {
      layoutDefect(`module is not parseable: ${modulePath} (${error?.message ?? "parse error"})`);
    }
  }
  return entries;
}

function layoutPolicyField(fields, name) {
  const value = fields.get(name);
  if (!value) layoutDefect(`module field missing: ${name}`);
  return value;
}

function layoutPolicyNumber(fields, name) {
  const value = layoutPolicyField(fields, name)?.ob?.num;
  if (!Number.isFinite(Number(value))) layoutDefect(`module field is not numeric: ${name}`);
  return Number(value);
}

function layoutPolicyText(fields, name) {
  const value = layoutPolicyField(fields, name)?.ob?.text;
  const result = text(value);
  if (!result) layoutDefect(`module field is empty: ${name}`);
  return result;
}

function layoutPolicyJson(fields, name) {
  try {
    const value = JSON.parse(layoutPolicyText(fields, name));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not a map");
    return value;
  } catch {
    layoutDefect(`module field is not a JSON map: ${name}`);
  }
}

export function readHeadquartersLayoutPolicy(modulePath = DEFAULT_LAYOUT_MODULE_PATH) {
  const resolvedPath = path.resolve(String(modulePath));
  let source;
  try {
    source = fs.readFileSync(resolvedPath, "utf8");
  } catch {
    layoutDefect(`module unavailable: ${resolvedPath}`);
  }
  const entries = readLayoutEntries(source, resolvedPath);
  if (!entries.some(entry => (
    entry?.mood === "def"
      && entry?.be === "map"
      && entry?.su?.name === "headquarter template conduct"
  ))) {
    layoutDefect(`module header missing: ${resolvedPath}`);
  }
  const fields = new Map();
  for (const entry of entries) {
    if (entry?.mood !== "ya" || !entry?.su?.name) continue;
    if (fields.has(entry.su.name)) layoutDefect(`module field repeats: ${entry.su.name}`);
    fields.set(entry.su.name, entry);
  }
  const fixedRooms = {};
  for (const name of ["mailroom", "chief-of-staff"]) {
    const bounds = layoutPolicyJson(fields, `frozen rooms ${name}`);
    for (const key of ["x", "y", "width", "height"]) {
      if (!Number.isFinite(Number(bounds[key]))) layoutDefect(`fixed room ${name} has invalid ${key}`);
      bounds[key] = Number(bounds[key]);
    }
    fixedRooms[name] = bounds;
  }
  const statusActivity = {};
  const statusFields = {
    planning: "planned",
    implementing: "practical",
    reviewing: "reviewing",
    revision: "reform",
    ready: "already",
    blocked: "occluded",
    "usage-limited": "usage-limited",
    accepted: "accept",
    failed: "fail"
  };
  for (const [status, field] of Object.entries(statusFields)) {
    statusActivity[status] = layoutPolicyText(fields, `status activity ${field}`);
  }
  const channelLifecycle = {};
  for (const location of ["input", "runtime", "produce-waiting", "produce-success", "produce-fail"]) {
    channelLifecycle[location] = layoutPolicyText(fields, `channel lifecycle ${location}`);
  }
  const handoffFields = { assigned: "assigned", accepted: "accept" };
  const handoffEvents = Object.entries(handoffFields)
    .filter(([, field]) => layoutPolicyText(fields, `handoff eventive-mood ${field}`) === "truth")
    .map(([eventType]) => eventType)
    .sort(compareUtf8Bytes);
  return freeze({
    roomWidth: layoutPolicyNumber(fields, "rooms widest"),
    roomMinimumHeight: layoutPolicyNumber(fields, "rooms least high"),
    roomGap: layoutPolicyNumber(fields, "rooms distance"),
    roomMargin: layoutPolicyNumber(fields, "rooms margin"),
    placementSize: layoutPolicyNumber(fields, "occupancy magnitude"),
    placementGap: layoutPolicyNumber(fields, "occupancy distance"),
    placementsPerRow: layoutPolicyNumber(fields, "occupancy rower count"),
    dynamicRoomColumns: layoutPolicyNumber(fields, "dynamical rooms cluster"),
    fixedRooms,
    statusActivity,
    channelLifecycle,
    handoffEvents
  });
}

const DEFAULT_LAYOUT_POLICY = readHeadquartersLayoutPolicy();
const ROOM_WIDTH = DEFAULT_LAYOUT_POLICY.roomWidth;
const ROOM_MIN_HEIGHT = DEFAULT_LAYOUT_POLICY.roomMinimumHeight;
const ROOM_GAP = DEFAULT_LAYOUT_POLICY.roomGap;
const ROOM_MARGIN = DEFAULT_LAYOUT_POLICY.roomMargin;
const PLACEMENT_SIZE = DEFAULT_LAYOUT_POLICY.placementSize;
const PLACEMENT_GAP = DEFAULT_LAYOUT_POLICY.placementGap;
const PLACEMENTS_PER_ROW = DEFAULT_LAYOUT_POLICY.placementsPerRow;
const DYNAMIC_ROOM_COLUMNS = DEFAULT_LAYOUT_POLICY.dynamicRoomColumns;
const FIXED_ROOM_BOUNDS = DEFAULT_LAYOUT_POLICY.fixedRooms;

export const HEADQUARTERS_LAYOUT_POLICY = DEFAULT_LAYOUT_POLICY;
export const HEADQUARTERS_ACTIVITY_POLICY = Object.freeze({
  statusActivity: DEFAULT_LAYOUT_POLICY.statusActivity,
  channelLifecycle: DEFAULT_LAYOUT_POLICY.channelLifecycle,
  handoffEvents: DEFAULT_LAYOUT_POLICY.handoffEvents
});

function canonicalTie(left, right) {
  return compareUtf8Bytes(
    JSON.stringify(canonicalJson(left)),
    JSON.stringify(canonicalJson(right))
  );
}

function recordCompare(left, right) {
  return compareUtf8Bytes(left.room, right.room)
    || compareUtf8Bytes(left.kind, right.kind)
    || compareUtf8Bytes(left.id, right.id)
    || compareUtf8Bytes(left.source?.filename, right.source?.filename)
    || compareUtf8Bytes(left.source?.taskId, right.source?.taskId)
    || canonicalTie(left, right);
}

function roomCompare(left, right) {
  return compareUtf8Bytes(left.name, right.name)
    || canonicalTie(left, right);
}

function placementCompare(left, right) {
  return compareUtf8Bytes(left.room, right.room)
    || Number(left.y) - Number(right.y)
    || Number(left.x) - Number(right.x)
    || compareUtf8Bytes(left.kind, right.kind)
    || compareUtf8Bytes(left.id, right.id)
    || canonicalTie(left, right);
}

function domainRoom(task) {
  const domain = text(task?.domain);
  return domain ? `workplace/${domain}` : "workplace";
}

function commitmentRecords(commitments) {
  return commitments.map(commitment => ({
    kind: "commitment",
    id: text(commitment?.subjectKey ?? commitment?.id),
    room: "chief-of-staff",
    status: text(commitment?.status),
    source: {
      kind: "commitment",
      subjectKey: text(commitment?.subjectKey)
    }
  }));
}

function channelRecords(channels) {
  return channels.map(channel => ({
    kind: "channel",
    id: text(channel?.identity || channel?.payloadId || channel?.eventId || channel?.filename),
    room: "mailroom",
    status: text(channel?.phase),
    source: {
      kind: "channel",
      filename: text(channel?.filename),
      location: text(channel?.location),
      path: text(channel?.path)
    }
  }));
}

function workRecords(work, approvals) {
  const approvalByTask = new Map(
    approvals.map(approval => [text(approval?.taskId), approval])
  );
  return work.map(task => ({
    kind: "work",
    id: text(task?.taskId),
    room: domainRoom(task),
    status: text(task?.status),
    approvalState: text(approvalByTask.get(text(task?.taskId))?.state),
    escalationState: text(task?.escalation?.state),
    delegationCount: Array.isArray(task?.delegationEvents) ? task.delegationEvents.length : 0,
    source: {
      kind: "work",
      taskId: text(task?.taskId)
    }
  }));
}

function activityRoomNames(spaces) {
  return spaces
    .map(space => text(space?.name))
    .filter(Boolean);
}

function roomBounds(name, index, recordCount) {
  const fixed = FIXED_ROOM_BOUNDS[name];
  if (fixed) {
    const rows = Math.max(1, Math.ceil(recordCount / PLACEMENTS_PER_ROW));
    return {
      ...fixed,
      height: Math.max(fixed.height, ROOM_MARGIN * 2 + rows * PLACEMENT_SIZE + Math.max(0, rows - 1) * PLACEMENT_GAP)
    };
  }
  const columns = DYNAMIC_ROOM_COLUMNS;
  const column = index % columns;
  const row = Math.floor(index / columns);
  const rows = Math.max(1, Math.ceil(recordCount / PLACEMENTS_PER_ROW));
  return {
    x: column * (ROOM_WIDTH + ROOM_GAP),
    y: ROOM_MIN_HEIGHT + ROOM_GAP + row * (ROOM_MIN_HEIGHT + ROOM_GAP),
    width: ROOM_WIDTH,
    height: Math.max(ROOM_MIN_HEIGHT, ROOM_MARGIN * 2 + rows * PLACEMENT_SIZE + Math.max(0, rows - 1) * PLACEMENT_GAP)
  };
}

function makePlacements(records, boundsByRoom) {
  const byRoom = new Map();
  for (const record of records) {
    const list = byRoom.get(record.room) ?? [];
    list.push(record);
    byRoom.set(record.room, list);
  }
  const placements = [];
  for (const [room, roomRecords] of byRoom.entries()) {
    const bounds = boundsByRoom.get(room);
    roomRecords.sort(recordCompare);
    const columns = Math.max(1, Math.floor(
      (bounds.width - ROOM_MARGIN * 2 + PLACEMENT_GAP) / (PLACEMENT_SIZE + PLACEMENT_GAP)
    ));
    roomRecords.forEach((record, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      placements.push({
        ...clone(record),
        x: bounds.x + ROOM_MARGIN + column * (PLACEMENT_SIZE + PLACEMENT_GAP),
        y: bounds.y + ROOM_MARGIN + row * (PLACEMENT_SIZE + PLACEMENT_GAP),
        width: PLACEMENT_SIZE,
        height: PLACEMENT_SIZE
      });
    });
  }
  return placements.sort(placementCompare);
}

/**
 * Derive the initial Headquarters 2D layout from canonical projection data.
 * Geometry and placements are transient and never written to the world.
 */
export function projectHeadquartersLayout({
  commitments = [],
  work = [],
  approvals = [],
  channels = [],
  spaces = []
} = {}) {
  const records = [
    ...commitmentRecords(commitments),
    ...workRecords(work, approvals),
    ...channelRecords(channels)
  ].sort(recordCompare);
  const recordCounts = new Map();
  for (const record of records) recordCounts.set(record.room, (recordCounts.get(record.room) ?? 0) + 1);

  const roomNames = new Set(["mailroom", "chief-of-staff"]);
  for (const name of activityRoomNames(spaces)) roomNames.add(name);
  for (const task of work) roomNames.add(domainRoom(task));
  const sortedNames = [...roomNames].sort(compareUtf8Bytes);
  const dynamicNames = sortedNames.filter(name => !FIXED_ROOM_BOUNDS[name]);
  const boundsByRoom = new Map();
  for (const name of sortedNames) {
    const index = dynamicNames.indexOf(name);
    boundsByRoom.set(name, roomBounds(name, index, recordCounts.get(name) ?? 0));
  }

  const rooms = sortedNames.map(name => ({
    name,
    bounds: boundsByRoom.get(name)
  })).sort(roomCompare);
  const placements = makePlacements(records, boundsByRoom);
  const width = rooms.reduce((maximum, room) => Math.max(maximum, room.bounds.x + room.bounds.width), 0);
  const height = rooms.reduce((maximum, room) => Math.max(maximum, room.bounds.y + room.bounds.height), 0);

  return freeze({
    bounds: { x: 0, y: 0, width, height },
    rooms,
    placements
  });
}

export { FIXED_ROOM_BOUNDS as HEADQUARTERS_ROOM_BOUNDS };
