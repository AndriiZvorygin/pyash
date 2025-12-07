import fs from "node:fs/promises";
import { buildProgram } from "../../program.mjs";
import { doRemember, remember } from "../../remember/index.mjs";
import { sentenceToPyash } from "../../beautiful.mjs";

function sanitizeName(name = "") {
  return String(name)
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^([0-9])/, "_$1");
}

function pathFromGenitive(genitive = [], sentenceArg) {
  if (!sentenceArg) return null;
  const chainArr = Array.isArray(genitive) ? genitive : genitive?.chain;
  if (!chainArr || chainArr.length === 0) return null;
  const chain = chainArr[0] === "this" ? chainArr.slice(1) : chainArr;
  if (chain.length === 0) return sentenceArg;
  return [sentenceArg, ...chain.map(part => `.${part}`)].join("");
}

function valueForRole(role, sentenceArg, field = "num", slot = {}) {
  if (!sentenceArg) return null;
  if (slot.genitive) {
    const access = pathFromGenitive(slot.genitive, sentenceArg);
    return access;
  }
  return `${sentenceArg}.${role}?.${field}`;
}

function targetPath(role, sentenceArg, field = "num", slot = {}) {
  if (!sentenceArg) return null;
  if (slot.genitive) {
    return pathFromGenitive(slot.genitive, sentenceArg);
  }
  return `${sentenceArg}.${role}.${field}`;
}

