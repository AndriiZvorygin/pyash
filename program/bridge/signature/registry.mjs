import { joinSignatureWords } from "./normalize.mjs";

// Registry for signature -> ceremony name lookups
const signatureRegistry = new Map(); // key -> def name
const nameToKeys = new Map(); // def name -> Set<key>

// Registry for signature -> handler (built-in verbs)
const signatureHandlers = new Map(); // key -> fn

export function registerSignature({ name, signatureWords }) {
  if (!name || !signatureWords?.length) return;
  const key = joinSignatureWords(signatureWords);
  const existing = signatureRegistry.get(key);
  if (existing && existing !== name) {
    throw new Error(`signature conflict: ${key} already mapped to ${existing} (tried ${name})`);
  }
  signatureRegistry.set(key, name);
  const keys = nameToKeys.get(name) ?? new Set();
  keys.add(key);
  nameToKeys.set(name, keys);
}

export function registerSignatureAlias({ name, signatureWords }) {
  if (!name || !signatureWords?.length) return;
  const key = joinSignatureWords(signatureWords);
  const existing = signatureRegistry.get(key);
  if (existing && existing !== name) {
    throw new Error(`signature conflict: ${key} already mapped to ${existing} (tried ${name})`);
  }
  signatureRegistry.set(key, name);
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
}
