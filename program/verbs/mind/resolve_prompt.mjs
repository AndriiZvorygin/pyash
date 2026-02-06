import { remember } from "../../remember/index.mjs";

export function resolvePromptFromName(name, { rememberFn = remember } = {}) {
  if (!name) return null;
  const fact = rememberFn(name);
  if (!fact?.ob) return null;
  if (fact.ob.text !== undefined) return String(fact.ob.text);
  if (fact.ob.num !== undefined) return String(fact.ob.num);
  if (fact.ob.boolean !== undefined) return fact.ob.boolean ? "truth" : "lie";
  if (fact.ob.hollow) return "null";
  if (fact.ob.genitive?.chain?.length) {
    let curr =
      typeof fact.ob.genitive.chain[0] === "string"
        ? rememberFn(fact.ob.genitive.chain[0])
        : null;
    for (const part of fact.ob.genitive.chain.slice(1)) {
      if (curr && typeof curr === "object" && curr.name) {
        const nextFact = rememberFn(curr.name);
        if (nextFact) curr = nextFact.ob ?? nextFact;
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
  }
  return null;
}

export function resolveGenitiveText(genitive, { rememberFn = remember } = {}) {
  const chain = Array.isArray(genitive?.chain) ? genitive.chain : [];
  if (chain.length === 0) return null;
  let curr = typeof chain[0] === "string" ? rememberFn(chain[0]) : null;
  for (const part of chain.slice(1)) {
    if (curr && typeof curr === "object" && curr.name) {
      const nextFact = rememberFn(curr.name);
      if (nextFact) curr = nextFact.ob ?? nextFact;
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
  return null;
}

export function resolvePromptValue(value, { rememberFn = remember } = {}) {
  if (!value) return null;
  if (typeof value?.text === "string") return value.text;
  if (value?.name) return resolvePromptFromName(value.name, { rememberFn }) ?? value.name;
  return null;
}

export function resolveMindPrompt({ sentence, ob, configSentence, rememberFn = remember } = {}) {
  const configPromptValue = configSentence?.fromtext ?? null;
  const callPromptValue = sentence?.fromtext ?? null;
  const isSessionOverride = (value) => {
    if (!value) return false;
    if (value?.filename) return true;
    const raw = typeof value === "string"
      ? value
      : (value?.name ?? value?.text ?? "");
    if (!raw) return false;
    return String(raw).trim().toLowerCase().startsWith("session name ");
  };
  const obNamePrompt = sentence?.ob?.name && !sentence?.ob?.model
    ? (resolvePromptFromName(sentence.ob.name, { rememberFn }) ?? sentence.ob.name)
    : null;
  const inlineObNamePrompt = ob?.name && !ob?.model
    ? (resolvePromptFromName(ob.name, { rememberFn }) ?? ob.name)
    : null;
  const callPrompt =
    sentence?.with?.text ??
    sentence?.ob?.text ??
    obNamePrompt ??
    ob?.text ??
    inlineObNamePrompt;
  const resolvedConfigPrompt = (isSessionOverride(callPromptValue) ? null : resolvePromptValue(callPromptValue, { rememberFn }))
    ?? (isSessionOverride(configPromptValue) ? null : resolvePromptValue(configPromptValue, { rememberFn }));
  return { callPrompt, resolvedConfigPrompt };
}