function transpileSentence(sentence, { lang, sentenceArg } = {}) {
  const obj = sentence.obj ?? {};
  const verb = sentence.be || sentence.mood || "";
  const beWords = verb.split(" ").filter(Boolean);
  const isPermanent = beWords[0] === "permanent";
  const baseBe = isPermanent ? beWords.slice(1).join(" ") : verb;
  const effectiveBe = baseBe || sentence.mood;

  const rememberTarget = sentenceArg
    ? (name) => `((typeof remember === "function" ? remember(${name}) : null) || { subj: { name: ${name} }, obj: {} })`
    : null;

  // Conditionals (tiny/giant/equally) with then consequence
  if (sentence.consequence && (baseBe === "tiny" || baseBe === "giant" || baseBe === "equally")) {
    const lhs =
      sentenceArg && obj.num !== undefined ? `${sentenceArg}.obj?.num` :
      sentenceArg && obj.name ? `${sentenceArg}.obj?.name` :
      obj.num ?? obj.name ?? "lhs";
    const rhs =
      sentenceArg && sentence.from?.num !== undefined ? `${sentenceArg}.from?.num` :
      sentenceArg && sentence.from?.name ? `${sentenceArg}.from?.name` :
      sentence.from?.num ?? sentence.from?.name ?? "rhs";
    const op = baseBe === "tiny" ? "<" : baseBe === "giant" ? ">" : "===";
    const consequence = sentence.consequence;
    const body = transpileSentence(consequence, { lang, sentenceArg }) ?? `// TODO: ${JSON.stringify(consequence)}`;
    const finalBody = body.split("\n").map(l => (l ? `  ${l}` : l)).join("\n");
    return `if (${lhs} ${op} ${rhs}) {\n${finalBody}\n}`;
  }

  // Imperative add
  if (baseBe === "add" && obj.num !== undefined && (sentence.to?.name || sentence.to?.genitive)) {
    const safeValue = typeof obj.num === "number" ? obj.num : Number(obj.num);
    if (sentenceArg) {
      const targetName =
        sentence.to?.name
          ? `${sentenceArg}.to.name`
          : sentence.subj?.name
            ? `${sentenceArg}.subj.name`
            : `"${sentence.subj?.name ?? sentence.to?.name ?? "target"}"`;
      const targetBase = rememberTarget ? rememberTarget(targetName) : `{ subj: { name: ${targetName} }, obj: {} }`;
      const targetVar = "target";
      const baseObj = `${targetVar}.obj ?? (${targetVar}.obj = {})`;
      const fieldPath = sentence.to?.genitive
        ? pathFromGenitive(sentence.to.genitive, targetVar) || `${targetVar}.obj.num`
        : `${baseObj}.num`;
      const newVal = `${fieldPath} ?? 0`;
      return `const ${targetVar} = ${targetBase};\n${fieldPath} = (${newVal}) + ${Number.isNaN(safeValue) ? 0 : safeValue};\nreturn ${targetVar};`;
    }
    return `${sentence.to.name} = ${sentence.to.name} + ${Number.isNaN(safeValue) ? 0 : safeValue};`;
  }

  if (baseBe === "subtract" && obj.num !== undefined && sentence.to?.name) {
    const safeValue = typeof obj.num === "number" ? obj.num : Number(obj.num);
    if (sentenceArg) {
      const target = targetPath("to", sentenceArg) ?? sentence.to.name;
      return `${target} = (${target} ?? 0) - ${Number.isNaN(safeValue) ? 0 : safeValue};`;
    }
    return `${sentence.to.name} = ${sentence.to.name} - ${Number.isNaN(safeValue) ? 0 : safeValue};`;
  }

  if (baseBe === "multiply" && obj.num !== undefined && sentence.to?.name) {
    const safeValue = typeof obj.num === "number" ? obj.num : Number(obj.num);
    if (sentenceArg) {
      const target = targetPath("to", sentenceArg) ?? sentence.to.name;
      return `${target} = (${target} ?? 0) * ${Number.isNaN(safeValue) ? 0 : safeValue};`;
    }
    return `${sentence.to.name} = ${sentence.to.name} * ${Number.isNaN(safeValue) ? 0 : safeValue};`;
  }

  if (baseBe === "divide" && obj.num !== undefined && sentence.to?.name) {
    const safeValue = typeof obj.num === "number" ? obj.num : Number(obj.num);
    const divisor = Number.isNaN(safeValue) ? 1 : safeValue;
    if (sentenceArg) {
      const target = targetPath("to", sentenceArg) ?? sentence.to.name;
      return `${target} = (${target} ?? 0) / ${divisor};`;
    }
    return `${sentence.to.name} = ${sentence.to.name} / ${divisor};`;
  }

  const name = sentence?.subj?.name;
  const mood = sentence?.mood;
  if (!name || mood === "do") return null;

  const shouldDeclare = Boolean(sentence.exists);

  if (effectiveBe === "number" && typeof obj.num !== "undefined") {
    const value = typeof obj.num === "number" ? obj.num : Number(obj.num);
    const safeValue = Number.isNaN(value) ? 0 : value;
    if (sentenceArg) {
      const target = valueForRole("subj", sentenceArg, "num", sentence.subj) ?? name;
      return `${target} = ${safeValue};`;
    }
    if (lang === "c") {
      if (!shouldDeclare) return `${name} = ${safeValue};`;
      const decl = isPermanent ? "const double" : "double";
      return `${decl} ${name} = ${safeValue};`;
    }
    if (!shouldDeclare) return `${name} = ${safeValue};`;
    const decl = isPermanent ? "const" : "let";
    return `${decl} ${name} = ${safeValue};`;
  }

  if (effectiveBe === "text" && typeof obj.text === "string") {
    const value = JSON.stringify(obj.text);
    if (sentenceArg) {
      const target = valueForRole("subj", sentenceArg, "text") ?? name;
      return `${target} = ${value};`;
    }
    if (lang === "c") {
      if (!shouldDeclare) return `${name} = ${value};`;
      const decl = isPermanent ? "const char *" : "char *";
      return `${decl} ${name} = ${value};`;
    }
    if (!shouldDeclare) return `${name} = ${value};`;
    const decl = isPermanent ? "const" : "let";
    return `${decl} ${name} = ${value};`;
  }

  return null;
}

function transpileCeremony(defSentence, bodySentences, { lang }) {
  const fnName = sanitizeName(defSentence?.subj?.name || "ceremony");

  const bodyLines = [];
  let hasReturn = false;
  for (const s of bodySentences) {
    const line = transpileSentence(s, { lang, sentenceArg: "sentence" });
    if (line) {
      bodyLines.push(line);
      if (line.includes("return")) hasReturn = true;
    }
  }

  const retLine =
    hasReturn
      ? null
      : lang === "c"
        ? "return;"
        : "return sentence;";

  if (lang === "c") {
    const paramList = "void";
    const body = [...bodyLines, ...(retLine ? [retLine] : [])].map(l => `  ${l}`).join("\n");
    return `void ${fnName}(${paramList}) {\n${body}\n}`;
  }

  const body = [...bodyLines, ...(retLine ? [retLine] : [])].map(l => `  ${l}`).join("\n");
  return `function ${fnName}(sentence) {\n${body}\n}`;
}

