import fs from "node:fs/promises";
import path from "node:path";
import { decodeCodelet } from "../../program/library/vliw/index.mjs";
import { decodePyacPack } from "../../program/library/vliw/database.mjs";
import { sentenceToPyash } from "../../program/beautiful.mjs";

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

export async function translatePyacToPyash(command, args) {
  const { source, destination } = parseFromToPaths(command, args);
  if (path.extname(source).toLowerCase() !== ".pyac" || path.extname(destination).toLowerCase() !== ".pya") {
    throw usageError(command, "this translation currently supports .pyac input and .pya output");
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
  return { source, destination, codeletCount: sentences.length };
}
