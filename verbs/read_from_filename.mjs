import fs from "node:fs/promises";

export default async function readFromFilename({ from }) {
  const filename = from?.filename;
  if (!filename) throw new Error("read_from_filename: filename is required");

  const text = await fs.readFile(filename, "utf8");
  return { obj: { text } };
}
