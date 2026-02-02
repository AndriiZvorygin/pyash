import { parse } from "../understand/index.mjs";
import { splitSentences } from "../library/sentenceSplitter.mjs";
import { remember, doRemember, pushMemoryContext, popMemoryContext } from "../remember/index.mjs";
import { throwErrorSentence, surfaceErrorSentence } from "../error.mjs";

async function resolveInterpret() {
  const mod = await import("../bridge/index.mjs");
  return mod.interpret;
}

function resolveSourceText(sentence) {
  if (typeof sentence?.ob?.text === "string") return sentence.ob.text;
  if (typeof sentence?.ob?.name === "string") {
    const fact = remember(sentence.ob.name);
    if (typeof fact?.ob?.text === "string") return fact.ob.text;
  }
  return null;
}

function chunkifyLines(lines) {
  const chunks = [];
  let current = [];
  let depth = 0;
  for (const line of lines) {
    const sentence = (() => {
      try { return parse(line); } catch { return null; }
    })();
    const mood = sentence?.mood ?? null;
    if (depth === 0 && mood === "def") {
      current = [line];
      depth = 1;
      continue;
    }
    if (depth > 0) {
      current.push(line);
      if (mood === "def") depth += 1;
      if (mood === "prah") depth -= 1;
      if (depth === 0) {
        chunks.push(current);
        current = [];
      }
      continue;
    }
    chunks.push([line]);
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function buildCandidateText(chunks) {
  const lines = chunks.flat();
  return lines.join("\n").trimEnd();
}

async function runCandidateDefault({ candidateText, interpret }) {
  const lines = splitSentences(candidateText, { includeThen: true });
  let failed = false;
  pushMemoryContext({ seedFromCurrent: true });
  try {
    for (const line of lines) {
      if (!line.trim()) continue;
      const sentence = parse(line);
      let res;
      try {
        res = await interpret(sentence);
      } catch (err) {
        failed = true;
        break;
      }
      const surfaced = surfaceErrorSentence(res?.sentence ?? res);
      if (surfaced?.be === "error" && surfaced?.mood === "ya") {
        failed = true;
        break;
      }
    }
  } finally {
    popMemoryContext();
  }
  return !failed;
}

async function runCandidateVerifier({ candidateText, verifierName, interpret }) {
  let verdict = "";
  let failed = false;
  pushMemoryContext({ seedFromCurrent: true });
  try {
    doRemember({ mood: "ya", su: { name: "source" }, ob: { text: candidateText }, be: "text" });
    const result = await interpret({
      mood: "do",
      be: verifierName,
      ob: { name: "source", nameTypeWords: ["text"] },
      to: { name: "verdict", nameTypeWords: ["text"] }
    });
    const resultText = result?.ob?.text ?? result?.value?.ob?.text ?? "";
    if (typeof resultText === "string" && resultText.trim()) {
      verdict = resultText.trim();
    }
    const fact = remember("verdict");
    if (!verdict) verdict = String(fact?.ob?.text ?? "").trim();
  } catch (err) {
    failed = true;
  } finally {
    popMemoryContext();
  }
  if (failed) return false;
  return verdict.toUpperCase().includes("PASS");
}

async function successSieve(sentence) {
  const interpret = await resolveInterpret();
  const sourceText = resolveSourceText(sentence);
  if (typeof sourceText !== "string") {
    throwErrorSentence({
      name: "sieve defective",
      message: "sieve defective: missing source text",
      from: { name: "success sieve" },
      raw: sentence
    });
  }
  const verifierName = sentence?.from?.name ?? null;
  const maxAttempts = Math.max(1, Math.trunc(sentence?.atmost?.num ?? 100));
  const lines = splitSentences(sourceText, { includeThen: true }).filter(l => l.trim().length);
  let chunks = chunkifyLines(lines);
  let attempts = 0;
  let changed = true;

  const verify = async (candidateText) => {
    attempts += 1;
    if (verifierName) {
      return runCandidateVerifier({ candidateText, verifierName, interpret });
    }
    return runCandidateDefault({ candidateText, interpret });
  };

  while (changed && attempts < maxAttempts) {
    changed = false;
    for (let i = 0; i < chunks.length; i += 1) {
      if (attempts >= maxAttempts) break;
      const candidateChunks = chunks.slice(0, i).concat(chunks.slice(i + 1));
      const candidateText = buildCandidateText(candidateChunks);
      if (!candidateText) continue;
      const stillPasses = await verify(candidateText);
      if (stillPasses) {
        chunks = candidateChunks;
        changed = true;
        i = -1;
      }
    }
  }

  const outputText = buildCandidateText(chunks);
  if (sentence?.to?.name) {
    doRemember({ mood: "ya", su: { name: sentence.to.name }, ob: { text: outputText }, be: "text" });
  }
  return { ob: { text: outputText }, be: "text" };
}

export const signatures = [
  { signatureWords: ["be", "success", "sieve", "ob", "text", "to", "name", "text"], handler: successSieve },
  { signatureWords: ["be", "success", "sieve", "ob", "name", "text", "to", "name", "text"], handler: successSieve },
  { signatureWords: ["be", "success", "sieve", "ob", "text", "from", "name", "to", "name", "text"], handler: successSieve },
  { signatureWords: ["be", "success", "sieve", "ob", "name", "text", "from", "name", "to", "name", "text"], handler: successSieve },
  { signatureWords: ["be", "success", "sieve", "ob", "text", "from", "text", "to", "name", "text"], handler: successSieve },
  { signatureWords: ["be", "success", "sieve", "ob", "name", "text", "from", "text", "to", "name", "text"], handler: successSieve },
  { signatureWords: ["be", "success", "sieve", "from", "text", "ob", "text", "to", "name", "text"], handler: successSieve },
  { signatureWords: ["be", "success", "sieve", "from", "text", "ob", "name", "text", "to", "name", "text"], handler: successSieve },
  { signatureWords: ["be", "success", "sieve", "from", "name", "ob", "text", "to", "name", "text"], handler: successSieve },
  { signatureWords: ["be", "success", "sieve", "from", "name", "ob", "name", "text", "to", "name", "text"], handler: successSieve },
  { signatureWords: ["be", "success", "sieve", "ob", "text", "atmost", "num", "to", "name", "text"], handler: successSieve },
  { signatureWords: ["be", "success", "sieve", "ob", "name", "text", "atmost", "num", "to", "name", "text"], handler: successSieve },
  { signatureWords: ["be", "success", "sieve", "ob", "text", "from", "name", "atmost", "num", "to", "name", "text"], handler: successSieve },
  { signatureWords: ["be", "success", "sieve", "ob", "name", "text", "from", "name", "atmost", "num", "to", "name", "text"], handler: successSieve },
  { signatureWords: ["be", "success", "sieve", "ob", "text", "from", "text", "atmost", "num", "to", "name", "text"], handler: successSieve },
  { signatureWords: ["be", "success", "sieve", "ob", "name", "text", "from", "text", "atmost", "num", "to", "name", "text"], handler: successSieve },
  { signatureWords: ["be", "success", "sieve", "from", "text", "ob", "text", "atmost", "num", "to", "name", "text"], handler: successSieve },
  { signatureWords: ["be", "success", "sieve", "from", "text", "ob", "name", "text", "atmost", "num", "to", "name", "text"], handler: successSieve },
  { signatureWords: ["be", "success", "sieve", "from", "name", "ob", "text", "atmost", "num", "to", "name", "text"], handler: successSieve },
  { signatureWords: ["be", "success", "sieve", "from", "name", "ob", "name", "text", "atmost", "num", "to", "name", "text"], handler: successSieve }
];

export default successSieve;
