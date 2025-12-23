import fs from "node:fs/promises";
import { remember } from "../../remember/index.mjs";
import { throwErrorSentence } from "../../error.mjs";
import { renderSayValue } from "../say.mjs";

export default async function write(sentence, { remember: rememberFn = remember } = {}) {
  const target = sentence?.to?.filename;
  const format = (sentence?.become?.name || sentence?.become?.text || "").toLowerCase();
  const text = renderSayValue(sentence.ob ?? {}, { rememberFn, format: format === "json" ? "json" : "pyash" });
  if (target) {
    await fs.writeFile(target, String(text ?? ""), "utf8");
  } else {
    // eslint-disable-next-line no-console
    console.log(text);
  }
  return { ob: { text }, be: "write" };
}

export const signatures = [
  { signatureWords: ["be", "write", "ob", "text"], handler: write },
  { signatureWords: ["be", "write", "ob", "num"], handler: write },
  { signatureWords: ["be", "write", "ob", "bool"], handler: write },
  { signatureWords: ["be", "write", "ob", "hollow"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "text"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "num"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "bool"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "hollow"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "vec"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "vec", "num"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "vec", "text"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "vec", "bool"], handler: write },
  { signatureWords: ["be", "write", "ob", "vec"], handler: write },
  { signatureWords: ["be", "write", "ob", "vec", "num"], handler: write },
  { signatureWords: ["be", "write", "ob", "vec", "text"], handler: write },
  { signatureWords: ["be", "write", "ob", "vec", "bool"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "text"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "num"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "bool"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "hollow"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "text"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "num"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "bool"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "hollow"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "vec"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "vec", "num"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "vec", "text"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "vec", "bool"], handler: write },
  { signatureWords: ["be", "write", "ob", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "num", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "bool", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "hollow", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "num", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "bool", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "hollow", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "vec", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "vec", "num", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "vec", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "name", "vec", "bool", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "vec", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "vec", "num", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "vec", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "ob", "vec", "bool", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "num", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "bool", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "hollow", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "num", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "bool", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "hollow", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "vec", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "vec", "num", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "vec", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "ob", "name", "vec", "bool", "to", "filename"], handler: write }
];
