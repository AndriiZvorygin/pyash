import { throwErrorSentence } from "../error.mjs";

const UINT32_MAX = 0xffffffff;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const CONDUCT_FIELDS = Object.freeze([
  ["artificial", "artificial"],
  ["seed", "seed"],
  ["start tick", "startTick"],
  ["parallel capacity", "parallelCapacity"],
  ["waiting capacity", "waitingCapacity"],
  ["schedule newspaper", "scheduleNewspaper"]
]);

function artificialConductDefective() {
  throwErrorSentence({
    name: "artificial conduct defective",
    message: "artificial conduct defective",
    from: { name: "refinery" }
  });
}

function mapEntries(conduct) {
  if (!conduct || typeof conduct !== "object") return null;
  if (conduct.ob?.map && typeof conduct.ob.map === "object" && !Array.isArray(conduct.ob.map)) {
    return conduct.ob.map;
  }
  if (conduct.be === "map" || conduct.be === "json map") return conduct.ob?.map ?? {};
  return conduct;
}

function primitiveValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  if (value.ob && typeof value.ob === "object") return primitiveValue(value.ob);
  if (value.num !== undefined) return value.num;
  if (value.boolean !== undefined) return value.boolean;
  if (value.text !== undefined) return value.text;
  if (value.name !== undefined) return value.name;
  return undefined;
}

function conductValue(conduct, mapKey, directKey) {
  const entries = mapEntries(conduct);
  if (entries && Object.prototype.hasOwnProperty.call(entries, mapKey)) {
    return primitiveValue(entries[mapKey]);
  }
  if (conduct && Object.prototype.hasOwnProperty.call(conduct, directKey)) {
    return primitiveValue(conduct[directKey]);
  }
  return undefined;
}

export function extractSimulationConduct(conduct) {
  const result = {};
  for (const [mapKey, directKey] of CONDUCT_FIELDS) {
    const value = conductValue(conduct, mapKey, directKey);
    if (value !== undefined) result[directKey] = value;
  }
  return result;
}

function requireBoolean(value) {
  return typeof value === "boolean";
}

function requireUint32(value, { positive = false } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) return false;
  if (positive ? value < 1 : value < 0) return false;
  return value <= UINT32_MAX;
}

export function normalizeSimulationContract(conduct) {
  const raw = extractSimulationConduct(conduct);
  if (raw.artificial === undefined) return null;
  if (!requireBoolean(raw.artificial)) artificialConductDefective();
  if (!raw.artificial) return null;
  if (!requireUint32(raw.seed)) artificialConductDefective();
  if (!requireUint32(raw.startTick)) artificialConductDefective();
  if (!requireUint32(raw.parallelCapacity, { positive: true })) artificialConductDefective();
  if (!requireUint32(raw.waitingCapacity)) artificialConductDefective();
  if (raw.scheduleNewspaper !== undefined && !requireBoolean(raw.scheduleNewspaper)) {
    artificialConductDefective();
  }
  return {
    artificial: true,
    seed: raw.seed,
    startTick: raw.startTick,
    parallelCapacity: raw.parallelCapacity,
    waitingCapacity: raw.waitingCapacity,
    scheduleNewspaper: raw.scheduleNewspaper ?? false
  };
}

function utf8Bytes(value) {
  return Buffer.from(String(value ?? ""), "utf8");
}

export function fnv1aUtf8(value) {
  let hash = FNV_OFFSET;
  for (const byte of utf8Bytes(value)) hash = Math.imul(hash ^ byte, FNV_PRIME) >>> 0;
  return hash >>> 0;
}

export function seededRank(platformName, seed) {
  let value = (fnv1aUtf8(platformName) ^ (seed >>> 0)) >>> 0;
  value ^= (value << 13) >>> 0;
  value ^= value >>> 17;
  value ^= (value << 5) >>> 0;
  return value >>> 0;
}

export function compareUtf8(a, b) {
  if (a === b) return 0;
  const left = utf8Bytes(a);
  const right = utf8Bytes(b);
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return left.length < right.length ? -1 : 1;
}

function stageNumber(value, { positive = false } = {}) {
  return requireUint32(value, { positive });
}

function stageAction(platform) {
  return platform?.actionSentence ?? platform?.action ?? {};
}

function stageTiming(platform) {
  const action = stageAction(platform);
  const duration = action?.during?.num;
  const timebox = action?.atmost?.num;
  if (!stageNumber(duration, { positive: true })) artificialConductDefective();
  if (timebox !== undefined && !stageNumber(timebox, { positive: true })) artificialConductDefective();
  return { duration, timebox: timebox === undefined ? null : timebox };
}

function sortByRank(states, names) {
  return [...names].sort((left, right) => {
    const rankDelta = states.get(left).rank - states.get(right).rank;
    return rankDelta || compareUtf8(left, right);
  });
}

function traceRecord({ refinery, platform, tick, ordinal, be, errorText }) {
  const record = {
    mood: "ya",
    be,
    su: { name: platform },
    from: { name: refinery },
    during: { num: tick },
    by: { num: ordinal }
  };
  if (errorText !== undefined) record.ob = { text: errorText };
  return record;
}

function validateRefinery(refinery) {
  if (!refinery || !(refinery.platforms instanceof Map) || !Array.isArray(refinery.order)) {
    artificialConductDefective();
  }
  const names = new Set(refinery.order);
  if (names.size !== refinery.order.length || names.size !== refinery.platforms.size) artificialConductDefective();
  for (const name of refinery.order) {
    const platform = refinery.platforms.get(name);
    if (!platform || !Array.isArray(platform.deps)) artificialConductDefective();
    for (const dependency of platform.deps) {
      if (!names.has(dependency)) artificialConductDefective();
    }
    stageTiming(platform);
  }
}

