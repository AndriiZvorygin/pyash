import { state } from "../../bridge/state.mjs";

export const DURATION_UNITS = {
  second: 1000,
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000
};

export function toNumber(v) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v.num === "number") return v.num;
  return 0;
}

export function resolveGenitiveTarget(genitive, remember) {
  const chainArr = Array.isArray(genitive?.chain) ? genitive.chain : [];
  if (chainArr.length === 0) return null;

  let curr =
    chainArr[0] === "this"
      ? state.currentEvokeRef || state.currentEvoke
      : typeof chainArr[0] === "string" && remember
        ? remember(chainArr[0])
        : null;

  let parent = null;
  let key = null;

  for (const part of chainArr.slice(1)) {
    if (curr && typeof curr === "object" && curr.name && remember) {
      const fact = remember(curr.name);
      if (fact) curr = fact.ob ?? fact;
    }
    if (curr && typeof curr === "object" && curr.ob?.map && Object.prototype.hasOwnProperty.call(curr.ob.map, part)) {
      parent = curr.ob.map;
      key = part;
      curr = curr.ob.map[part];
      continue;
    }
    if (curr && typeof curr === "object" && curr.ob && curr.ob[part] !== undefined) {
      parent = curr.ob;
      key = part;
      curr = curr.ob[part];
      continue;
    }
    parent = curr;
    key = part;
    curr = curr?.[part];
  }

  if (!parent || !key) return null;
  return { parent, key, value: curr };
}

export function resolveScalarValue(v, remember) {
  if (v == null) return undefined;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v.text === "string") return v.text;
  if (typeof v.num === "number") return v.num;
  if (typeof v.boolean === "boolean") return v.boolean;
  if (v.genitive) {
    const chainArr = Array.isArray(v.genitive.chain) ? v.genitive.chain : [];
    if (chainArr.length > 0) {
      const [root, ...rest] = chainArr;
      let curr =
        root === "this"
          ? state.currentEvokeRef || state.currentEvoke
          : typeof root === "string" && remember
            ? remember(root)
            : null;

      for (const part of rest) {
        if (curr && typeof curr === "object" && curr.name && remember) {
          const fact = remember(curr.name);
          if (fact) curr = fact.ob ?? fact;
        }
        if (curr && typeof curr === "object" && curr.ob?.map && Object.prototype.hasOwnProperty.call(curr.ob.map, part)) {
          curr = curr.ob.map[part];
          continue;
        }
        if (curr && typeof curr === "object" && curr.ob && curr.ob[part] !== undefined) {
          curr = curr.ob[part];
          continue;
        }
        curr = curr?.[part];
      }

      if (typeof curr === "string" || typeof curr === "number" || typeof curr === "boolean") return curr;
      if (typeof curr?.text === "string") return curr.text;
      if (typeof curr?.num === "number") return curr.num;
      if (typeof curr?.boolean === "boolean") return curr.boolean;
    }
  }
  if (v.thisRef) {
    const ev = state.currentEvokeRef || state.currentEvoke;
    const reg = ev?.[v.thisRef];
    if (typeof reg === "string" || typeof reg === "number" || typeof reg === "boolean") return reg;
    if (typeof reg?.text === "string") return reg.text;
    if (typeof reg?.num === "number") return reg.num;
    if (typeof reg?.boolean === "boolean") return reg.boolean;
  }
  if (typeof v.name === "string") return v.name;
  return undefined;
}

export function resolveDateSlot(slot, remember) {
  if (!slot) return null;
  if (typeof slot.date === "string") return slot.date;
  if (typeof slot.name === "string" && remember) {
    const fact = remember(slot.name);
    if (typeof fact?.ob?.date === "string") return fact.ob.date;
    if (typeof fact?.date === "string") return fact.date;
  }
  return null;
}

export function parseDateValue(value) {
  if (!value) return null;
  if (value === "now") return new Date();
  if (value === "today") {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("plus: date defective");
  return parsed;
}

export function extractDuration(ob) {
  if (!ob || typeof ob !== "object") return null;
  if (ob.month !== undefined) {
    const raw = Number(ob.month);
    if (Number.isNaN(raw)) throw new Error("plus: duration must be numeric");
    return { unit: "month", value: raw };
  }
  for (const unit of Object.keys(DURATION_UNITS)) {
    if (ob[unit] !== undefined) {
      const raw = Number(ob[unit]);
      if (Number.isNaN(raw)) throw new Error("plus: duration must be numeric");
      return { unit, value: raw };
    }
  }
  return null;
}

export function addDurationToDate(dateValue, duration, direction = 1) {
  const base = parseDateValue(dateValue);
  if (!base) throw new Error("plus: date target required");
  if (duration.unit === "month") {
    if (!Number.isInteger(duration.value)) {
      throw new Error("plus: month duration must be an integer");
    }
    const copy = new Date(base.getTime());
    copy.setMonth(copy.getMonth() + duration.value * direction);
    return copy.toISOString();
  }
  const ms = DURATION_UNITS[duration.unit] * duration.value * direction;
  return new Date(base.getTime() + ms).toISOString();
}
