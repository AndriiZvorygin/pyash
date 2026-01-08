import fs from "fs";
import { throwErrorSentence } from "../../error.mjs";
import { recordArtifact, recordExchange } from "../../bridge/exchange.mjs";
import { doRemember, remember, allRemember } from "../../remember/index.mjs";
import { jsonToMapSentences } from "./json_map.mjs";
import { parseYamlToJsonValue, canonicalizeJsonValue } from "./yaml.mjs";

function collectExistingNames() {
  const used = new Set();
  for (const entry of allRemember()) {
    if (entry?.su?.name) used.add(entry.su.name);
  }
  return used;
}

export async function read_fromstate_yaml(sentence) {
  const source = "read yaml";
  const sourceFilename = sentence?.from?.filename ?? sentence?.ob?.filename;
  let sourceText = sentence?.ob?.text ?? sentence?.from?.text;
  let sourceBuffer = null;

  if (sourceFilename) {
    try {
      sourceBuffer = await fs.promises.readFile(sourceFilename);
      sourceText = sourceBuffer.toString("utf8");
    } catch (err) {
      throwErrorSentence({
        name: "yaml lost",
        message: "yaml lost",
        from: { name: source },
        raw: { filename: sourceFilename, error: err?.message }
      });
    }
  }

  if (typeof sourceText !== "string") {
    throwErrorSentence({
      name: "yaml defective",
      message: "yaml defective",
      from: { name: source },
      raw: { filename: sourceFilename }
    });
  }

  if (sourceFilename && sourceBuffer) {
    const artifact = recordArtifact({ locator: sourceFilename, producer: "exchange", bytes: sourceBuffer });
    if (artifact?.su?.name) {
      recordExchange({ artifactName: artifact.su.name, op: "read", producer: "exchange" });
    }
  }

  const targetName = sentence?.to?.name ?? sentence?.su?.name;
  let parsed;
  try {
    parsed = parseYamlToJsonValue(sourceText, { source });
  } catch (err) {
    throw err;
  }
  parsed = canonicalizeJsonValue(parsed);

  const existingNames = collectExistingNames();
  let sentences;
  try {
    ({ sentences } = jsonToMapSentences(parsed, targetName, { existingNames }));
  } catch (err) {
    throwErrorSentence({
      name: "yaml defective",
      message: err?.message ?? "yaml defective",
      from: { name: source },
      raw: { error: err?.message }
    });
  }
  for (const mapSentence of sentences) {
    doRemember(mapSentence);
  }
  const fact = targetName ? remember(targetName) : null;
  if (fact?.ob) return { ob: fact.ob, be: fact.be };
  return { be: "json map" };
}
