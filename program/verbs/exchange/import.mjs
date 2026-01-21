import fs from "node:fs/promises";
import { remember, doRemember, allRemember } from "../../remember/index.mjs";
import { throwErrorSentence } from "../../error.mjs";
import { jsonToMapSentences } from "./json_map.mjs";
import { recordArtifact, recordExchange } from "../../bridge/exchange.mjs";
import { renderSayValue } from "../say.mjs";

function collectExistingNames() {
  const used = new Set();
  for (const entry of allRemember()) {
    if (entry?.su?.name) used.add(entry.su.name);
  }
  return used;
}

function jsonScalarToSentence(value, name) {
  if (value === null) return { su: { name }, ob: { hollow: true }, be: "hollow", mood: "ya" };
  if (typeof value === "string") return { su: { name }, ob: { text: value }, be: "text", mood: "ya" };
  if (typeof value === "number") return { su: { name }, ob: { num: value }, be: "number", mood: "ya" };
  if (typeof value === "boolean") return { su: { name }, ob: { boolean: value }, be: "bool", mood: "ya" };
  return null;
}

function jsonArrayToSentence(values, name) {
  if (values.length === 0) {
    return { su: { name }, ob: { ve: { type: "hollow", values: [] } }, be: "vector", mood: "ya" };
  }
  const typeSet = new Set();
  for (const value of values) {
    if (value === null) typeSet.add("hollow");
    else if (Array.isArray(value)) typeSet.add("array");
    else if (typeof value === "object") typeSet.add("object");
    else if (typeof value === "boolean") typeSet.add("bool");
    else if (typeof value === "number") typeSet.add("num");
    else typeSet.add("text");
  }
  if (typeSet.has("array")) {
    throw new Error("json map contents defective: nested arrays are unsupported");
  }
  if (typeSet.has("object")) {
    throw new Error("json map contents defective: array of objects requires a json map target");
  }
  if (typeSet.has("hollow")) {
    throw new Error("json map contents defective: null elements are unsupported in arrays");
  }
  if (typeSet.size > 1) {
    throw new Error("json map contents defective: mixed array types are unsupported");
  }
  if (typeSet.has("bool")) {
    return { su: { name }, ob: { ve: { type: "bool", values: values.map(v => (v ? "truth" : "lie")) } }, be: "vector", mood: "ya" };
  }
  if (typeSet.has("num")) {
    return { su: { name }, ob: { ve: { type: "num", values } }, be: "vector", mood: "ya" };
  }
  return { su: { name }, ob: { ve: { type: "text", values } }, be: "vector", mood: "ya" };
}

async function importFromSentence(sentence) {
  const targetName = sentence?.to?.name ?? sentence?.su?.name;
  if (!targetName) {
    throwErrorSentence({
      name: "import error",
      message: "import: target name is required (to name <map>)",
      from: { name: "import" }
    });
  }

  let sourceText = sentence?.ob?.text ?? sentence?.from?.text;
  if (!sourceText && sentence?.ob) {
    const resolved = renderSayValue(sentence.ob, { rememberFn: remember });
    if (resolved !== undefined && resolved !== null) {
      sourceText = String(resolved);
    }
  }
  if (!sourceText && sentence?.from?.filename) {
    const buffer = await fs.readFile(sentence.from.filename);
    const artifact = recordArtifact({ locator: sentence.from.filename, producer: "exchange", bytes: buffer });
    if (artifact?.su?.name) {
      recordExchange({ artifactName: artifact.su.name, op: "read", producer: "exchange" });
    }
    sourceText = buffer.toString("utf8");
  }
  if (typeof sourceText !== "string") {
    throwErrorSentence({
      name: "import error",
      message: "import: source text is required (ob text or from filename)",
      from: { name: "import" }
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(sourceText);
  } catch (err) {
    throwErrorSentence({
      name: "import error",
      message: "import: invalid json",
      from: { name: "import" },
      raw: { error: err?.message }
    });
  }

  const existingNames = collectExistingNames();
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    let sentences;
    try {
      ({ sentences } = jsonToMapSentences(parsed, targetName, { existingNames }));
    } catch (err) {
      throwErrorSentence({
        name: "import error",
        message: err?.message ?? "import: json map build failed",
        from: { name: "import" },
        raw: { error: err?.message }
      });
    }
    for (const mapSentence of sentences) {
      doRemember(mapSentence);
    }
    return { be: "json map" };
  }

  if (Array.isArray(parsed)) {
    let vectorSentence;
    try {
      vectorSentence = jsonArrayToSentence(parsed, targetName);
    } catch (err) {
      throwErrorSentence({
        name: "import error",
        message: err?.message ?? "import: json array build failed",
        from: { name: "import" },
        raw: { error: err?.message }
      });
    }
    doRemember(vectorSentence);
    return { be: "vector" };
  }

  const scalarSentence = jsonScalarToSentence(parsed, targetName);
  if (!scalarSentence) {
    throwErrorSentence({
      name: "import error",
      message: "import: unsupported json root value",
      from: { name: "import" }
    });
  }
  doRemember(scalarSentence);
  return { be: scalarSentence.be };
}

export default importFromSentence;

export const signatures = [
  { signatureWords: ["be", "import", "ob", "text", "to", "name", "num"], handler: importFromSentence },
  { signatureWords: ["be", "import", "ob", "name", "text", "to", "name", "num"], handler: importFromSentence },
  { signatureWords: ["be", "import", "ob", "name", "text", "to", "name", "text"], handler: importFromSentence },
  { signatureWords: ["be", "import", "from", "filename", "to", "name", "num"], handler: importFromSentence },
  { signatureWords: ["be", "import", "from", "text", "to", "name", "num"], handler: importFromSentence }
];
