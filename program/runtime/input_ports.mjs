import { tokenize } from "../understand/tokenize.mjs";
import { QUOTED_TEXT_PREFIX } from "../understand/constants.mjs";
import { throwErrorSentence } from "../error.mjs";

function normalizeToken(token) {
  const text = String(token ?? "");
  if (text.startsWith(QUOTED_TEXT_PREFIX)) return text.slice(QUOTED_TEXT_PREFIX.length);
  return text;
}

function parsePortTriples(tokens = [], startIndex = 0, stopWords = new Set()) {
  const ports = [];
  let index = startIndex;
  if (tokens[index] === "ve") index += 1;
  while (index < tokens.length) {
    const token = tokens[index];
    if (stopWords.has(token)) break;
    const transport = tokens[index];
    const kind = tokens[index + 1];
    const handle = tokens[index + 2];
    if (!transport || !kind || !handle || stopWords.has(kind) || stopWords.has(handle)) {
      return { error: "input declaration malformed port triple" };
    }
    ports.push({
      transport: String(transport),
      kind: String(kind),
      handle: String(handle)
    });
    index += 3;
  }
  return { ports, index };
}

export function parseInputDeclarationLine(rawLine = "") {
  const tokens = tokenize(String(rawLine).trim()).map(normalizeToken);
  if (tokens.length < 3) return null;
  const beIndex = tokens.lastIndexOf("be");
  if (beIndex < 0) return null;
  if (tokens[beIndex + 1] !== "input") return null;
  if (tokens[beIndex + 2] !== "ya") {
    return { error: "input declaration must end with be input ya" };
  }
  const obIndex = tokens.indexOf("ob");
  if (obIndex < 0 || obIndex >= beIndex) return { error: "input declaration missing ob ports" };
  const toIndex = tokens.indexOf("to");
  const obStops = new Set(toIndex > obIndex && toIndex < beIndex ? ["to", "be"] : ["be"]);
  const obResult = parsePortTriples(tokens, obIndex + 1, obStops);
  if (obResult.error) return { error: obResult.error };
  let outputs = [];
  if (toIndex > obIndex && toIndex < beIndex) {
    const toResult = parsePortTriples(tokens, toIndex + 1, new Set(["be"]));
    if (toResult.error) return { error: toResult.error };
    outputs = toResult.ports ?? [];
  }
  return { inputs: obResult.ports ?? [], outputs };
}

export function collectInputDeclarations(entries = []) {
  const inputs = [];
  const outputs = [];
  for (const entry of entries) {
    const line = String(entry?.text ?? "").trim();
    if (!line) continue;
    const parsed = parseInputDeclarationLine(line);
    if (!parsed) continue;
    if (parsed.error) {
      throwErrorSentence({
        name: "input declaration defective",
        message: `input declaration defective: ${parsed.error}`,
        from: { name: "runtime" },
        raw: { line }
      });
    }
    if (Array.isArray(parsed.inputs)) inputs.push(...parsed.inputs);
    if (Array.isArray(parsed.outputs)) outputs.push(...parsed.outputs);
  }
  return { inputs, outputs };
}
