// pyash/workflow.mjs
import fs from "node:fs/promises";

import { doRemember, remember, allRemember, forget } from "../remember/index.mjs";
import mind from "../verbs/mind.mjs";
import chip from "../verbs/chip.mjs";

const VERB_HANDLERS = {
  mind,
  chip
  // you can add more later
};

// Extract upstream dependencies from a workflow sentence
function extractInputs(sentence) {
  const from = sentence.from;
  if (!from) return [];

  if (from.name) {
    return [from.name];
  }

  if (from.and) {
    return from.and.map(x => x.name);
  }

  return [];
}

// Topological order by subj.name dependencies
function orderSentences(sentences) {
  const deps = new Map();
  const allNames = new Set();

  for (const s of sentences) {
    const name = s.subj?.name;
    if (!name) throw new Error("Every workflow sentence must have subj.name");

    allNames.add(name);
    deps.set(name, extractInputs(s));
  }

  const done = new Set();
  const order = [];

  while (done.size < allNames.size) {
    let progressed = false;

    for (const name of allNames) {
      if (done.has(name)) continue;

      const needed = deps.get(name);
      const ready = needed.every(dep => done.has(dep));

      if (ready) {
        order.push(name);
        done.add(name);
        progressed = true;
      }
    }

    if (!progressed) {
      throw new Error("Cyclic or unresolved dependencies in workflow");
    }
  }

  return order;
}

// Lookup convenience: return the stored value for a subj.name
function valueOf(name) {
  const fact = remember(name);
  if (!fact) return undefined;
  return fact.value ?? fact.obj ?? fact.result ?? fact; // be generous for now
}

// Main entry
export async function runWorkflow(workflow) {
  const sentences = workflow.workflow?.sentences ?? workflow.workplace?.sentences;
  if (!Array.isArray(sentences)) {
    throw new Error("workflow sentences must be an array");
  }

  // Reset Pyash memory for a clean run
  forget();

  // Index by subj.name
  const byName = new Map();
  for (const s of sentences) {
    const name = s.subj?.name;
    if (!name) throw new Error("Each sentence must have subj.name");
    byName.set(name, s);
  }

  const order = orderSentences(sentences);

  for (const name of order) {
    const sentence = byName.get(name);
    const verb = sentence.verb || sentence.be; // allow either `verb` or `be`

    if (!verb) {
      // pure declaratives? just store them
      doRemember(sentence);
      continue;
    }

    const handler = VERB_HANDLERS[verb];
    if (!handler) {
      // unknown verb in workflow: still store as fact, maybe used by normal Pyash later
      doRemember(sentence);
      continue;
    }

    // Resolve inputs
    const inputNames = extractInputs(sentence);
    const inputs = inputNames.map(valueOf);

    // Call verb handler
    const output = await handler(sentence, inputs, {}); // context object optional for now

    // Store result as a Pyash-style fact
    const fact = {
      ...sentence,
      result: output
    };

    doRemember(fact);
  }

  return allRemember();
}

// Convenience wrapper: accepts a workflow object or a path to a JSON file.
export async function runWorkplace(workplaceOrPath) {
  let payload = workplaceOrPath;

  if (typeof workplaceOrPath === "string") {
    const raw = await fs.readFile(workplaceOrPath, "utf8");
    payload = JSON.parse(raw);
  }

  if (!payload?.workplace) {
    throw new Error("workplace object with .workplace is required");
  }

  return runWorkflow(payload);
}
