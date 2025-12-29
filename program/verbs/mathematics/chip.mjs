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

export function chip_su_stream(sentence) {
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

  const values = stream.ob?.ve?.values ?? [];
  const index = stream.ob?.index ?? 0;
  if (index >= values.length) {
    return makeRuntimeError({
      name: "stream exhausted",
      message: `stream exhausted: ${streamName}`
    });
  }

  const value = values[index];
  const final = index === values.length - 1;
  const ob =
    typeof value === "number" ? { num: value } :
    typeof value === "boolean" ? { boolean: value } :
    value === null ? { hollow: true } :
    { text: String(value) };

  const chip = makeChip({
    streamName,
    index,
    ob,
    final,
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
