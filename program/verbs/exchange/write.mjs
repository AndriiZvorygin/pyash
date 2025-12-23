import fs from "node:fs/promises";
import { remember } from "../../remember/index.mjs";
import { throwErrorSentence } from "../../error.mjs";
import { renderSayValue } from "../say.mjs";

export default async function write(sentence, { remember: rememberFn = remember } = {}) {
  const target = sentence?.to?.filename;
  const format = (sentence?.become?.name || sentence?.become?.text || "").toLowerCase();
  const text = renderSayValue(sentence.obj ?? {}, { rememberFn, format: format === "json" ? "json" : "pyash" });
  if (target) {
    await fs.writeFile(target, String(text ?? ""), "utf8");
  } else {
    // eslint-disable-next-line no-console
    console.log(text);
  }
  return { obj: { text }, be: "write" };
}

export const signatures = [
  { signatureWords: ["be", "write", "obj", "text"], handler: write },
  { signatureWords: ["be", "write", "obj", "num"], handler: write },
  { signatureWords: ["be", "write", "obj", "bool"], handler: write },
  { signatureWords: ["be", "write", "obj", "hollow"], handler: write },
  { signatureWords: ["be", "write", "obj", "name", "text"], handler: write },
  { signatureWords: ["be", "write", "obj", "name", "num"], handler: write },
  { signatureWords: ["be", "write", "obj", "name", "bool"], handler: write },
  { signatureWords: ["be", "write", "obj", "name", "hollow"], handler: write },
  { signatureWords: ["be", "write", "obj", "name", "vec"], handler: write },
  { signatureWords: ["be", "write", "obj", "name", "vec", "num"], handler: write },
  { signatureWords: ["be", "write", "obj", "name", "vec", "text"], handler: write },
  { signatureWords: ["be", "write", "obj", "name", "vec", "bool"], handler: write },
  { signatureWords: ["be", "write", "obj", "vec"], handler: write },
  { signatureWords: ["be", "write", "obj", "vec", "num"], handler: write },
  { signatureWords: ["be", "write", "obj", "vec", "text"], handler: write },
  { signatureWords: ["be", "write", "obj", "vec", "bool"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "obj", "text"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "obj", "num"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "obj", "bool"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "obj", "hollow"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "obj", "name", "text"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "obj", "name", "num"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "obj", "name", "bool"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "obj", "name", "hollow"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "obj", "name", "vec"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "obj", "name", "vec", "num"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "obj", "name", "vec", "text"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "obj", "name", "vec", "bool"], handler: write },
  { signatureWords: ["be", "write", "obj", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "obj", "num", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "obj", "bool", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "obj", "hollow", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "obj", "name", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "obj", "name", "num", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "obj", "name", "bool", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "obj", "name", "hollow", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "obj", "name", "vec", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "obj", "name", "vec", "num", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "obj", "name", "vec", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "obj", "name", "vec", "bool", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "obj", "vec", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "obj", "vec", "num", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "obj", "vec", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "obj", "vec", "bool", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "obj", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "obj", "num", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "obj", "bool", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "obj", "hollow", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "obj", "name", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "obj", "name", "num", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "obj", "name", "bool", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "obj", "name", "hollow", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "obj", "name", "vec", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "obj", "name", "vec", "num", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "obj", "name", "vec", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "obj", "name", "vec", "bool", "to", "filename"], handler: write }
];
