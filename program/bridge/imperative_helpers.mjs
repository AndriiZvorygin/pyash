import { throwErrorSentence } from "../error.mjs";

function looksObjectMarker(value) {
  return String(value ?? "").trim() === "[object Object]";
}

export function resolveInlineGenitive(genitive, state) {
  const chainArr = Array.isArray(genitive?.chain) ? genitive.chain : [];
  if (chainArr.length === 0) return undefined;
  const [root, ...rest] = chainArr;
  if (root !== "this") return undefined;
  const ev = state.currentEvokeRef || state.currentEvoke;
  if (!ev) return undefined;
  let curr = ev;
  for (const part of rest) {
    if (curr == null) return undefined;
    if (typeof curr === "number") {
      if (part === "num") return curr;
      return undefined;
    }
    curr = curr[part];
  }
  if (typeof curr === "number") return curr;
  if (typeof curr?.num === "number") return curr.num;
  return undefined;
}

export function inferDownloadScheme(url) {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("magnet:")) return "magnet";
  if (lower.startsWith("ipfs://") || lower.startsWith("ipfs:")) return "ipfs";
  if (lower.startsWith("https://")) return "https";
  if (lower.startsWith("http://")) return "http";
  return null;
}

export function normalizeDownloadSentence(sentence) {
  if (!sentence || sentence.be !== "download") return;
  if (sentence.fromstate?.name) return;
  const url = sentence.from?.filename ?? sentence.from?.text;
  if (!url) return;
  const scheme = inferDownloadScheme(url);
  if (scheme) {
    sentence.fromstate = { name: scheme };
    return;
  }
  throwErrorSentence({
    name: "download defective",
    message: "download defective: missing fromstate",
    from: { name: "download" },
    raw: { sentence }
  });
}

export function shouldBootstrapNumberForVerb({ be, sentence, addressedName }) {
  const hasTextIntent = (() => {
    const slotHasTextIntent = (slot) => {
      if (!slot || typeof slot !== "object") return false;
      if (slot.text !== undefined) return true;
      const typeWords = Array.isArray(slot.nameTypeWords)
        ? slot.nameTypeWords.map((word) => String(word).toLowerCase())
        : [];
      if (typeWords.includes("text")) return true;
      const genitiveChain = Array.isArray(slot.genitive?.chain)
        ? slot.genitive.chain
        : [];
      const tail = String(genitiveChain.at(-1) ?? "").toLowerCase();
      return tail === "text";
    };
    return slotHasTextIntent(sentence?.ob) ||
      slotHasTextIntent(sentence?.from) ||
      slotHasTextIntent(sentence?.to);
  })();
  const durationFields = ["second", "minute", "hour", "day", "week", "month"];
  const hasDuration =
    sentence?.ob &&
    durationFields.some((field) => sentence.ob?.[field] !== undefined);
  const normalizedBe = String(be || "").replace(/\s+/g, "").toLowerCase();
  if (normalizedBe === "plus" && hasTextIntent) return false;
  return Boolean(
    addressedName &&
    !hasDuration &&
    ["plus", "subtract", "multiply", "divide", "invert", "exponential", "produce", "chip", "twicecrescent", "remains"].includes(normalizedBe)
  );
}

export function applyResolvedTypedValue(value, tail, resolved) {
  if (!value || typeof value !== "object") return false;
  if (resolved === null || resolved === undefined) return false;
  switch (tail) {
    case "text":
      if (looksObjectMarker(resolved)) {
        throwErrorSentence({
          name: "typed genitive defective",
          message: "typed genitive defective: resolved to [object Object]",
          from: { name: "interpret" },
          raw: { tail, resolved }
        });
      }
      value.text = String(resolved);
      return true;
    case "filename":
      if (looksObjectMarker(resolved)) {
        throwErrorSentence({
          name: "typed genitive defective",
          message: "typed genitive defective: resolved filename to [object Object]",
          from: { name: "interpret" },
          raw: { tail, resolved }
        });
      }
      value.filename = String(resolved);
      return true;
    case "bool":
    case "boolean": {
      if (typeof resolved === "boolean") {
        value.boolean = resolved;
        return true;
      }
      const normalized = String(resolved).toLowerCase();
      if (normalized === "truth" || normalized === "true" || normalized === "1") {
        value.boolean = true;
        return true;
      }
      if (normalized === "lie" || normalized === "false" || normalized === "0") {
        value.boolean = false;
        return true;
      }
      return false;
    }
    case "date":
      value.date = String(resolved);
      return true;
    case "month":
    case "months":
    case "second":
    case "seconds":
    case "minute":
    case "minutes":
    case "hour":
    case "hours":
    case "day":
    case "days":
    case "week":
    case "weeks":
    case "line":
    case "lines":
    case "byte":
    case "bytes":
    case "num":
    case "number": {
      const num = typeof resolved === "number" ? resolved : Number(resolved);
      if (!Number.isFinite(num)) return false;
      value.num = num;
      return true;
    }
    default:
      return false;
  }
}
