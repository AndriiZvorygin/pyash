import { digestDocument, digestFilename } from "../library/document_digestion.mjs";
import { remember as defaultRemember } from "../remember/index.mjs";

function requestedFormat(sentence) {
  return sentence?.as?.wo
    ?? sentence?.fromstate?.wo
    ?? sentence?.become?.wo
    ?? undefined;
}

function resolveTextSource(sentence, rememberFn) {
  if (typeof sentence?.from?.text === "string") return sentence.from.text;
  const name = sentence?.from?.name;
  if (typeof name === "string") {
    const fact = rememberFn(name);
    if (typeof fact?.ob?.text === "string") return fact.ob.text;
  }
  return null;
}

export async function documentDigestion(sentence = {}, { remember: rememberFn = defaultRemember } = {}) {
  const format = requestedFormat(sentence);
  const sourceText = resolveTextSource(sentence, rememberFn);
  const result = sentence?.from?.filename
    ? await digestFilename(sentence.from.filename, { format })
    : digestDocument({ text: sourceText, format });
  const series = result.series ?? {
    mood: "ya",
    su: { name: "document digestion" },
    be: "series",
    ob: { series: result.records }
  };
  const targetName = sentence?.to?.name ?? sentence?.su?.name ?? series.su.name;
  return {
    ...series,
    su: { name: targetName },
    ob: { series: result.records }
  };
}

export default documentDigestion;

export const signatures = [
  { signatureWords: ["be", "digestion", "from", "filename"], handler: documentDigestion },
  { signatureWords: ["be", "digestion", "from", "filename", "to", "name", "series"], handler: documentDigestion },
  { signatureWords: ["be", "digestion", "from", "name", "text"], handler: documentDigestion },
  { signatureWords: ["be", "digestion", "from", "name", "text", "to", "name", "series"], handler: documentDigestion },
  { signatureWords: ["be", "digestion", "from", "text"], handler: documentDigestion },
  { signatureWords: ["be", "digestion", "from", "text", "to", "name", "series"], handler: documentDigestion },
  { signatureWords: ["be", "digestion", "as", "wo", "csv", "from", "filename", "to", "name", "series"], handler: documentDigestion },
  { signatureWords: ["be", "digestion", "as", "wo", "csv", "from", "text", "to", "name", "series"], handler: documentDigestion },
  { signatureWords: ["be", "digestion", "as", "wo", "markdown", "from", "filename", "to", "name", "series"], handler: documentDigestion },
  { signatureWords: ["be", "digestion", "as", "wo", "markdown", "from", "text", "to", "name", "series"], handler: documentDigestion },
  { signatureWords: ["be", "digestion", "from", "filename", "fromstate", "wo", "csv", "to", "name", "series"], handler: documentDigestion },
  { signatureWords: ["be", "digestion", "from", "text", "fromstate", "wo", "csv", "to", "name", "series"], handler: documentDigestion },
  { signatureWords: ["be", "digestion", "from", "filename", "fromstate", "wo", "markdown", "to", "name", "series"], handler: documentDigestion },
  { signatureWords: ["be", "digestion", "from", "text", "fromstate", "wo", "markdown", "to", "name", "series"], handler: documentDigestion }
];
