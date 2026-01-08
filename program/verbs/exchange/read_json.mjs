import { remember } from "../../remember/index.mjs";
import importFromSentence from "./import.mjs";

export async function read_fromstate_json(sentence, { remember: rememberFn } = {}) {
  const targetName = sentence?.to?.name ?? sentence?.su?.name;
  await importFromSentence({ ...sentence, to: { name: targetName } });
  const fact = (rememberFn || remember)(targetName);
  if (fact?.ob) return { ob: fact.ob, be: fact.be };
  return { be: "json map" };
}
