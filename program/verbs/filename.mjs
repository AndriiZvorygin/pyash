import { remember } from "../remember/index.mjs";
import { renderSayValue } from "./say.mjs";

function resolveFilenameValue(ob = {}, { rememberFn } = {}) {
  if (typeof ob.filename === "string") return ob.filename;
  if (typeof ob.text === "string") return ob.text;
  if (ob.name && rememberFn) {
    const fact = rememberFn(ob.name);
    if (typeof fact?.ob?.filename === "string") return fact.ob.filename;
    if (typeof fact?.ob?.text === "string") return fact.ob.text;
  }
  if (ob.genitive) {
    const v = renderSayValue({ genitive: ob.genitive }, { rememberFn });
    if (v !== undefined) return String(v);
  }
  const fallback = renderSayValue(ob, { rememberFn });
  return fallback !== undefined ? String(fallback) : "";
}

export async function filename(sentence, { remember: rememberFn = remember } = {}) {
  const value = resolveFilenameValue(sentence.ob ?? {}, { rememberFn });
  return { ob: { filename: value }, be: "filename" };
}

export default filename;

export const signatures = [
  { signatureWords: ["be", "filename", "ob", "text"], handler: filename },
  { signatureWords: ["be", "filename", "ob", "filename"], handler: filename },
  { signatureWords: ["be", "filename", "ob", "name", "text"], handler: filename },
  { signatureWords: ["be", "filename", "ob", "name", "filename"], handler: filename },
  { signatureWords: ["be", "filename", "ob", "text", "to", "name", "filename"], handler: filename },
  { signatureWords: ["be", "filename", "ob", "filename", "to", "name", "filename"], handler: filename },
  { signatureWords: ["be", "filename", "ob", "name", "text", "to", "name", "filename"], handler: filename },
  { signatureWords: ["be", "filename", "ob", "name", "filename", "to", "name", "filename"], handler: filename },
  { signatureWords: ["be", "filename", "ob", "filename", "to", "name", "itinerary"], handler: filename },
  { signatureWords: ["be", "filename", "ob", "text", "to", "name", "itinerary"], handler: filename },
  { signatureWords: ["be", "filename", "ob", "name", "filename", "to", "name", "itinerary"], handler: filename },
  { signatureWords: ["be", "filename", "ob", "name", "text", "to", "name", "itinerary"], handler: filename }
];
