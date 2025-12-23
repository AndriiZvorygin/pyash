import fs from "node:fs/promises";
import { remember } from "../../remember/index.mjs";
import { throwErrorSentence } from "../../error.mjs";
import { renderSayValue } from "../say.mjs";

export default async function write(sentence, { remember: rememberFn = remember } = {}) {
  const target = sentence?.to?.filename;
  if (!target) {
    throwErrorSentence({
      name: "write error",
      message: "write: to filename is required",
      from: { name: "write" }
    });
  }
  const format = (sentence?.become?.name || sentence?.become?.text || "").toLowerCase();
  const text = renderSayValue(sentence.obj ?? {}, { rememberFn, format: format === "json" ? "json" : "pyash" });
  await fs.writeFile(target, String(text ?? ""), "utf8");
  return { obj: { text }, be: "write" };
}

export const signatures = [
  { signatureWords: ["be", "write", "obj", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "obj", "num", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "obj", "bool", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "obj", "hollow", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "obj", "name", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "obj", "name", "num", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "obj", "name", "bool", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "obj", "name", "hollow", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "obj", "name", "vec", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "obj", "vec", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "obj", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "obj", "num", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "obj", "bool", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "obj", "hollow", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "obj", "name", "text", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "obj", "name", "num", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "obj", "name", "bool", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "obj", "name", "hollow", "to", "filename"], handler: write },
  { signatureWords: ["be", "write", "become", "text", "obj", "name", "vec", "to", "filename"], handler: write }
];
