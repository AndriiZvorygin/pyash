import { remember, doRemember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";

function resolveTextValue(value, { rememberFn = remember } = {}) {
  if (!value) return null;
  if (typeof value.text === "string") return value.text;
  if (typeof value.name === "string") {
    const fact = rememberFn(value.name);
    if (typeof fact?.ob?.text === "string") return fact.ob.text;
  }
  return null;
}

function resolveDelimiter(sentence, { rememberFn = remember } = {}) {
  if (typeof sentence?.by?.wo === "string") {
    if (sentence.by.wo === "newline") return "\n";
    return sentence.by.wo;
  }
  if (typeof sentence?.by?.text === "string") return sentence.by.text;
  if (typeof sentence?.by?.name === "string") {
    const fact = rememberFn(sentence.by.name);
    if (typeof fact?.ob?.text === "string") return fact.ob.text;
  }
  return null;
}

function distributeText(sourceText, delimiter) {
  if (delimiter === "\n") {
    const values = String(sourceText ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    if (values.length > 0 && values.at(-1) === "") values.pop();
    return values;
  }
  return String(sourceText ?? "").split(delimiter);
}

export async function distribute(sentence, { remember: rememberFn = remember } = {}) {
  const sourceText = resolveTextValue(sentence.ob, { rememberFn });
  if (typeof sourceText !== "string") {
    throwErrorSentence({
      name: "distribute defective",
      message: "distribute defective: missing source text",
      from: { name: "distribute" },
      raw: sentence
    });
  }

  const delimiter = resolveDelimiter(sentence, { rememberFn });
  if (typeof delimiter !== "string") {
    throwErrorSentence({
      name: "distribute defective",
      message: "distribute defective: missing delimiter",
      from: { name: "distribute" },
      raw: sentence
    });
  }
  if (delimiter.length === 0) {
    throwErrorSentence({
      name: "distribute defective",
      message: "distribute defective: empty delimiter",
      from: { name: "distribute" },
      raw: sentence
    });
  }

  const values = distributeText(sourceText, delimiter);
  const out = {
    mood: "ya",
    su: { name: sentence?.to?.name ?? "distributed vector" },
    be: "vector",
    ob: { ve: { type: "text", values } }
  };
  if (sentence?.to?.name) doRemember(out);
  return out;
}

export default distribute;

export const signatures = [
  { signatureWords: ["be", "distribute", "ob", "text", "to", "name", "vec"], handler: distribute },
  { signatureWords: ["be", "distribute", "ob", "text", "to", "name", "vec", "text"], handler: distribute },
  { signatureWords: ["be", "distribute", "ob", "name", "to", "name", "vec"], handler: distribute },
  { signatureWords: ["be", "distribute", "ob", "name", "to", "name", "vec", "text"], handler: distribute },
  { signatureWords: ["be", "distribute", "ob", "name", "num", "to", "name", "vec"], handler: distribute },
  { signatureWords: ["be", "distribute", "ob", "name", "num", "to", "name", "vec", "text"], handler: distribute },
  { signatureWords: ["be", "distribute", "by", "text", "ob", "text", "to", "name", "vec"], handler: distribute },
  { signatureWords: ["be", "distribute", "by", "text", "ob", "text", "to", "name", "vec", "text"], handler: distribute },
  { signatureWords: ["be", "distribute", "by", "text", "ob", "name", "to", "name", "vec"], handler: distribute },
  { signatureWords: ["be", "distribute", "by", "text", "ob", "name", "to", "name", "vec", "text"], handler: distribute },
  { signatureWords: ["be", "distribute", "by", "text", "ob", "name", "num", "to", "name", "vec"], handler: distribute },
  { signatureWords: ["be", "distribute", "by", "text", "ob", "name", "num", "to", "name", "vec", "text"], handler: distribute },
  { signatureWords: ["be", "distribute", "by", "text", "ob", "name", "text", "to", "name", "vec"], handler: distribute },
  { signatureWords: ["be", "distribute", "by", "text", "ob", "name", "text", "to", "name", "vec", "text"], handler: distribute },
  { signatureWords: ["be", "distribute", "by", "name", "text", "ob", "text", "to", "name", "vec"], handler: distribute },
  { signatureWords: ["be", "distribute", "by", "name", "text", "ob", "text", "to", "name", "vec", "text"], handler: distribute },
  { signatureWords: ["be", "distribute", "by", "name", "text", "ob", "name", "to", "name", "vec"], handler: distribute },
  { signatureWords: ["be", "distribute", "by", "name", "text", "ob", "name", "to", "name", "vec", "text"], handler: distribute },
  { signatureWords: ["be", "distribute", "by", "name", "text", "ob", "name", "num", "to", "name", "vec"], handler: distribute },
  { signatureWords: ["be", "distribute", "by", "name", "text", "ob", "name", "num", "to", "name", "vec", "text"], handler: distribute },
  { signatureWords: ["be", "distribute", "by", "name", "text", "ob", "name", "text", "to", "name", "vec"], handler: distribute },
  { signatureWords: ["be", "distribute", "by", "name", "text", "ob", "name", "text", "to", "name", "vec", "text"], handler: distribute },
  { signatureWords: ["be", "distribute", "by", "wo", "newline", "ob", "name", "to", "name", "vec"], handler: distribute },
  { signatureWords: ["be", "distribute", "by", "wo", "newline", "ob", "name", "to", "name", "vec", "text"], handler: distribute },
  { signatureWords: ["be", "distribute", "by", "wo", "newline", "ob", "name", "num", "to", "name", "vec"], handler: distribute },
  { signatureWords: ["be", "distribute", "by", "wo", "newline", "ob", "name", "num", "to", "name", "vec", "text"], handler: distribute },
  { signatureWords: ["be", "distribute", "by", "wo", "newline", "ob", "text", "to", "name", "vec"], handler: distribute },
  { signatureWords: ["be", "distribute", "by", "wo", "newline", "ob", "text", "to", "name", "vec", "text"], handler: distribute },
  { signatureWords: ["be", "distribute", "by", "wo", "newline", "ob", "name", "text", "to", "name", "vec"], handler: distribute },
  { signatureWords: ["be", "distribute", "by", "wo", "newline", "ob", "name", "text", "to", "name", "vec", "text"], handler: distribute }
];
