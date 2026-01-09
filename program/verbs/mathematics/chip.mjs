// pyash/verbs/chip.mjs
import fs from "node:fs/promises";
import { remember, doRemember } from "../../remember/index.mjs";
import { makeChip, makeRuntimeError, makeStream } from "../../library/runtimePrimitives.mjs";

export async function chip_from_filename_text(sentence) {
  const filepath = sentence.from?.path;
  if (!filepath) throw new Error("chip: from.path is required");

  const fmt = sentence.by?.format || "jsonl";
  if (fmt !== "jsonl") {
    throw new Error(`chip: unsupported format "${fmt}"`);
  }

  const raw = await fs.readFile(filepath, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);

  const chips = lines.map(line => {
    try {
      return JSON.parse(line);
    } catch {
      return { text: line };
    }
  });

  return { chips };
}

async function readHearStreamLines(filename) {
  try {
    const raw = await fs.readFile(filename, "utf8");
    const lines = raw.split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0);
    const blankIndex = lines.indexOf("[BLANK_AUDIO]");
    if (blankIndex !== -1) {
      return { lines: lines.slice(0, blankIndex), final: true };
    }
    return { lines, final: false };
  } catch (err) {
    if (err?.code === "ENOENT") return { lines: [], final: false };
    throw err;
  }
}

export async function chip_su_stream(sentence) {
  const streamName = sentence.su?.name;
  if (!streamName) {
    return makeRuntimeError({
      name: "stream missing",
      message: "chip requires su name stream"
    });
  }

  const stream = remember(streamName);
  if (!stream || stream.be !== "stream") {
    return makeRuntimeError({
      name: "stream missing",
      message: `stream not found: ${streamName}`
    });
  }

  if (stream.ob?.kind === "hear" && stream.ob?.filename) {
    const { lines, final: streamFinal } = await readHearStreamLines(stream.ob.filename);
    const index = stream.ob?.index ?? 0;
    if (index >= lines.length) return null;

    const value = lines[index];
    const lastIndex = lines.length - 1;
    const final = Boolean(streamFinal);
    const chip = makeChip({
      streamName,
      index,
      ob: { text: String(value) },
      toindex: final ? lastIndex : undefined,
      vyahValues: ["eval", "sloh"]
    });

    const nextIndex = index + 1;
    const nextState = final && nextIndex > lastIndex ? "done" : (stream.as?.name ?? "open");
    const updated = makeStream({
      name: streamName,
      state: nextState,
      ob: { ...stream.ob, index: nextIndex }
    });
    doRemember(updated);
    return chip;
  }

  const values = stream.ob?.ve?.values ?? [];
  const index = stream.ob?.index ?? 0;
  if (index >= values.length) {
    return makeRuntimeError({
      name: "chip exhausted",
      message: `chip exhausted: ${streamName}`
    });
  }

  const value = values[index];
  const lastIndex = values.length - 1;
  const final = index === lastIndex;
  const ob =
    typeof value === "number" ? { num: value } :
    typeof value === "boolean" ? { boolean: value } :
    value === null ? { hollow: true } :
    { text: String(value) };

  const chip = makeChip({
    streamName,
    index,
    ob,
    toindex: lastIndex,
    vyahValues: ["eval", "sloh"]
  });

  const nextIndex = index + 1;
  const nextState = final ? "done" : (stream.as?.name ?? "open");
  const updated = makeStream({
    name: streamName,
    state: nextState,
    ob: { ...stream.ob, index: nextIndex, ve: stream.ob?.ve }
  });
  doRemember(updated);

  return chip;
}

export default chip_from_filename_text;

export const signatures = [
  {
    signatureWords: ["be", "chip", "from", "filename", "text"],
    handler: chip_from_filename_text
  },
  {
    signatureWords: ["be", "chip", "vyah", "eval"],
    handler: chip_su_stream
  }
];
