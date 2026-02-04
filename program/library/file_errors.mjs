import { throwErrorSentence } from "../error.mjs";

export function throwFileUnavailable({ path, from }) {
  throwErrorSentence({
    name: "file or directory unavailable error",
    message: `file or directory unavailable: ${path}`,
    from: from ? { name: from } : undefined
  });
}

export function handleFileUnavailable(err, { path, from } = {}) {
  if (err?.code === "ENOENT") {
    throwFileUnavailable({ path, from });
  }
  throw err;
}
