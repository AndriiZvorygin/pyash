import fs from "node:fs/promises";
import path from "node:path";

import { remember, doRemember } from "../remember/index.mjs";
import { resolveConfigText } from "../configure/env.mjs";
import { buildErrorSentence, surfaceErrorSentence, throwErrorSentence } from "../error.mjs";
import { extractReport } from "../report/extract.mjs";
import { getRunNewspaperLines } from "../bridge/newspaper.mjs";

function resolveRunId(sentence) {
  if (typeof sentence?.ob?.text === "string") return sentence.ob.text;
  if (typeof sentence?.ob?.name === "string") return sentence.ob.name;
  const configured = resolveConfigText("run id", { rememberFn: remember });
  if (typeof configured === "string" && configured) return configured;
  const fact = remember("run id");
  if (typeof fact?.ob?.text === "string") return fact.ob.text;
  return "run";
}

function resolveRunRoot() {
  const fact = remember("run root");
  if (fact?.ob?.filename) return fact.ob.filename;
  return process.cwd();
}

async function reporter(sentence) {
  const runId = resolveRunId(sentence);
  const runRoot = resolveRunRoot();
  const lines = getRunNewspaperLines();
  let output = "";

  try {
    output = await extractReport({ runId, runRoot, lines });
  } catch (err) {
    const errSentence = surfaceErrorSentence(buildErrorSentence({
      name: "reporter lost",
      message: err?.message ?? "reporter lost",
      from: { name: "reporter" }
    }));
    throwErrorSentence(errSentence);
  }

  if (sentence?.to?.filename) {
    const target = path.resolve(sentence.to.filename);
    await fs.writeFile(target, output, "utf8");
  }
  if (sentence?.to?.name) {
    doRemember({ mood: "ya", su: { name: sentence.to.name }, be: "text", ob: { text: output } });
  }
  return { ob: { text: output }, be: "reporter" };
}

export const signatures = [
  { signatureWords: ["be", "reporter"], handler: reporter },
  { signatureWords: ["be", "reporter", "to", "name", "text"], handler: reporter },
  { signatureWords: ["be", "reporter", "to", "filename"], handler: reporter },
  { signatureWords: ["be", "reporter", "ob", "text"], handler: reporter },
  { signatureWords: ["be", "reporter", "ob", "text", "to", "name", "text"], handler: reporter },
  { signatureWords: ["be", "reporter", "ob", "text", "to", "filename"], handler: reporter },
  { signatureWords: ["be", "reporter", "ob", "name", "text", "to", "name", "text"], handler: reporter },
  { signatureWords: ["be", "reporter", "ob", "name", "text", "to", "filename"], handler: reporter }
];

export default reporter;
