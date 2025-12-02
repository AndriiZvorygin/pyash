import { buildProgram } from "../../program.mjs";
import { remember, doRemember } from "../../remember/index.mjs";

export async function compile_from_name_text_to_name_text({ obj, sentence }) {
  const sourceName = sentence?.obj?.name ?? obj?.name;
  if (!sourceName) throw new Error("compile: obj.name is required");

  const src = remember(sourceName);
  const sourceText = src?.obj?.text ?? src?.text;
  if (typeof sourceText !== "string") {
    throw new Error(`compile: source text not found for "${sourceName}"`);
  }

  const program = buildProgram(sourceText);
  const json = JSON.stringify(program.sentences, null, 2);

  // Decide where to store result: target name (to.name) if provided, else subject name
  const targetName = sentence?.to?.name ?? sentence?.subj?.name;
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

export default compile_from_name_text_to_name_text;

export const signatures = [
  {
    signatureWords: ["be", "compile", "from", "name", "text", "to", "name", "text"],
    handler: compile_from_name_text_to_name_text
  }
];
