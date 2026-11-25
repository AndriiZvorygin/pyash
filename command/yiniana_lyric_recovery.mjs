import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A rendered song can look right and still have lost its words. The check is
// the share of the sheet's n-grams that the transcription carries back.

function stripTags(text) {
  return String(text ?? "").replace(/\[[^\]]*\]/gu, " ");
}

// Section markers are scaffolding, not sung words; they are removed here so
// no caller can leave them in and dilute the count.
function words(text) {
  return stripTags(text)
    .toLowerCase()
    .match(/[a-z']+/gu) ?? [];
}

function phrases(wordList, n = 4) {
  const out = new Set();
  if (n < 1) return out;
  for (let i = 0; i + n <= wordList.length; i += 1) {
    out.add(wordList.slice(i, i + n).join(" "));
  }
  return out;
}

// The transcript may arrive as plain text, as the JSON the hear runner prints,
// or as Whisper's segment list; all three are accepted.
function transcriptText(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text);
      const direct = String(parsed?.transcript ?? parsed?.text ?? "");
      if (direct.trim()) return direct;
      if (Array.isArray(parsed?.segments)) {
        const joined = parsed.segments
          .map((segment) => String(segment?.text ?? "").trim())
          .filter(Boolean)
          .join(" ");
        if (joined.trim()) return joined;
      }
    } catch {
      return text;
    }
  }
  return text;
}

function recoverRate(expectedText, heardText, n = 4) {
  const expected = phrases(words(expectedText), n);
  const heard = phrases(words(heardText), n);
  const missing = [];
  let hits = 0;
  for (const phrase of expected) {
    if (heard.has(phrase)) hits += 1;
    else missing.push(phrase);
  }
  const total = expected.size;
  return {
    n,
    total,
    hits,
    fraction: total ? hits / total : 0,
    missing
  };
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = { expected: null, heard: null, n: 4 };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--n") out.n = Number.parseInt(String(args[++i] ?? "4"), 10) || 4;
    else if (!out.expected) out.expected = args[i];
    else if (!out.heard) out.heard = args[i];
  }
  return out;
}

function writeLine(text) {
  try {
    fsSync.writeFileSync(1, `${text}\n`, "utf8");
  } catch (err) {
    // The reader may have closed the pipe (head, grep). Nothing left to say.
    if (err?.code !== "EPIPE") throw err;
  }
}

async function main() {
  const opts = parseArgs(process.argv);
  if (!opts.expected || !opts.heard) {
    throw new Error("yiniana_lyric_recovery: usage: <song.txt> <transcript.txt|json> [--n 4]");
  }
  const expectedText = await fs.readFile(opts.expected, "utf8");
  const heardRaw = await fs.readFile(opts.heard, "utf8");
  const result = recoverRate(expectedText, transcriptText(heardRaw), opts.n);
  const percent = (result.fraction * 100).toFixed(1);
  writeLine(`${result.hits}/${result.total} ${result.n}-grams recovered (${percent}%)`);
  for (const phrase of result.missing.slice(0, 20)) {
    writeLine(`  missing: ${phrase}`);
  }
}

export { phrases, recoverRate, stripTags, transcriptText, words };

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    const message = err?.message ?? String(err);
    if (message) fsSync.writeFileSync(2, `${message}\n`, "utf8");
    process.exit(1);
  });
}
