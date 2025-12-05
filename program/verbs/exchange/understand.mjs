import fs from "node:fs/promises";
import { buildProgram } from "../../program.mjs";
import { remember, doRemember } from "../../remember/index.mjs";

export async function understand_from_name_text_to_name_text(sentence) {
  const { obj, from } = sentence ?? {};
  const sourceName = sentence?.obj?.name ?? obj?.name;
  const sourceFilename = sentence?.from?.filename ?? from?.filename ?? sentence?.obj?.filename ?? obj?.filename;

  let sourceText = null;

  if (sourceFilename) {
    sourceText = await fs.readFile(sourceFilename, "utf8");
  } else if (sourceName) {
    const src = remember(sourceName);
    sourceText = src?.obj?.text ?? src?.text;
  }

  if (typeof sourceText !== "string") {
    throw new Error(`understand: source text not found for \"${sourceName ?? sourceFilename ?? "unknown"}\"`);
  }

  const program = buildProgram(sourceText);
  const json = JSON.stringify(program.sentences, null, 2);

  const targetName = sentence?.to?.name ?? sentence?.subj?.name;
  const targetFilename = sentence?.to?.filename;

  if (targetFilename) {
    await fs.writeFile(targetFilename, json, "utf8");
  }

  if (targetName) {
    const fact = {
      subj: { name: targetName },
      be: sentence?.to?.context === "state" ? sentence.to.context : "text",
      obj: { text: json, sentences: program.sentences },
      mood: "ya",
    };
    doRemember(fact);
  }

  return { obj: { text: json, sentences: program.sentences } };
}

export default understand_from_name_text_to_name_text;

export const signatures = [
  {
    signatureWords: ["be", "understand", "become", "name", "text", "fromstate", "name", "text", "obj", "name", "text", "to", "name", "text"],
    handler: understand_from_name_text_to_name_text
  },
  {
    signatureWords: ["be", "understand", "become", "name", "num", "fromstate", "name", "num", "obj", "name", "text", "to", "name", "num"],
    handler: understand_from_name_text_to_name_text
  },
  {
    signatureWords: ["be", "understand", "obj", "name", "to", "name"],
    handler: understand_from_name_text_to_name_text
  },
  {
    signatureWords: ["be", "understand", "become", "name", "num", "fromstate", "name", "num", "obj", "name", "num", "to", "filename"],
    handler: understand_from_name_text_to_name_text
  },
  {
    signatureWords: ["be", "understand", "obj", "name", "to", "filename"],
    handler: understand_from_name_text_to_name_text
  },
  {
    signatureWords: ["be", "understand", "fromstate", "name", "num", "obj", "name", "num", "to", "filename"],
    handler: understand_from_name_text_to_name_text
  },
  {
    signatureWords: ["be", "understand", "become", "name", "num", "fromstate", "name", "num", "obj", "name", "text", "to", "filename"],
    handler: understand_from_name_text_to_name_text
  },
  {
    signatureWords: ["be", "understand", "fromstate", "name", "num", "obj", "name", "text", "to", "filename"],
    handler: understand_from_name_text_to_name_text
  },
  {
    signatureWords: ["be", "understand", "from", "filename", "to", "filename"],
    handler: understand_from_name_text_to_name_text
  },
  {
    signatureWords: ["be", "understand", "obj", "filename", "to", "filename"],
    handler: understand_from_name_text_to_name_text
  }
];
