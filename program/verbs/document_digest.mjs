import { digestDocument, digestFilename } from "../library/document_digestion.mjs";
import { remember as defaultRemember } from "../remember/index.mjs";

function requestedFormat(sentence) {
  return sentence?.as?.name
    ?? sentence?.become?.wo
    ?? sentence?.become?.name
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
  const targetName = sentence?.to?.name ?? sentence?.su?.name ?? result.series.su.name;
  return {
    ...result.series,
    su: { name: targetName },
    ob: { series: result.records }
  };
}

export default documentDigestion;

export const signatures = [
  { signatureWords: ["be", "digestion", "from", "filename"], handler: documentDigestion },
  { signatureWords: ["be", "digestion", "from", "filename", "to", "name"], handler: documentDigestion },
  { signatureWords: ["be", "digestion", "from", "filename", "to", "name", "num"], handler: documentDigestion },
  { signatureWords: ["be", "digestion", "from", "filename", "to", "text"], handler: documentDigestion },
  { signatureWords: ["be", "digestion", "from", "name", "text"], handler: documentDigestion },
  { signatureWords: ["be", "digestion", "from", "name", "text", "to", "name", "num"], handler: documentDigestion },
  { signatureWords: ["be", "digestion", "from", "text"], handler: documentDigestion },
  { signatureWords: ["be", "digestion", "from", "text", "to", "name"], handler: documentDigestion },
  { signatureWords: ["be", "digestion", "from", "text", "to", "name", "num"], handler: documentDigestion },
  { signatureWords: ["be", "digestion", "from", "text", "to", "text"], handler: documentDigestion },
  { signatureWords: ["be", "digestion", "as", "name", "num", "from", "filename", "to", "name", "num"], handler: documentDigestion },
  { signatureWords: ["be", "digestion", "as", "name", "num", "from", "text", "to", "name", "num"], handler: documentDigestion }
];
