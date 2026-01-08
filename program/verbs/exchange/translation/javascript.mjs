import { parseNumberToken } from "./parse_helpers.mjs";

function javascriptLineToSentence(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("//")) return null;
  const withoutSemi = trimmed.replace(/;$/, "");

  // Declarations with numbers
  let match = withoutSemi.match(/^(let|const|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([0-9.+-]+)$/);
  if (match) {
    const [, kind, name, numRaw] = match;
    const num = parseNumberToken(numRaw);
    const be =
      kind === "const" ? "permanent number" :
      "number";
    return {
      mood: "ya",
      su: { name },
      ob: { num },
      be,
      exists: true
    };
  }

  // Declarations with text
  match = withoutSemi.match(/^(let|const|var)\s+([A-Za-z_$][\w$]*)\s*=\s*["']([^"']*)["']$/);
  if (match) {
    const [, kind, name, text] = match;
    const be =
      kind === "const" ? "permanent text" :
      "text";
    return {
      mood: "ya",
      su: { name },
      ob: { text },
      be,
      exists: true
    };
  }

  // Simple assignment number
  match = withoutSemi.match(/^([A-Za-z_$][\w$]*)\s*=\s*([0-9.+-]+)$/);
  if (match) {
    const [, name, numRaw] = match;
    return {
      mood: "ya",
      su: { name },
      ob: { num: parseNumberToken(numRaw) },
      be: "number"
    };
  }

  // Simple assignment text
  match = withoutSemi.match(/^([A-Za-z_$][\w$]*)\s*=\s*["']([^"']*)["']$/);
  if (match) {
    const [, name, text] = match;
    return {
      mood: "ya",
      su: { name },
      ob: { text },
      be: "text"
    };
  }

  // Add/subtract/multiply/divide with explicit left reference
  match = withoutSemi.match(/^([A-Za-z_$][\w$]*)\s*=\s*\1\s*([+\-*/])\s*([0-9.+-]+)$/);
  if (match) {
    const [, name, op, numRaw] = match;
    const verb =
      op === "+" ? "add" :
      op === "-" ? "subtract" :
      op === "*" ? "multiply" :
      "divide";
    return {
      mood: "do",
      be: verb,
      ob: { num: parseNumberToken(numRaw) },
      to: { name }
    };
  }

  // Compound assignment (+=, -=, *=, /=)
  match = withoutSemi.match(/^([A-Za-z_$][\w$]*)\s*([+\-*/])=\s*([0-9.+-]+)$/);
  if (match) {
    const [, name, op, numRaw] = match;
    const verb =
      op === "+" ? "add" :
      op === "-" ? "subtract" :
      op === "*" ? "multiply" :
      "divide";
    return {
      mood: "do",
      be: verb,
      ob: { num: parseNumberToken(numRaw) },
      to: { name }
    };
  }

  return null;
}

export { javascriptLineToSentence };
