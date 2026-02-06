import { remember, doRemember, pushMemoryContext, popMemoryContext } from "../remember/index.mjs";
import { state } from "../bridge/state.mjs";
import { throwErrorSentence } from "../error.mjs";

async function resolveInterpret() {
  const mod = await import("../bridge/index.mjs");
  return mod.interpret;
}

function resolveVector(sentence, { rememberFn = remember } = {}) {
  const name = sentence?.from?.name ?? sentence?.from?.text;
  if (!name) return null;
  const fact = rememberFn(name);
  if (!fact?.ob?.ve?.values) return null;
  return { name, values: fact.ob.ve.values, type: fact.ob.ve.type ?? "raw" };
}

function resolveMapperName(sentence) {
  return sentence?.by?.name ?? sentence?.by?.text ?? sentence?.by?.wo ?? null;
}

function buildElementSentence(base, value, index, count) {
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

  if (typeof value === "number") elem.ob = { num: value };
  else if (typeof value === "string") elem.ob = { text: value };
  else if (typeof value === "boolean") elem.ob = { boolean: value };
  else elem.ob = value ?? {};

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

function normalizeValue(res) {
  if (res && typeof res === "object") {
    if (res.num !== undefined) return res.num;
    if (res.text !== undefined) return res.text;
    if (res.boolean !== undefined) return res.boolean;
    if (res.ve?.values) return res.ve.values;
    return res;
  }
  return res;
}

function inferType(values) {
  if (values.every(v => typeof v === "number")) return "num";
  if (values.every(v => typeof v === "boolean")) return "bool";
  if (values.every(v => typeof v === "string")) return "text";
  return "raw";
}

export async function vectorMap(sentence, { remember: rememberFn = remember } = {}) {
  const mapper = resolveMapperName(sentence);
  if (!mapper) {
    throwErrorSentence({
      name: "vector map defective",
      message: "vector map defective: missing by name <mapper>",
      from: { name: "vector map" },
      raw: sentence
    });
  }

  const vec = resolveVector(sentence, { rememberFn });
  if (!vec) {
    throwErrorSentence({
      name: "vector map defective",
      message: "vector map defective: missing from name <vec>",
      from: { name: "vector map" },
      raw: sentence
    });
  }

  const interpret = await resolveInterpret();
  const out = [];
  const count = vec.values.length;

  for (let i = 0; i < count; i += 1) {
    const elemSentence = buildElementSentence(sentence, vec.values[i], i, count);
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
    out.push(normalizeValue(resultObj));
  }

  const outType = inferType(out);
  const outputName = sentence?.to?.name ?? "mapped vector";
  const sentenceOut = {
    mood: "ya",
    su: { name: outputName },
    be: "vector",
    ob: { ve: { type: outType, values: out } }
  };
  doRemember(sentenceOut);
  return sentenceOut;
}

export default vectorMap;

export const signatures = [
  { signatureWords: ["be", "vector", "map", "from", "name", "vec", "by", "name", "num", "to", "name", "vec"], handler: vectorMap },
  { signatureWords: ["be", "vector", "map", "from", "name", "vec", "by", "name", "num"], handler: vectorMap },
  { signatureWords: ["be", "vector", "map", "by", "name", "num", "from", "name", "vec", "to", "name", "vec"], handler: vectorMap },
  { signatureWords: ["be", "vector", "map", "by", "name", "num", "from", "name", "vec"], handler: vectorMap },
  { signatureWords: ["be", "vector", "map", "from", "name", "vec", "by", "name", "text", "to", "name", "vec"], handler: vectorMap },
  { signatureWords: ["be", "vector", "map", "from", "name", "vec", "by", "name", "text"], handler: vectorMap },
  { signatureWords: ["be", "vector", "map", "by", "name", "text", "from", "name", "vec", "to", "name", "vec"], handler: vectorMap },
  { signatureWords: ["be", "vector", "map", "by", "name", "text", "from", "name", "vec"], handler: vectorMap },
  { signatureWords: ["be", "vector", "map", "from", "name", "vec", "by", "name", "mind", "to", "name", "vec"], handler: vectorMap },
  { signatureWords: ["be", "vector", "map", "from", "name", "vec", "by", "name", "mind"], handler: vectorMap },
  { signatureWords: ["be", "vector", "map", "by", "name", "mind", "from", "name", "vec", "to", "name", "vec"], handler: vectorMap },
  { signatureWords: ["be", "vector", "map", "by", "name", "mind", "from", "name", "vec"], handler: vectorMap },
  { signatureWords: ["be", "vector", "map", "from", "name", "vec", "text", "by", "name", "text", "to", "name", "vec"], handler: vectorMap },
  { signatureWords: ["be", "vector", "map", "from", "name", "vec", "text", "by", "name", "text"], handler: vectorMap },
  { signatureWords: ["be", "vector", "map", "by", "name", "text", "from", "name", "vec", "text", "to", "name", "vec"], handler: vectorMap },
  { signatureWords: ["be", "vector", "map", "by", "name", "text", "from", "name", "vec", "text"], handler: vectorMap },
  { signatureWords: ["be", "vector", "map", "from", "name", "vec", "num", "by", "name", "num", "to", "name", "vec"], handler: vectorMap },
  { signatureWords: ["be", "vector", "map", "from", "name", "vec", "num", "by", "name", "num"], handler: vectorMap },
  { signatureWords: ["be", "vector", "map", "by", "name", "num", "from", "name", "vec", "num", "to", "name", "vec"], handler: vectorMap },
  { signatureWords: ["be", "vector", "map", "by", "name", "num", "from", "name", "vec", "num"], handler: vectorMap },
  { signatureWords: ["be", "vector", "map", "from", "name", "vec", "bool", "by", "name", "text", "to", "name", "vec"], handler: vectorMap },
  { signatureWords: ["be", "vector", "map", "from", "name", "vec", "bool", "by", "name", "text"], handler: vectorMap },
  { signatureWords: ["be", "vector", "map", "by", "name", "text", "from", "name", "vec", "bool", "to", "name", "vec"], handler: vectorMap },
  { signatureWords: ["be", "vector", "map", "by", "name", "text", "from", "name", "vec", "bool"], handler: vectorMap }
];
