import fs from "node:fs/promises";
import { buildProgram } from "../../program.mjs";
import { remember, doRemember } from "../../remember/index.mjs";

export async function understand_from_name_text_to_name_text(sentence) {
  const { ob, from } = sentence ?? {};
  const sourceName = sentence?.ob?.name ?? ob?.name;
  const sourceFilename = sentence?.from?.filename ?? from?.filename ?? sentence?.ob?.filename ?? ob?.filename;

  let sourceText = null;

  if (sourceFilename) {
    sourceText = await fs.readFile(sourceFilename, "utf8");
  } else if (sourceName) {
    const src = remember(sourceName);
    sourceText = src?.ob?.text ?? src?.text;
  }

  if (typeof sourceText !== "string") {
    throw new Error(`understand: source text not found for \"${sourceName ?? sourceFilename ?? "unknown"}\"`);
  }

  // Allow escaped newlines in inline text blocks
  sourceText = sourceText.replaceAll("\\n", "\n");

  const program = buildProgram(sourceText);
  const json = JSON.stringify(program.sentences, null, 2);

  const targetName = sentence?.to?.name ?? sentence?.su?.name;
  const targetFilename = sentence?.to?.filename;

  if (targetFilename) {
    await fs.writeFile(targetFilename, json, "utf8");
  }

  if (targetName) {
    const fact = {
      su: { name: targetName },
      be: sentence?.to?.context === "state" ? sentence.to.context : "text",
      ob: { text: json, sentences: program.sentences },
      mood: "ya",
    };
    doRemember(fact);
  }

  return { ob: { text: json, sentences: program.sentences } };
}

export default understand_from_name_text_to_name_text;

export const signatures = [
  {
    signatureWords: ["be", "understand", "become", "name", "text", "fromstate", "name", "text", "ob", "name", "text", "to", "name", "text"],
    handler: understand_from_name_text_to_name_text
  },
  {
    signatureWords: ["be", "understand", "become", "name", "num", "fromstate", "name", "num", "ob", "name", "text", "to", "name", "num"],
    handler: understand_from_name_text_to_name_text
  },
  {
    signatureWords: ["be", "understand", "ob", "name", "to", "name"],
    handler: understand_from_name_text_to_name_text
  },
  {
    signatureWords: ["be", "understand", "become", "name", "num", "fromstate", "name", "num", "ob", "name", "num", "to", "filename"],
    handler: understand_from_name_text_to_name_text
  },
  {
    signatureWords: ["be", "understand", "ob", "name", "to", "filename"],
    handler: understand_from_name_text_to_name_text
  },
  {
    signatureWords: ["be", "understand", "fromstate", "name", "num", "ob", "name", "num", "to", "filename"],
    handler: understand_from_name_text_to_name_text
  },
  {
    signatureWords: ["be", "understand", "become", "name", "num", "fromstate", "name", "num", "ob", "name", "text", "to", "filename"],
    handler: understand_from_name_text_to_name_text
  },
  {
    signatureWords: ["be", "understand", "fromstate", "name", "num", "ob", "name", "text", "to", "filename"],
    handler: understand_from_name_text_to_name_text
  },
  {
    signatureWords: ["be", "understand", "from", "filename", "to", "filename"],
    handler: understand_from_name_text_to_name_text
  },
  {
    signatureWords: ["be", "understand", "ob", "filename", "to", "filename"],
    handler: understand_from_name_text_to_name_text
  }
];
