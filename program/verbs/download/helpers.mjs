import { remember } from "../../remember/index.mjs";
import { state } from "../../bridge/state.mjs";

function resolveGenitive(genitive, { rememberFn } = {}) {
  const chainArr = Array.isArray(genitive?.chain) ? genitive.chain : [];
  if (chainArr.length === 0) return undefined;

  const [root, ...rest] = chainArr;
  let curr =
    root === "this"
      ? (state.currentEvokeRef || state.currentEvoke)
      : (typeof root === "string" && rememberFn ? rememberFn(root) : undefined);

  for (const part of rest) {
    if (curr && typeof curr === "object" && curr.name && rememberFn) {
      const fact = rememberFn(curr.name);
      if (fact) curr = fact.ob ?? fact;
    }
    if (curr && typeof curr === "object") {
      if (curr.ob?.map && Object.prototype.hasOwnProperty.call(curr.ob.map, part)) {
        curr = curr.ob.map[part];
      } else if (curr.ob && curr.ob[part] !== undefined) {
        curr = curr.ob[part];
      } else {
        curr = curr?.[part];
      }
    } else {
      curr = curr?.[part];
    }
  }

  if (typeof curr === "string") return curr;
  if (typeof curr === "number") return String(curr);
  if (curr && typeof curr === "object") {
    if (typeof curr.filename === "string") return curr.filename;
    if (typeof curr.text === "string") return curr.text;
    if (typeof curr.name === "string") return curr.name;
  }
  return curr;
}

function resolveText(value, { rememberFn } = {}) {
  if (!value) return "";
  if (typeof value.filename === "string") return value.filename;
  if (typeof value.text === "string") return value.text;
  if (value.genitive) {
    const resolved = resolveGenitive(value.genitive, { rememberFn });
    if (typeof resolved === "string") return resolved;
  }
  if (value.name && rememberFn) {
    const fact = rememberFn(value.name);
    if (typeof fact?.ob?.filename === "string") return fact.ob.filename;
    if (typeof fact?.ob?.text === "string") return fact.ob.text;
    if (typeof fact?.ob?.name === "string") return fact.ob.name;
  }
  return "";
}

function resolveUrl(sentence, { rememberFn } = {}) {
  return resolveText(sentence?.from, { rememberFn });
}

function resolveOutput(sentence, { rememberFn } = {}) {
  return resolveText(sentence?.to, { rememberFn });
}

function resolveExtraArgs(sentence, { rememberFn } = {}) {
  if (!rememberFn) return [];
  const sourceName = sentence?.with?.name ?? sentence?.with?.text ?? null;
  if (!sourceName) return [];
  const fact = rememberFn(sourceName);
  const values = fact?.ob?.ve?.values;
  if (!Array.isArray(values)) return [];
  return values.map(value => String(value)).filter(Boolean);
}

function parseMonthWindow(sentence) {
  const direct = sentence?.during?.month;
  if (direct !== undefined) {
    const count = Number(direct);
    if (!Number.isFinite(count) || count <= 0) return null;
    return count;
  }
  const raw = sentence?.during?.name ?? sentence?.during?.text;
  if (!raw || typeof raw !== "string") return null;
  const match = raw.trim().match(/^months?\s+([0-9]+(?:\.[0-9]+)?)$/i);
  if (!match) return null;
  const count = Number(match[1]);
  if (!Number.isFinite(count) || count <= 0) return null;
  return count;
}

function formatMonthWindow(count) {
  const unit = count === 1 ? "month" : "months";
  return `today-${count}${unit}`;
}

function isMultiDownload(sentence) {
  return sentence?.ob?.wo === "all";
}

export {
  resolveGenitive,
  resolveText,
  resolveUrl,
  resolveOutput,
  resolveExtraArgs,
  parseMonthWindow,
  formatMonthWindow,
  isMultiDownload
};
