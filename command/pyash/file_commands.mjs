import fs from "node:fs/promises";
import path from "node:path";
import { decodeCodelet } from "../../program/library/vliw/index.mjs";
import { decodePyacPack, encodePyacPack } from "../../program/library/vliw/database.mjs";
import { decodePyacWord, encodePyacWord } from "../../program/library/vliw/word_code.mjs";
import { sentenceToPyash } from "../../program/beautiful.mjs";

const PYAC_WORD_DUMP_HEADER = "# Pyac VLIW word dump v1; each row is one 16-word codelet in slot order.";

function usageError(command, detail = "") {
  const usage = `usage: pyash ${command} from <source> to <destination>`;
  const error = new Error(detail ? `${detail}\n${usage}` : usage);
  error.code = "invalid-usage";
  return error;
}

export function parseFromToPaths(command, args) {
  let source;
  let destination;
  if (args.length === 4 && args[0] === "from" && args[2] === "to") {
    [, source, , destination] = args;
  } else if (
    args.length === 6
    && args[0] === "from"
    && args[1] === "filename"
    && args[3] === "to"
    && args[4] === "filename"
  ) {
    source = args[2];
    destination = args[5];
  } else {
    throw usageError(command);
  }
  if (!source || !destination) throw usageError(command, "source and destination paths are required");
  return { source, destination };
}

function parseTranslateArguments(command, args) {
  let format = "pyash";
  let pathArgs = args;
  if (args.length >= 2 && args.at(-2) === "as") {
    format = args.at(-1);
    pathArgs = args.slice(0, -2);
    if (format !== "pyac") throw usageError(command, `unsupported translation format: ${format}`);
  }
  return { ...parseFromToPaths(command, pathArgs), format };
}

function renderPyacWord(word) {
  try {
    const spelling = decodePyacWord(word);
    if (encodePyacWord(spelling) === word) return spelling;
  } catch {
    // Raw VLIW values that are not canonical Pyac words use the lossless hex form.
  }
  return `0x${word.toString(16).padStart(4, "0")}`;
}

function renderPyacWordDump(codelets) {
  const rows = codelets.map((words) => Array.from(
    words,
    (word, slot) => slot === 0 ? `0x${word.toString(16).padStart(4, "0")}` : renderPyacWord(word)
  ).join(" "));
  return [
    PYAC_WORD_DUMP_HEADER,
    ...rows,
    ""
  ].join("\n");
}

function parsePyacWordDump(source) {
  const lines = source.split(/\r?\n/u);
  if (!lines.includes(PYAC_WORD_DUMP_HEADER)) {
    throw new Error("translate: input is missing the Pyac VLIW word dump v1 header");
  }
  const rows = lines
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter(({ line }) => line && !line.startsWith("#"));
  return rows.map(({ line, lineNumber }) => {
    const tokens = line.split(/\s+/u);
    if (tokens.length !== 16) {
      throw new Error(`translate: Pyac VLIW row ${lineNumber} has ${tokens.length} words; expected 16`);
    }
    return Uint16Array.from(tokens, (token) => {
      if (/^0x[\da-f]{4}$/iu.test(token)) return Number.parseInt(token.slice(2), 16);
      let word;
      try {
        word = encodePyacWord(token);
        if (decodePyacWord(word) !== token) throw new Error("word is not canonical");
      } catch (error) {
        throw new Error(`translate: invalid Pyac word "${token}" on row ${lineNumber}: ${error.message}`, {
          cause: error
        });
      }
      return word;
    });
  });
}

export function compileInvocation(command, args) {
  const { source, destination } = parseFromToPaths(command, args);
  const sourceExtension = path.extname(source).toLowerCase();
  const destinationExtension = path.extname(destination).toLowerCase();
  let sourceState;
  let targetState;

  if (sourceExtension === ".pyac") {
    sourceState = "pyac";
    if (destinationExtension === ".c") targetState = "c";
    else if (destinationExtension === ".asm") targetState = "nasm";
  } else if ([".pya", ".txt"].includes(sourceExtension)) {
    sourceState = "pyash";
    if (destinationExtension === ".c") targetState = "c";
    else if ([".js", ".mjs"].includes(destinationExtension)) targetState = "javascript";
  }

  if (!sourceState || !targetState) {
    throw usageError(
      command,
      `unsupported compile pair: ${sourceExtension || "(no source extension)"} to ${destinationExtension || "(no destination extension)"}`
    );
  }

  return [
    "compile",
    "from", "filename", source,
    "fromstate", sourceState,
    "to", "filename", destination,
    "become", targetState,
    "be", "compile", "do"
  ];
}

export async function translatePyac(command, args) {
  const { source, destination, format } = parseTranslateArguments(command, args);
  const sourceExtension = path.extname(source).toLowerCase();
  const destinationExtension = path.extname(destination).toLowerCase();

  if (format === "pyac") {
    if (sourceExtension === ".pyac" && destinationExtension === ".pya") {
      const pack = decodePyacPack(await fs.readFile(source));
      await fs.writeFile(destination, renderPyacWordDump(pack.codelets), "utf8");
      return { source, destination, codeletCount: pack.codelets.length, format };
    }
    if (sourceExtension === ".pya" && destinationExtension === ".pyac") {
      const codelets = parsePyacWordDump(await fs.readFile(source, "utf8"));
      await fs.writeFile(destination, encodePyacPack(codelets));
      return { source, destination, codeletCount: codelets.length, format };
    }
    throw usageError(command, "Pyac round-trip mode requires .pyac to .pya or .pya to .pyac paths");
  }

  if (sourceExtension !== ".pyac" || destinationExtension !== ".pya") {
    throw usageError(command, "default translation requires .pyac input and .pya output; use 'as pyac' for a lossless Pyac word dump");
  }
  const pack = decodePyacPack(await fs.readFile(source));
  const sentences = pack.codelets.map((words, index) => {
    try {
      return sentenceToPyash(decodeCodelet(words).sentence);
    } catch (error) {
      throw new Error(`translate: PyAC codelet ${index + 1} cannot be rendered as Pyash: ${error.message}`, {
        cause: error
      });
    }
  });
  await fs.writeFile(destination, sentences.length > 0 ? `${sentences.join("\n")}\n` : "", "utf8");
  return { source, destination, codeletCount: sentences.length, format: "pyash" };
}
