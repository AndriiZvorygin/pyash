import { buildProgram } from "../../program.mjs";
import { remember, doRemember } from "../../remember/index.mjs";

function sentenceToEnglish(sentence) {
  const subj = sentence.subj?.name;
  const obj = sentence.obj ?? {};
  const mood = sentence.mood;
  const beWords = (sentence.be || "").split(" ").filter(Boolean);
  const beLabel = beWords.length ? beWords.join(" ") : "something";
  if (!subj || mood !== "ya") return JSON.stringify(sentence);

  if (obj.num !== undefined) {
    return `${subj} is ${beLabel} ${obj.num}.`;
  }

  if (obj.text !== undefined) {
    return `${subj} is ${beLabel} "${obj.text}".`;
  }

  return `${subj} is ${beLabel}.`;
}

export async function translation_from_text_to_name_text(sentence) {
  const sourceName = sentence?.obj?.name ?? sentence?.from?.name;
  const sourceText =
    sentence?.from?.text ??
    sentence?.obj?.text ??
    (sourceName ? remember(sourceName)?.obj?.text : null);

  if (typeof sourceText !== "string") {
    throw new Error("translation: source text is required");
  }

  const program = buildProgram(sourceText.replaceAll("\\n", "\n"));
  const lines = program.sentences.map(sentenceToEnglish);
  const translation = lines.join("\n");

  const targetName = sentence?.to?.name ?? sentence?.subj?.name;
  if (targetName) {
    doRemember({
      subj: { name: targetName },
      be: sentence?.become?.name ?? "english",
      obj: { text: translation },
      mood: "ya"
    });
  }

  return { obj: { text: translation }, be: sentence?.become?.name ?? "english" };
}

export default translation_from_text_to_name_text;

export const signatures = [
  {
    signatureWords: ["be", "translation", "become", "name", "num", "from", "text", "fromstate", "name", "num", "to", "name", "num"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "from", "text", "to", "name", "num"],
    handler: translation_from_text_to_name_text
  }
];