export function simulateRefinery({ name, refinery, contract } = {}) {
  const normalized = normalizeSimulationContract(contract);
  if (!normalized) return { records: [], completed: [], failed: [], cancelled: [] };
  validateRefinery(refinery);

  const states = new Map();
  for (const platformName of refinery.order) {
    const platform = refinery.platforms.get(platformName);
    const timing = stageTiming(platform);
    states.set(platformName, {
      name: platformName,
      deps: [...platform.deps],
      duration: timing.duration,
      timebox: timing.timebox,
      rank: seededRank(platformName, normalized.seed),
      status: "pending",
      denied: false,
      startTick: null,
      finishTick: null,
      deadline: null
    });
  }

  const records = [];
  const pending = new Set(refinery.order);
  const waiting = new Set();
  const active = new Set();
  const completed = new Set();
  const failed = new Set();
  const cancelled = new Set();
  let ordinal = 0;
  let tick = normalized.startTick;

  const emitSchedule = (platform, be) => {
    ordinal += 1;
    if (normalized.scheduleNewspaper) {
      records.push(traceRecord({ refinery: name, platform, tick, ordinal, be }));
    }
  };
  const emitFault = (platform, text) => {
    ordinal += 1;
    records.push(traceRecord({
      refinery: name,
      platform,
      tick,
      ordinal,
      be: "error",
      errorText: text
    }));
  };
  const isReady = state => state.deps.every(dependency => completed.has(dependency));

  while (pending.size > 0 || waiting.size > 0 || active.size > 0) {
    const completedNow = sortByRank(states, [...active].filter(platformName => {
      const state = states.get(platformName);
      return state.status === "running" && state.finishTick === tick;
    }));
    for (const platformName of completedNow) {
      const state = states.get(platformName);
      state.status = "completed";
      active.delete(platformName);
      completed.add(platformName);
      emitSchedule(platformName, "schedule finish");
    }

    const expiredNow = sortByRank(states, [...active].filter(platformName => {
      const state = states.get(platformName);
      return state.status === "running" && state.deadline !== null && state.deadline <= tick;
    }));
    for (const platformName of expiredNow) {
      const state = states.get(platformName);
      state.status = "failed";
      active.delete(platformName);
      failed.add(platformName);
      emitFault(platformName, "platform timebox");
    }

    const cancelNames = new Set();
    let cancellationChanged = true;
    while (cancellationChanged) {
      cancellationChanged = false;
      for (const platformName of [...pending, ...waiting]) {
        const state = states.get(platformName);
        if (!state.deps.some(dependency => failed.has(dependency) || cancelled.has(dependency))) continue;
        if (!cancelNames.has(platformName)) {
          cancelNames.add(platformName);
          cancellationChanged = true;
        }
      }
      for (const platformName of cancelNames) cancelled.add(platformName);
    }
    for (const platformName of [...cancelNames].sort(compareUtf8)) {
      pending.delete(platformName);
      waiting.delete(platformName);
      const state = states.get(platformName);
      state.status = "cancelled";
      emitFault(platformName, "platform cancel");
    }

    const promotionSlots = normalized.parallelCapacity - active.size;
    const promoted = sortByRank(states, [...waiting]).slice(0, promotionSlots);
    for (const platformName of promoted) {
      waiting.delete(platformName);
      active.add(platformName);
      states.get(platformName).status = "admitted";
    }

    const ready = sortByRank(states, [...pending].filter(platformName => isReady(states.get(platformName))));
    for (const platformName of ready) {
      const state = states.get(platformName);
      if (active.size < normalized.parallelCapacity) {
        pending.delete(platformName);
        active.add(platformName);
        state.status = "admitted";
        emitSchedule(platformName, "schedule admission");
      } else if (waiting.size < normalized.waitingCapacity) {
        pending.delete(platformName);
        waiting.add(platformName);
        state.status = "waiting";
        emitSchedule(platformName, "schedule admission");
      } else if (!state.denied) {
        state.denied = true;
        ordinal += 1;
        if (normalized.scheduleNewspaper) {
          records.push(traceRecord({
            refinery: name,
            platform: platformName,
            tick,
            ordinal,
            be: "schedule crowded",
            errorText: "schedule crowded"
          }));
        }
      }
    }

    for (const platformName of sortByRank(states, [...active].filter(candidate => states.get(candidate).status === "admitted"))) {
      const state = states.get(platformName);
      state.status = "running";
      state.startTick = tick;
      state.finishTick = tick + state.duration;
      state.deadline = state.timebox === null ? null : tick + state.timebox;
      emitSchedule(platformName, "schedule start");
    }

    if (pending.size === 0 && waiting.size === 0 && active.size === 0) break;
    const nextTicks = [];
    for (const platformName of active) {
      const state = states.get(platformName);
      if (state.finishTick > tick) nextTicks.push(state.finishTick);
      if (state.deadline !== null && state.deadline > tick) nextTicks.push(state.deadline);
    }
    if (nextTicks.length === 0) artificialConductDefective();
    const nextTick = Math.min(...nextTicks);
    if (!Number.isSafeInteger(nextTick) || nextTick <= tick) artificialConductDefective();
    tick = nextTick;
  }

  return {
    records,
    completed: [...completed],
    failed: [...failed],
    cancelled: [...cancelled]
  };
}