function transpileProgram(sentences, { lang }) {
  const header =
    lang === "c"
      ? "/* Generated by Pyash compile */"
      : "// Generated by Pyash compile";
  const lines = [header];
  const declared = new Set();
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const name = sentence?.subj?.name;

    if (sentence.mood === "def" && sentence.be === "ceremony") {
      const body = [];
      let j = i + 1;
      for (; j < sentences.length; j++) {
        if (sentences[j].mood === "prah") break;
        body.push(sentences[j]);
      }
      const fn = transpileCeremony(sentence, body, { lang });
      lines.push(fn);
      i = j; // skip to end of block
      continue;
    }

    if (sentence.mood === "ya" && name && !sentence.exists && !declared.has(name)) {
      const pyash = sentenceToPyash(sentence);
      throw new Error(`subj quoted.pyash.${pyash}.pyash.quoted be error obj name variable as not exists ya`);
    }

    const line = transpileSentence(sentence, { lang });
    const todoPrefix = lang === "c" ? "/* TODO" : "// TODO";
    const todoSuffix = lang === "c" ? " */" : "";
    lines.push(line ?? `${todoPrefix}: ${JSON.stringify(sentence)}${todoSuffix}`);
    if (name && sentence.mood === "ya") declared.add(name);
  }
  return lines.join("\n") + "\n";
}

async function compile_from_filename_to_filename(sentence) {
  const sourceFilename =
    sentence?.from?.filename ??
    sentence?.obj?.filename ??
    sentence?.filename;

  let sourceText = sentence?.fromtext?.text ?? sentence?.from?.text ?? sentence?.text ?? sentence?.obj?.text;

  if (!sourceText && sentence?.obj?.name) {
    const recalled = remember(sentence.obj.name);
    sourceText = recalled?.obj?.text;
  }

  if (!sourceText && sourceFilename) {
    sourceText = await fs.readFile(sourceFilename, "utf8");
  }
  if (typeof sourceText !== "string") {
    throw new Error("compile: source text is required (from text or from filename)");
  }

  // Allow escaped newlines in inline text blocks
  sourceText = sourceText.replaceAll("\\n", "\n");

  const program = buildProgram(sourceText);

  const targetLang = (sentence?.become?.name || "javascript").toLowerCase();
  const body = transpileProgram(program.sentences, { lang: targetLang });

  const targetFilename = sentence?.to?.filename;
  if (targetFilename) {
    await fs.writeFile(targetFilename, body, "utf8");
  }

  const targetName = sentence?.to?.name ?? sentence?.totext?.name ?? sentence?.subj?.name;
  if (targetName) {
    doRemember({
      subj: { name: targetName },
      be: sentence?.become?.name ?? "javascript",
      obj: { text: body, sentences: program.sentences },
      mood: "ya",
    });
  }

  return { obj: { text: body, sentences: program.sentences }, be: sentence?.become?.name ?? "javascript" };
}

export default compile_from_filename_to_filename;
export { transpileSentence };

export const signatures = [
  {
    signatureWords: ["be", "compile", "become", "name", "num", "from", "filename", "fromstate", "name", "num", "to", "filename"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "from", "filename", "to", "filename"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "from", "text", "to", "text"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "from", "text", "to", "text"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "from", "text", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "from", "text", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "fromtext", "text", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "fromtext", "text", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "obj", "num", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "obj", "name", "fromstate", "name", "tostate", "name", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "obj", "name", "fromstate", "name", "become", "name", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "obj", "name", "num", "fromstate", "name", "num", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "fromstate", "name", "num", "obj", "name", "num", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "fromstate", "name", "num", "obj", "name", "text", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "obj", "name", "num", "fromstate", "name", "num", "tostate", "name", "num", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  }
];
