import { remember, doRemember } from "../remember/index.mjs";
import { resolveConfigText } from "../configure/env.mjs";
import { runRefinery, getRefinery } from "../bridge/refinery.mjs";
import { emitExchangeSentence } from "../bridge/exchange.mjs";
import { surfaceErrorSentence } from "../error.mjs";

async function resolveInterpret() {
  const mod = await import("../bridge/index.mjs");
  return mod.interpret;
}

function resolveGenitiveText(genitive) {
  const chainArr = Array.isArray(genitive?.chain) ? genitive.chain : [];
  if (chainArr.length === 0) return undefined;
  const [root, ...rest] = chainArr;
  let curr = typeof root === "string" ? remember(root) : undefined;
  for (const part of rest) {
    if (curr && typeof curr === "object" && curr.name) {
      const fact = remember(curr.name);
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
    if (curr.text !== undefined) return String(curr.text);
    if (curr.num !== undefined) return String(curr.num);
    if (curr.boolean !== undefined) return curr.boolean ? "truth" : "lie";
  }
  return curr;
}

function resolveInputOb(ob) {
  if (!ob || typeof ob !== "object") return null;
  if (typeof ob.text === "string") return { text: ob.text };
  if (typeof ob.num === "number") return { num: ob.num };
  if (typeof ob.boolean === "boolean") return { boolean: ob.boolean };
  if (ob.genitive) {
    const text = resolveGenitiveText(ob.genitive);
    if (typeof text === "string") return { text };
  }
  if (typeof ob.name === "string") {
    const fact = remember(ob.name);
    if (fact?.ob?.text !== undefined) return { text: String(fact.ob.text) };
    if (fact?.ob?.num !== undefined) return { num: Number(fact.ob.num) };
    if (fact?.ob?.boolean !== undefined) return { boolean: !!fact.ob.boolean };
    return { text: ob.name };
  }
  return null;
}

function normalizeKey(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function mapEntryNumber(mapFact, keys) {
  const entries = mapFact?.ob?.map;
  if (!entries || typeof entries !== "object") return null;
  for (const key of keys) {
    const probe = entries[key]
      ?? entries[normalizeKey(key)]
      ?? Object.entries(entries).find(([entryKey]) => normalizeKey(entryKey) === normalizeKey(key))?.[1];
    if (!probe || typeof probe !== "object") continue;
    const value = probe?.ob?.num ?? probe?.ob?.text ?? probe?.num ?? probe?.text;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function buildRetryConfigFromConduct({ sentence, namedTarget, refineryName }) {
  const config = {};
  const sources = [];
  const globalConduct = remember("saddle conduct");
  if (globalConduct?.be === "map") sources.push(globalConduct);
  const targetConductName = namedTarget ? `${namedTarget} saddle conduct` : null;
  if (targetConductName) {
    const targetConduct = remember(targetConductName);
    if (targetConduct?.be === "map") sources.push(targetConduct);
  }
  const refineryConductName = refineryName ? `${refineryName} saddle conduct` : null;
  if (refineryConductName && refineryConductName !== targetConductName) {
    const refineryConduct = remember(refineryConductName);
    if (refineryConduct?.be === "map") sources.push(refineryConduct);
  }
  const explicitConductName = sentence?.under?.name ?? null;
  if (explicitConductName) {
    const explicitConduct = remember(explicitConductName);
    if (explicitConduct?.be === "map") sources.push(explicitConduct);
  }

  for (const source of sources) {
    const attempts = mapEntryNumber(source, ["reiterate attempts", "attempts", "max attempts", "retry attempts"]);
    const delay = mapEntryNumber(source, ["reiterate delay", "delay", "initial delay", "retry delay"]);
    const backoff = mapEntryNumber(source, ["reiterate backoff", "backoff", "retry backoff"]);
    const cap = mapEntryNumber(source, ["reiterate cap", "cap", "max delay", "retry cap"]);
    if (attempts != null) config.maxAttempts = attempts;
    if (delay != null) config.initialDelayMs = delay;
    if (backoff != null) config.backoff = backoff;
    if (cap != null) config.maxDelayMs = cap;
  }

  const callMaxAttempts = sentence?.atmost?.num ?? null;
  if (Number.isFinite(callMaxAttempts)) config.maxAttempts = Number(callMaxAttempts);
  return Object.keys(config).length ? config : null;
}

async function refinery(sentence) {
  const interpret = await resolveInterpret();
  const namedTarget = sentence?.for?.name ?? null;
  const namedTargetFact = namedTarget ? remember(namedTarget) : null;
  const refineryName =
    sentence?.from?.name ??
    sentence?.as?.name ??
    namedTargetFact?.as?.name ??
    namedTargetFact?.from?.name ??
    (namedTarget && getRefinery(namedTarget) ? namedTarget : null) ??
    resolveConfigText("refinery name", { rememberFn: remember }) ??
    null;
  const inputOb = resolveInputOb(sentence?.ob);
  const retryConfig = buildRetryConfigFromConduct({ sentence, namedTarget, refineryName });
  const priorInput = remember("input");

  if (inputOb) {
    const inputBe = inputOb?.num !== undefined ? "number" : inputOb?.boolean !== undefined ? "bool" : "text";
    doRemember({ mood: "ya", su: { name: "input" }, ob: inputOb, be: inputBe });
  }

  try {
    const resultSentence = await runRefinery({
      name: refineryName,
      interpret,
      retryConfig,
      runId: null,
      onEvoke: (actionSentence) => {
        emitExchangeSentence({ mood: "ya", be: "evoke", ob: { la: actionSentence } });
      },
      onCheckpoint: (checkpointSentence) => {
        emitExchangeSentence(checkpointSentence);
      },
      onRetry: (retrySentence) => {
        emitExchangeSentence(retrySentence);
      },
      onResult: (res) => {
        const surfaced = surfaceErrorSentence(res);
        if (surfaced?.mood) emitExchangeSentence(surfaced);
      }
    });
    if (resultSentence?.mood && resultSentence?.be) {
      if (resultSentence.be === "error") return resultSentence;
      if (resultSentence.be === "ratify") return resultSentence;
      return { ob: resultSentence.ob ?? {}, be: resultSentence.be };
    }
    return { ob: resultSentence ?? {}, be: "result" };
  } finally {
    if (priorInput) doRemember(priorInput);
  }
}

export const signatures = [
  { signatureWords: ["be", "write", "for", "name", "text", "ob", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "write", "for", "name", "text", "ob", "name", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "write", "for", "name", "text", "ob", "text", "to", "text"], handler: refinery },
  { signatureWords: ["be", "write", "for", "name", "text", "ob", "name", "text", "to", "text"], handler: refinery },
  { signatureWords: ["be", "write", "for", "name", "text", "ob", "text"], handler: refinery },
  { signatureWords: ["be", "write", "for", "name", "text", "ob", "name", "text"], handler: refinery },
  { signatureWords: ["be", "write", "for", "name", "refinery", "ob", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "write", "for", "name", "refinery", "ob", "name", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "write", "for", "name", "refinery", "ob", "text", "to", "text"], handler: refinery },
  { signatureWords: ["be", "write", "for", "name", "refinery", "ob", "name", "text", "to", "text"], handler: refinery },
  { signatureWords: ["be", "write", "for", "name", "refinery", "ob", "text"], handler: refinery },
  { signatureWords: ["be", "write", "for", "name", "refinery", "ob", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "for", "name", "refinery", "ob", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "for", "name", "refinery", "ob", "name", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "for", "name", "refinery", "ob", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "for", "name", "refinery", "ob", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "num", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "ob", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "text", "ob", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "text", "ob", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "num", "ob", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "ob", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "text", "ob", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "text", "ob", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "num", "ob", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "ob", "name", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "ob", "name", "text", "to", "name", "text", "under", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "ob", "name", "text", "to", "name", "text", "beneath", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "ob", "name", "text", "to", "name", "text", "beneath", "name", "map"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "text", "ob", "name", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "text", "ob", "name", "text", "to", "name", "text", "under", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "text", "ob", "name", "text", "to", "name", "text", "beneath", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "text", "ob", "name", "text", "to", "name", "text", "beneath", "name", "map"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "text", "ob", "name", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "text", "ob", "name", "text", "to", "name", "text", "under", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "text", "ob", "name", "text", "to", "name", "text", "beneath", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "text", "ob", "name", "text", "to", "name", "text", "beneath", "name", "map"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "num", "ob", "name", "text", "to", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "num", "ob", "name", "text", "to", "name", "text", "under", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "num", "ob", "name", "text", "to", "name", "text", "beneath", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "num", "ob", "name", "text", "to", "name", "text", "beneath", "name", "map"], handler: refinery },
  { signatureWords: ["be", "refinery", "ob", "text", "to", "name", "text", "under", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "ob", "text", "to", "name", "text", "beneath", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "ob", "text", "to", "name", "text", "beneath", "name", "map"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "text", "ob", "text", "to", "name", "text", "under", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "text", "ob", "text", "to", "name", "text", "beneath", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "name", "text", "ob", "text", "to", "name", "text", "beneath", "name", "map"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "text", "ob", "text", "to", "name", "text", "under", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "text", "ob", "text", "to", "name", "text", "beneath", "name", "text"], handler: refinery },
  { signatureWords: ["be", "refinery", "from", "text", "ob", "text", "to", "name", "text", "beneath", "name", "map"], handler: refinery }
];

export default refinery;
