import { remember, doRemember, pushMemoryContext, popMemoryContext } from "../remember/index.mjs";
import { state } from "../bridge/state.mjs";
import { throwErrorSentence } from "../error.mjs";

async function resolveInterpret() {
  const mod = await import("../bridge/index.mjs");
  return mod.interpret;
}

function resolveSeries(sentence, { rememberFn = remember } = {}) {
  const name = sentence?.from?.name ?? sentence?.from?.text;
  if (!name) return null;
  const fact = rememberFn(name);
  if (!fact || fact.be !== "series" || !Array.isArray(fact.ob?.series)) return null;
  return { name, entries: fact.ob.series };
}

function resolveMapperName(sentence) {
  return sentence?.by?.name ?? sentence?.by?.text ?? sentence?.by?.wo ?? null;
}

function buildElementSentence(base, entry, index, count) {
  const elem = {
    mood: "do",
    be: resolveMapperName(base)
  };

  if (base.as) elem.as = base.as;
  if (base.accordingto) elem.accordingto = base.accordingto;
  if (base.fromstate) elem.fromstate = base.fromstate;
  if (base.tostate) elem.tostate = base.tostate;
  if (base.become) elem.become = base.become;
  if (base.during) elem.during = base.during;
  if (base.with) elem.with = base.with;
  if (base.at) elem.at = base.at;

  if (entry?.from) elem.from = entry.from;
  if (entry?.ob !== undefined) {
    elem.ob = typeof entry.ob === "object" && entry.ob !== null ? { ...entry.ob } : entry.ob;
  } else if (entry !== undefined) {
    elem.ob = entry;
  }

  elem.fromindex = { num: index, register: true };
  elem.toindex = { num: count - 1, register: true };
  elem.this = {
    ...(base.this || {}),
    fromindex: elem.fromindex,
    toindex: elem.toindex,
    by: base.by
  };

  return elem;
}

function normalizeResult(res) {
  if (res && typeof res === "object") {
    if (res.mood || res.be || res.ob) {
      const entry = { ...res };
      if (!entry.mood) entry.mood = "ya";
      return entry;
    }
  }
  if (typeof res === "number") {
    return { mood: "ya", ob: { num: res }, be: "number" };
  }
  if (typeof res === "boolean") {
    return { mood: "ya", ob: { boolean: res }, be: "boolean" };
  }
  if (typeof res === "string") {
    return { mood: "ya", ob: { text: res }, be: "text" };
  }
  if (Array.isArray(res)) {
    return { mood: "ya", ob: { ve: { values: res } }, be: "vector" };
  }
  if (res && typeof res === "object") {
    if (res.num !== undefined) return { mood: "ya", ob: { num: res.num }, be: "number" };
    if (res.text !== undefined) return { mood: "ya", ob: { text: res.text }, be: "text" };
    if (res.boolean !== undefined) return { mood: "ya", ob: { boolean: res.boolean }, be: "boolean" };
    if (res.ve?.values) return { mood: "ya", ob: { ve: res.ve }, be: "vector" };
  }
  return { mood: "ya", ob: { hollow: true }, be: "hollow" };
}

export async function seriesMap(sentence, { remember: rememberFn = remember } = {}) {
  const mapper = resolveMapperName(sentence);
  if (!mapper) {
    throwErrorSentence({
      name: "series map defective",
      message: "series map defective: missing by name <mapper>",
      from: { name: "series map" },
      raw: sentence
    });
  }

  const series = resolveSeries(sentence, { rememberFn });
  if (!series) {
    throwErrorSentence({
      name: "series map defective",
      message: "series map defective: missing from name <series>",
      from: { name: "series map" },
      raw: sentence
    });
  }

  const interpret = await resolveInterpret();
  const outputEntries = [];
  const count = series.entries.length;

  for (let i = 0; i < count; i += 1) {
    const entry = series.entries[i];
    const elemSentence = buildElementSentence(sentence, entry, i, count);

    pushMemoryContext({ seedFromCurrent: true });
    const prevEvoke = state.currentEvoke;
    const prevEvokeRef = state.currentEvokeRef;
    state.currentEvoke = elemSentence;
    state.currentEvokeRef = elemSentence;

    let res;
    try {
      res = await interpret(elemSentence);
    } finally {
      state.currentEvoke = prevEvoke;
      state.currentEvokeRef = prevEvokeRef;
      popMemoryContext();
    }

    const resultObj = res?.value ?? res?.ob ?? res?.result ?? res;
    const normalized = normalizeResult(resultObj);
    if (!normalized.from) normalized.from = { num: i + 1 };
    outputEntries.push(normalized);
  }

  const outputName = sentence?.to?.name ?? "mapped series";
  const seriesSentence = {
    mood: "ya",
    su: { name: outputName },
    be: "series",
    ob: { series: outputEntries }
  };
  doRemember(seriesSentence);
  return seriesSentence;
}

export default seriesMap;

export const signatures = [
  { signatureWords: ["be", "series", "map", "from", "name", "series", "by", "name", "num", "to", "name", "text"], handler: seriesMap },
  { signatureWords: ["be", "series", "map", "from", "name", "series", "by", "name", "num"], handler: seriesMap },
  { signatureWords: ["be", "series", "map", "by", "name", "num", "from", "name", "series", "to", "name", "text"], handler: seriesMap },
  { signatureWords: ["be", "series", "map", "by", "name", "num", "from", "name", "series"], handler: seriesMap },
  { signatureWords: ["be", "series", "map", "from", "name", "series", "by", "name", "text", "to", "name", "text"], handler: seriesMap },
  { signatureWords: ["be", "series", "map", "from", "name", "series", "by", "name", "text"], handler: seriesMap },
  { signatureWords: ["be", "series", "map", "by", "name", "text", "from", "name", "series", "to", "name", "text"], handler: seriesMap },
  { signatureWords: ["be", "series", "map", "by", "name", "text", "from", "name", "series"], handler: seriesMap },
  { signatureWords: ["be", "series", "map", "from", "name", "series", "by", "name", "mind", "to", "name", "text"], handler: seriesMap },
  { signatureWords: ["be", "series", "map", "from", "name", "series", "by", "name", "mind"], handler: seriesMap },
  { signatureWords: ["be", "series", "map", "by", "name", "mind", "from", "name", "series", "to", "name", "text"], handler: seriesMap },
  { signatureWords: ["be", "series", "map", "by", "name", "mind", "from", "name", "series"], handler: seriesMap }
];
