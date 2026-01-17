import { joinSignatureWords } from "./normalize.mjs";

// Registry for signature -> ceremony name lookups
const signatureRegistry = new Map(); // key -> def name
const nameToKeys = new Map(); // def name -> Set<key>
const signatureSources = new Map(); // key -> source

// Registry for signature -> handler (built-in verbs)
const signatureHandlers = new Map(); // key -> fn

export function registerSignature({ name, signatureWords, source }) {
  if (!name || !signatureWords?.length) return;
  const key = joinSignatureWords(signatureWords);
  const existing = signatureRegistry.get(key);
  const existingSource = signatureSources.get(key);
  if (existing && existing !== name) {
    const fromSource = existingSource ? ` from ${existingSource}` : "";
    const toSource = source ? ` from ${source}` : "";
    console.warn(`signature conflict: ${key} already mapped to ${existing}${fromSource} (replacing with ${name}${toSource})`);
  }
  signatureRegistry.set(key, name);
  if (source) signatureSources.set(key, source);
  const keys = nameToKeys.get(name) ?? new Set();
  keys.add(key);
  nameToKeys.set(name, keys);
}

export function registerSignatureAlias({ name, signatureWords, source }) {
  if (!name || !signatureWords?.length) return;
  const key = joinSignatureWords(signatureWords);
  const existing = signatureRegistry.get(key);
  const existingSource = signatureSources.get(key);
  if (existing && existing !== name) {
    const fromSource = existingSource ? ` from ${existingSource}` : "";
    const toSource = source ? ` from ${source}` : "";
    console.warn(`signature conflict: ${key} already mapped to ${existing}${fromSource} (replacing with ${name}${toSource})`);
  }
  signatureRegistry.set(key, name);
  if (source) signatureSources.set(key, source);
  const keys = nameToKeys.get(name) ?? new Set();
  keys.add(key);
  nameToKeys.set(name, keys);
}

export function registerSignatureHandler({ signatureWords, handler }) {
  if (!signatureWords?.length || typeof handler !== "function") return;
  const key = joinSignatureWords(signatureWords);
  signatureHandlers.set(key, handler);
}

export function clearSignatureHandlers() {
  signatureHandlers.clear();
}

export function lookupSignature(key) {
  return signatureRegistry.get(key);
}

export function lookupSignatureHandler(key) {
  return signatureHandlers.get(key);
}

export function clearSignatureDefinitions() {
  signatureRegistry.clear();
  nameToKeys.clear();
  signatureSources.clear();
}
