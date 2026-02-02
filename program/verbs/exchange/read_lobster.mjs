import path from "node:path";
import fs from "node:fs/promises";

import { throwErrorSentence } from "../../error.mjs";
import { sentenceToPyash } from "../../beautiful.mjs";
import { parseYamlToJsonValue, canonicalizeJsonValue } from "./yaml.mjs";
import { compareUtf8 } from "./json_map_export.mjs";
import { recordArtifact, recordExchange } from "../../bridge/exchange.mjs";
import { doRemember } from "../../remember/index.mjs";

function valueToOb(value) {
  if (typeof value === "string") return { text: value };
  if (typeof value === "number") return { num: value };
  if (typeof value === "boolean") return { bool: value };
  if (value === null) return { hollow: true };
  return { text: JSON.stringify(value) };
}

function readSourceText(sentence) {
  const sourceFilename = sentence?.from?.filename ?? sentence?.ob?.filename;
  const sourceText = sentence?.ob?.text ?? sentence?.from?.text ?? null;
  return { sourceFilename, sourceText };
}

function parseRef(ref) {
  if (typeof ref !== "string") return null;
  const trimmed = ref.trim();
  const match = /^\$([A-Za-z0-9_-]+)(?:\.(stdout|approved))?$/.exec(trimmed);
  if (!match) return null;
  return { id: match[1], field: match[2] ?? "stdout" };
}

function ensureObject(value, { source }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throwErrorSentence({
      name: "lobster defective",
      message: "lobster defective: root must be mapping",
      from: { name: source },
      raw: { value }
    });
  }
  return value;
}

function ensureSteps(value, { source }) {
  if (!Array.isArray(value)) {
    throwErrorSentence({
      name: "lobster defective",
      message: "lobster defective: steps must be list",
      from: { name: source },
      raw: { value }
    });
  }
  return value;
}

function buildSeriesSentences({ workflow, fallbackName }) {
  const lines = [];
  const name = String(workflow.name ?? fallbackName ?? "workflow");
  lines.push({ mood: "def", be: "refinery", su: { name } });

  const env = workflow.env && typeof workflow.env === "object" && !Array.isArray(workflow.env) ? workflow.env : null;
  if (env) {
    const keys = Object.keys(env).sort(compareUtf8);
    for (const key of keys) {
      lines.push({
        mood: "ya",
        be: "ecology",
        su: { name: key },
        ob: valueToOb(env[key])
      });
    }
  }

  if (workflow.cwd) {
    lines.push({
      mood: "do",
      be: "go",
      su: { name: "go cwd" },
      to: { filename: String(workflow.cwd) }
    });
  }

  const steps = ensureSteps(workflow.steps, { source: "lobster" });
  for (const step of steps) {
    const stepObj = ensureObject(step, { source: "lobster" });
    const id = String(stepObj.id ?? "");
    if (!id) {
      throwErrorSentence({
        name: "lobster defective",
        message: "lobster defective: step id required",
        from: { name: "lobster" },
        raw: stepObj
      });
    }
    const command = stepObj.command;
    if (typeof command !== "string" || !command.trim()) {
      throwErrorSentence({
        name: "lobster defective",
        message: "lobster defective: step command required",
        from: { name: "lobster" },
        raw: stepObj
      });
    }

    const stepEnv = stepObj.env && typeof stepObj.env === "object" && !Array.isArray(stepObj.env) ? stepObj.env : null;
    if (stepEnv) {
      const keys = Object.keys(stepEnv).sort(compareUtf8);
      for (const key of keys) {
        lines.push({
          mood: "ya",
          be: "ecology",
          su: { name: `${id} env ${key}` },
          ob: valueToOb(stepEnv[key])
        });
      }
    }

    if (stepObj.cwd) {
      lines.push({
        mood: "do",
        be: "go",
        su: { name: `go ${id}` },
        to: { filename: String(stepObj.cwd) }
      });
    }

    const deps = [];
    let fromtext = null;

    if (typeof stepObj.stdin === "string") {
      const ref = parseRef(stepObj.stdin);
      if (ref?.id) {
        deps.push(ref.id);
        fromtext = { name: `${ref.id} stdout` };
      } else {
        fromtext = { text: stepObj.stdin };
      }
    }

    if (!fromtext && typeof stepObj.prompt === "string" && stepObj.prompt.trim()) {
      fromtext = { text: stepObj.prompt };
    }

    if (typeof stepObj.condition === "string") {
      const ref = parseRef(stepObj.condition);
      if (ref?.id && !deps.includes(ref.id)) deps.push(ref.id);
    }

    const mood = stepObj.approval === "required" ? "propose" : "do";
    const obText = mood === "propose" && typeof stepObj.prompt === "string" && stepObj.prompt.trim()
      ? stepObj.prompt
      : command;

    const action = {
      mood,
      be: "command",
      su: { name: id },
      ob: { text: obText },
      to: { name: `${id} stdout`, nameTypeWords: ["text"] }
    };
    if (deps.length) {
      action.from = { ve: { type: "name", values: deps } };
    }
    if (fromtext) {
      action.fromtext = fromtext;
    }
    lines.push(action);

    if (typeof stepObj.condition === "string") {
      const ref = parseRef(stepObj.condition);
      if (ref?.id && ref.field === "approved") {
        lines.push({
          mood: "do",
          be: "remains",
          ob: { text: "truth" },
          from: { name: `${ref.id} approved` }
        });
        lines.push({
          mood: "then",
          be: "then",
          ob: { text: "truth" }
        });
      }
    }
  }

  lines.push({ mood: "prah" });
  return lines.map(sentenceToPyash).join("\n");
}

export async function read_fromstate_lobster(sentence) {
  const source = "read lobster";
  const { sourceFilename, sourceText } = readSourceText(sentence);
  let text = sourceText;
  let buffer = null;

  if (sourceFilename) {
    try {
      buffer = await fs.readFile(sourceFilename);
      text = buffer.toString("utf8");
    } catch (err) {
      throwErrorSentence({
        name: "lobster lost",
        message: "lobster lost",
        from: { name: source },
        raw: { filename: sourceFilename, error: err?.message }
      });
    }
  }

  if (typeof text !== "string") {
    throwErrorSentence({
      name: "lobster defective",
      message: "lobster defective",
      from: { name: source },
      raw: { filename: sourceFilename }
    });
  }

  if (sourceFilename && buffer) {
    const artifact = recordArtifact({ locator: sourceFilename, producer: "exchange", bytes: buffer });
    if (artifact?.su?.name) {
      recordExchange({ artifactName: artifact.su.name, op: "read", producer: "exchange" });
    }
  }

  let parsed;
  try {
    parsed = parseYamlToJsonValue(text, { source });
  } catch (err) {
    throw err;
  }
  parsed = canonicalizeJsonValue(parsed);
  const workflow = ensureObject(parsed, { source });
  const fallbackName = sourceFilename ? path.basename(sourceFilename, path.extname(sourceFilename)) : "workflow";
  const pyash = buildSeriesSentences({ workflow, fallbackName });

  const targetName = sentence?.to?.name ?? sentence?.su?.name;
  if (targetName) {
    doRemember({ mood: "ya", be: "text", su: { name: targetName }, ob: { text: pyash } });
  }
  return { ob: { text: pyash }, be: "read" };
}
