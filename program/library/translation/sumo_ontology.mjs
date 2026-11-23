import { execFile as execFileCallback } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export const SUMO_ONTOLOGY_COMMIT = "f0c126842d098a312e390479b38ecfbac018f8ed";
export const SUMO_ONTOLOGY_DEFINITION_LANGUAGE = "EnglishWrittenLanguage";
export const SUMO_ONTOLOGY_FORMAT = "sumo-ontology-v1";

const TERM_FORMAT_PATTERN = /^\(termFormat\s+EnglishWrittenLanguage\s+([^\s()]+)\s+("([^"]*)"|([^\s()]+))\s*\)\s*$/mu;
const FORMAT_PATTERN = /^\(format\s+EnglishWrittenLanguage\s+([^\s()]+)\s+("([^"]*)"|([^\s()]+))\s*\)\s*$/mu;
const INSTANCE_PATTERN = /^\(instance\s+([^\s()]+)\s+([^\s()]+)\s*\)\s*$/mu;
const SUBCLASS_PATTERN = /^\(subclass\s+([^\s()]+)\s+([^\s()]+)\s*\)\s*$/mu;
const SUBATTRIBUTE_PATTERN = /^\(subAttribute\s+([^\s()]+)\s+([^\s()]+)\s*\)\s*$/mu;

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-sumo-ontology";
  error.details = details;
  return error;
}

function unquote(value) {
  const text = String(value ?? "").trim();
  if (text.startsWith("\"") && text.endsWith("\"") && text.length >= 2) return text.slice(1, -1);
  return text;
}

/**
 * The ontology is a set of s-expression files. Only a small part of the syntax
 * is needed here: top level forms, double quoted strings that may span lines,
 * `;` comments, and parentheses. The scanner returns one entry per top level
 * form with its exact source text.
 */
export function scanSumoForms(source) {
  const text = String(source ?? "");
  const forms = [];
  let depth = 0;
  let start = -1;
  let index = 0;
  let inString = false;
  let inComment = false;
  while (index < text.length) {
    const character = text[index];
    if (inComment) {
      if (character === "\n") inComment = false;
      index += 1;
      continue;
    }
    if (inString) {
      if (character === "\\") { index += 2; continue; }
      if (character === "\"") inString = false;
      index += 1;
      continue;
    }
    if (character === ";") { inComment = true; index += 1; continue; }
    if (character === "\"") { inString = true; index += 1; continue; }
    if (character === "(") {
      if (depth === 0) start = index;
      depth += 1;
      index += 1;
      continue;
    }
    if (character === ")") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        forms.push(text.slice(start, index + 1));
        start = -1;
      }
      index += 1;
      continue;
    }
    index += 1;
  }
  return forms;
}

/**
 * `(documentation <Term> EnglishWrittenLanguage "<text>")` carries the English
 * definition of a term. The text may use the `&%Term` template form, which is
 * expanded with the lowercase surface declared by `termFormat`.
 */
export function parseSumoDocumentation(form) {
  const match = form.match(/^\(documentation\s+([^\s()]+)\s+([^\s()]+)\s+("([^"]*)"|([^\s()]+))\s*\)\s*$/su);
  if (!match) return null;
  const language = match[2];
  if (language !== SUMO_ONTOLOGY_DEFINITION_LANGUAGE) return null;
  return { term: match[1], definition: match[4] ?? unquote(match[5]) };
}

export function expandSumoTemplate(text, termFormats = new Map()) {
  return String(text ?? "").replace(/&%([^\s"',)\]]+)/gu, (whole, captured) => {
    // A definition can end the template with punctuation, so the trailing
    // marks belong to the sentence rather than to the term name.
    const term = captured.replace(/[.,;:!?]+$/u, "");
    const trailing = captured.slice(term.length);
    const surface = termFormats.get(term);
    return surface ? `${String(surface).trim()}${trailing}` : whole;
  });
}

/**
 * Reads the ontology files and returns the term surfaces, the English
 * definitions, and the class relations for every term.
 */
export function parseSumoOntology(sources = []) {
  const termFormats = new Map();
  const definitions = new Map();
  const instances = new Map();
  const subclasses = new Map();

  for (const source of sources) {
    for (const form of scanSumoForms(source)) {
      const termFormat = form.match(TERM_FORMAT_PATTERN);
      if (termFormat) {
        termFormats.set(termFormat[1], (termFormat[3] ?? termFormat[4] ?? termFormat[1]).replace(/\s+/gu, " "));
        continue;
      }
      const format = form.match(FORMAT_PATTERN);
      if (format) continue;
      const instance = form.match(INSTANCE_PATTERN);
      if (instance) {
        const list = instances.get(instance[1]) ?? [];
        list.push(instance[2]);
        instances.set(instance[1], list);
        continue;
      }
      const subclass = form.match(SUBCLASS_PATTERN);
      if (subclass) {
        const list = subclasses.get(subclass[1]) ?? [];
        list.push(subclass[2]);
        subclasses.set(subclass[1], list);
        continue;
      }
      const subattribute = form.match(SUBATTRIBUTE_PATTERN);
      if (subattribute) {
        const list = subclasses.get(subattribute[1]) ?? [];
        list.push(subattribute[2]);
        subclasses.set(subattribute[1], list);
        continue;
      }
      const documentation = parseSumoDocumentation(form);
      if (documentation) definitions.set(documentation.term, documentation.definition);
    }
  }

  const concepts = new Map();
  const terms = new Set([...definitions.keys(), ...instances.keys(), ...subclasses.keys()]);
  for (const term of terms) {
    const raw = definitions.get(term);
    concepts.set(term, {
      conceptId: term,
      label: term,
      definition: raw ? expandSumoTemplate(raw, termFormats).replace(/\s+/gu, " ").trim() : "",
      instances: instances.get(term) ?? [],
      subclassOf: subclasses.get(term) ?? []
    });
  }
  return { format: SUMO_ONTOLOGY_FORMAT, termFormats, concepts };
}

/**
 * Loads a pinned SUMO checkout. The checkout must sit at the recorded revision
 * so that a rebuild reproduces the same catalog.
 */
export async function loadSumoOntology({
  directory,
  expectedCommit = SUMO_ONTOLOGY_COMMIT,
  files = null
} = {}) {
  if (!directory) throw invalid("SUMO ontology requires a checkout directory");
  let head = "";
  try {
    const { stdout } = await execFile("git", ["-C", directory, "rev-parse", "HEAD"]);
    head = stdout.trim();
  } catch (error) {
    throw invalid("SUMO ontology directory is not a git checkout", { directory, cause: error.message });
  }
  if (expectedCommit && head !== expectedCommit) {
    throw invalid("SUMO ontology checkout does not match the pinned revision", {
      directory, expected: expectedCommit, actual: head
    });
  }
  const names = files ?? (await readdir(directory)).filter((name) => name.endsWith(".kif"));
  const sources = [];
  for (const name of names) sources.push(await readFile(join(directory, name), "utf8"));
  const ontology = parseSumoOntology(sources);
  return { ...ontology, commit: head, directory, files: names };
}
